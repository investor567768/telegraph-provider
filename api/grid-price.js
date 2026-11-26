import { inflateRawSync } from 'node:zlib';

// Grid power price miner for Telegraph: GRID_POWER_PRICE_GENERAL
// Reads public, keyless grid-operator data and answers in the Intent's fields:
//   lmp_usd_per_mwh, node_or_zone, market, interval_start, currency
//
// Sources (no API key):
//   NYISO real-time zonal LBMP, latest:  http://mis.nyiso.com/public/realtime/realtime_zone_lbmp.csv
//   NYISO real-time zonal LBMP, by day:  http://mis.nyiso.com/public/csv/realtime/YYYYMMDDrealtime_zone.csv
//   NYISO day-ahead zonal LBMP, by day:  http://mis.nyiso.com/public/csv/damlbmp/YYYYMMDDdamlbmp_zone.csv
//   MISO real-time 5-minute ex-post LMP, current day:
//     https://public-api.misoenergy.org/api/MarketPricing/GetRealTimeFiveMinExPost/Rolling
//   CAISO day-ahead hourly LMP (OASIS PRC_LMP, market DAM), any date, as a zipped CSV:
//     http://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&market_run_id=DAM&...&resultformat=6
//     CAISO stamps rows in GMT (INTERVALSTARTTIME_GMT), so no time-zone guessing is needed.
//
// Time stamps: NYISO real-time postings are stamped at the END of each 5-minute interval, in US Eastern
// prevailing time; day-ahead rows are stamped at the start of the hour. MISO publishes in EST (UTC-5) all
// year; its rolling file starts at 00:00, so its stamps are read as interval starts.

const NYISO_LATEST = 'http://mis.nyiso.com/public/realtime/realtime_zone_lbmp.csv';
const NYISO_RT_DAY = d => `http://mis.nyiso.com/public/csv/realtime/${d}realtime_zone.csv`;
const NYISO_DA_DAY = d => `http://mis.nyiso.com/public/csv/damlbmp/${d}damlbmp_zone.csv`;
// Older days are moved out of the daily files into one zip per month, named by the first day of the month
const NYISO_RT_MONTH = d => `http://mis.nyiso.com/public/csv/realtime/${d.slice(0, 6)}01realtime_zone_csv.zip`;
const NYISO_DA_MONTH = d => `http://mis.nyiso.com/public/csv/damlbmp/${d.slice(0, 6)}01damlbmp_zone_csv.zip`;
const MISO_ROLLING = 'https://public-api.misoenergy.org/api/MarketPricing/GetRealTimeFiveMinExPost/Rolling';
const CAISO_OASIS = 'http://oasis.caiso.com/oasisapi/SingleZip';
const UA = { 'user-agent': 'telegraph-provider/1.0 (+https://github.com/investor567768)' };

// NYISO zones: official name -> words a buyer might use
const NYISO_ZONES = {
  'WEST': ['A', 'WEST', 'WESTERN NEW YORK', 'BUFFALO'],
  'GENESE': ['B', 'GENESE', 'GENESEE', 'ROCHESTER'],
  'CENTRL': ['C', 'CENTRL', 'CENTRAL', 'SYRACUSE'],
  'NORTH': ['D', 'NORTH', 'NORTHERN NEW YORK'],
  'MHK VL': ['E', 'MHK VL', 'MOHAWK VALLEY', 'MOHAWK'],
  'CAPITL': ['F', 'CAPITL', 'CAPITAL', 'ALBANY'],
  'HUD VL': ['G', 'HUD VL', 'HUDSON VALLEY', 'HUDSON'],
  'MILLWD': ['H', 'MILLWD', 'MILLWOOD'],
  'DUNWOD': ['I', 'DUNWOD', 'DUNWOODIE'],
  'N.Y.C.': ['J', 'N.Y.C.', 'NYC', 'NEW YORK CITY', 'NEW YORK'],
  'LONGIL': ['K', 'LONGIL', 'LONG ISLAND'],
};
const MISO_HUBS = {
  'ILLINOIS.HUB': ['ILLINOIS'], 'INDIANA.HUB': ['INDIANA'], 'LOUISIANA.HUB': ['LOUISIANA'],
  'MICHIGAN.HUB': ['MICHIGAN'], 'MINN.HUB': ['MINN', 'MINNESOTA'], 'MS.HUB': ['MS', 'MISSISSIPPI'],
  'TEXAS.HUB': ['TEXAS'], 'ARKANSAS.HUB': ['ARKANSAS'],
};
// CAISO trading hubs. The day-ahead question in the Intent names no location, so a bare "CAISO" means NP15.
const CAISO_HUBS = {
  'TH_NP15_GEN-APND': ['NP15', 'NP 15', 'NORTH OF PATH 15', 'NORTHERN CALIFORNIA'],
  'TH_SP15_GEN-APND': ['SP15', 'SP 15', 'SOUTH OF PATH 15', 'SOUTHERN CALIFORNIA'],
  'TH_ZP26_GEN-APND': ['ZP26', 'ZP 26', 'PATH 26'],
};
const CAISO_DEFAULT = 'TH_NP15_GEN-APND';
const OTHER_OPERATORS = ['PJM', 'SPP', 'ISO NE', 'ISONE', 'AESO', 'IESO'];

class AnswerError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const norm = s => String(s || '').toUpperCase().replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim();

// Work out which operator and which location the buyer means.
function resolveLocation(raw) {
  const q = norm(raw);
  if (!q) throw new AnswerError(400, 'node_or_zone is required, for example "CAISO NP15", "N.Y.C." or "MISO INDIANA.HUB".');
  const saysNyiso = /\bNYISO\b|\bNEW YORK\b|\bNY\b/.test(q);
  const saysMiso = /\bMISO\b/.test(q);
  const saysCaiso = /\bCAISO\b|\bCALIFORNIA\b|\bCAL ISO\b/.test(q);

  // CAISO: exact node names (TH_NP15_GEN-APND, DLAP_PGAE-APND, 0096WD_7_N001), hub nicknames, or bare "CAISO"
  const rawUp = String(raw || '').toUpperCase().replace(/^CAISO[\s:]+/, '').trim();
  if (/^[A-Z0-9_]+-APND$|^[A-Z0-9]+_\d+_N\d+$/.test(rawUp)) return { operator: 'CAISO', name: rawUp };
  if (!saysNyiso && !saysMiso) {
    for (const [hub, words] of Object.entries(CAISO_HUBS)) {
      if (words.some(w => q.includes(w))) return { operator: 'CAISO', name: hub };
    }
    if (saysCaiso) return { operator: 'CAISO', name: CAISO_DEFAULT, defaulted: true };
  }
  const stripped = q.replace(/\b(NYISO|MISO|ZONE|LOAD ZONE|HUB|TRADING HUB|NODE|PRICE|LMP|LBMP|REAL TIME|DAY AHEAD)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // ERCOT (Texas) names: hubs HB_*, load zones LZ_*, DC ties DC_*, or "ERCOT"/"Texas" without MISO.
  // Refuse them so "HB_WEST" can never be mistaken for NYISO zone WEST.
  if (/\bERCOT\b/.test(q) || /(^|\s)(HB|LZ|DC)\s[A-Z]/.test(q) || (/\bTEXAS\b/.test(q) && !saysMiso && !/TEXAS\.?\s?HUB/.test(q)))
    throw new AnswerError(404, `ERCOT (Texas) is not covered: "${raw}" looks like an ERCOT location. This miner answers CAISO, NYISO and MISO only.`);

  // NYISO official zone names written exactly (N.Y.C. contains dots, so check before MISO node names)
  const official = Object.keys(NYISO_ZONES).find(z => q.replace(/^NYISO\s+/, '') === z);
  // WEST and NORTH are also zone names in other grids (ERCOT LZ_WEST, HB_NORTH): accept them only with "NYISO"
  if (official && !saysMiso && (saysNyiso || !['WEST', 'NORTH'].includes(official))) return { operator: 'NYISO', name: official };

  // MISO node given exactly, e.g. WEC.OAKCREKC5 or INDIANA.HUB
  const exactNode = q.replace(/^MISO\s+/, '').replace(/\s+/g, '');
  if (/^[A-Z0-9_]+\.[A-Z0-9_.]+$/.test(exactNode) && !saysNyiso) return { operator: 'MISO', name: exactNode };

  if (!saysMiso) {
    for (const [zone, words] of Object.entries(NYISO_ZONES)) {
      // generic words (WEST, NORTH) exist in other grids too, so they need "NYISO" in the question
      const generic = new Set(['WEST', 'NORTH']);
      const hit = words.some(w => {
        if (w.length === 1 || generic.has(w)) return saysNyiso && stripped === w;
        return stripped === w || new RegExp(`(^|\\s)${w.replace(/[.]/g, '\\.')}(\\s|$)`).test(stripped);
      });
      if (hit) return { operator: 'NYISO', name: zone };
    }
  }
  if (!saysNyiso) {
    for (const [hub, words] of Object.entries(MISO_HUBS)) {
      if (words.some(w => stripped === w || (saysMiso && stripped.includes(w)) || q.includes(`${w} HUB`)))
        return { operator: 'MISO', name: hub };
    }
  }
  const other = OTHER_OPERATORS.find(o => q.includes(o));
  if (other) throw new AnswerError(404, `${other} is not covered. This miner answers CAISO, NYISO and MISO.`);
  throw new AnswerError(404, `Could not match "${raw}" to a CAISO, NYISO or MISO location. Examples: "CAISO NP15", "N.Y.C.", "NYISO zone J", "MISO INDIANA.HUB".`);
}

// --- time helpers -----------------------------------------------------------------------------
function easternOffsetMinutes(utcDate) {
  // minutes to ADD to local Eastern time to get UTC (300 in winter, 240 in summer)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(utcDate);
  const g = t => +parts.find(p => p.type === t).value;
  const local = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
  return Math.round((utcDate.getTime() - local) / 60000);
}
function easternToUtc(y, mo, d, h, mi) {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi) + 300 * 60000);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) + easternOffsetMinutes(guess) * 60000);
}
function parseNyisoStamp(s) { // "11/19/2026 07:10:00"
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  if (!m) throw new AnswerError(502, 'NYISO time stamp not recognised: ' + s);
  return easternToUtc(+m[3], +m[1], +m[2], +m[4], +m[5]);
}
function parseMisoStamp(s) { // "2026-11-19T00:00:00", always EST = UTC-5
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new AnswerError(502, 'MISO time stamp not recognised: ' + s);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 300 * 60000);
}
function parseRequestedTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const t = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z'); // no zone given -> UTC
  if (isNaN(t)) throw new AnswerError(400, `interval_start "${raw}" is not a date and time. Use ISO 8601, for example 2026-11-19T12:00:00Z.`);
  return t;
}
const easternDateKey = t => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  return p.replace(/-/g, '');
};
const iso = d => d.toISOString().replace('.000Z', 'Z');

// --- fetching with a short cache ----------------------------------------------------------------
const cache = new Map();
async function getText(url, ttlMs) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body;
  let r;
  try { r = await fetch(url, { headers: UA }); }
  catch (e) { throw new AnswerError(502, 'The grid operator could not be reached. Try again shortly.'); }
  if (r.status === 404) throw new AnswerError(404, 'The operator has not published data for that date.');
  if (!r.ok) throw new AnswerError(502, `The grid operator answered HTTP ${r.status}.`);
  const body = await r.text();
  cache.set(url, { at: Date.now(), body });
  return body;
}
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur); rows.push(cells);
  }
  return rows;
}

// NYISO keeps recent days as daily CSVs and moves older days into one zip per month.
// Try the daily file first; on 404, read that day's CSV out of the monthly zip.
async function nyisoDay(dayAhead, dateKey) {
  const daily = dayAhead ? NYISO_DA_DAY(dateKey) : NYISO_RT_DAY(dateKey);
  try { return { text: await getText(daily, 10 * 60000), url: daily }; }
  catch (e) { if (!(e instanceof AnswerError) || e.status !== 404) throw e; }
  const zipUrl = dayAhead ? NYISO_DA_MONTH(dateKey) : NYISO_RT_MONTH(dateKey);
  const inner = dayAhead ? `${dateKey}damlbmp_zone.csv` : `${dateKey}realtime_zone.csv`;
  const hit = cache.get(zipUrl + '#' + inner);
  if (hit && Date.now() - hit.at < 24 * 3600000) return { text: hit.body, url: zipUrl };
  let r;
  try { r = await fetch(zipUrl, { headers: UA }); }
  catch (e) { throw new AnswerError(502, 'The grid operator could not be reached. Try again shortly.'); }
  if (r.status === 404) throw new AnswerError(404, `NYISO has published no file for ${dateKey}, neither the daily file nor the monthly archive.`);
  if (!r.ok) throw new AnswerError(502, `The grid operator answered HTTP ${r.status}.`);
  const out = unzipFirst(Buffer.from(await r.arrayBuffer()), inner);
  if (!out) throw new AnswerError(404, `NYISO's monthly archive has no file for ${dateKey}.`);
  cache.set(zipUrl + '#' + inner, { at: Date.now(), body: out.text });
  return { text: out.text, url: `${zipUrl} (${inner} inside)` };
}

// On the autumn change from daylight time, the Eastern clock repeats 01:00-01:59, so the same
// stamp appears twice. In file order, the first one is daylight time (EDT) and the second standard (EST).
function nyisoStampsInOrder(stamps) {
  const seen = new Set();
  return stamps.map(s => {
    const t = parseNyisoStamp(s); // a repeated wall-clock time is read as the later (EST) instant
    const earlier = new Date(t.getTime() - 3600000);
    const repeats = easternWall(earlier) === easternWall(t);
    if (!repeats) return t;
    if (seen.has(s)) return t;
    seen.add(s);
    return earlier;
  });
}
const easternWall = d => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);

// --- operators ----------------------------------------------------------------------------------
async function nyiso(zone, when, market) {
  const dayAhead = market === 'day_ahead';
  const intervalMin = dayAhead ? 60 : 5;
  let url, text;
  if (!dayAhead && !when) { url = NYISO_LATEST; text = await getText(url, 60000); }
  else ({ text, url } = await nyisoDay(dayAhead, easternDateKey(when || new Date())));
  const rows = parseCsv(text);
  const head = rows[0].map(h => h.trim());
  const iT = head.indexOf('Time Stamp'), iN = head.indexOf('Name'), iL = head.findIndex(h => h.startsWith('LBMP'));
  const iLoss = head.findIndex(h => h.startsWith('Marginal Cost Losses')), iCong = head.findIndex(h => h.startsWith('Marginal Cost Congestion'));
  if (iT < 0 || iN < 0 || iL < 0) throw new AnswerError(502, 'NYISO file layout changed; the answer cannot be read.');
  const zoneRows = rows.slice(1).filter(r => r[iN] === zone);
  const stamps = nyisoStampsInOrder(zoneRows.map(r => r[iT]));
  const mine = zoneRows.map((r, k) => {
    const stamp = stamps[k];
    const start = dayAhead ? stamp : new Date(stamp.getTime() - 5 * 60000); // real-time stamps mark the interval end
    return { start, row: r };
  });
  if (!mine.length) throw new AnswerError(404, `NYISO published no price for zone ${zone} in that file.`);
  let pick;
  if (!when) pick = mine[mine.length - 1];
  else pick = mine.find(x => when >= x.start && when < new Date(x.start.getTime() + intervalMin * 60000));
  if (!pick) throw new AnswerError(404, `No NYISO ${dayAhead ? 'day-ahead' : 'real-time'} interval for zone ${zone} contains ${iso(when)}.`);
  const r = pick.row;
  return {
    lmp: +r[iL], node_or_zone: zone, operator: 'NYISO',
    market: dayAhead ? 'NYISO day-ahead hourly zonal LBMP' : 'NYISO real-time 5-minute zonal LBMP',
    start: pick.start, minutes: intervalMin, published: r[iT] + (dayAhead ? ' Eastern (hour beginning)' : ' Eastern (interval ending)'),
    components: { losses: iLoss >= 0 ? +r[iLoss] : null, congestion: iCong >= 0 ? +r[iCong] : null }, source_url: url,
  };
}
async function miso(node, when, market) {
  if (market === 'day_ahead') throw new AnswerError(404, 'Day-ahead prices are only available for NYISO zones here.');
  const j = JSON.parse(await getText(MISO_ROLLING, 60000));
  const h = j.headers || [];
  const iI = h.indexOf('INTERVAL'), iN = h.indexOf('CPNODE'), iL = h.indexOf('LMP'), iMlc = h.indexOf('MLC'), iMcc = h.indexOf('MCC');
  if (iI < 0 || iN < 0 || iL < 0) throw new AnswerError(502, 'MISO data layout changed; the answer cannot be read.');
  const mine = (j.data || []).filter(r => String(r[iN]).toUpperCase() === node)
    .map(r => ({ start: parseMisoStamp(r[iI]), row: r })).sort((a, b) => a.start - b.start);
  if (!mine.length) throw new AnswerError(404, `MISO published no price for node ${node} today. Check the node name.`);
  const pick = when ? mine.find(x => when >= x.start && when < new Date(x.start.getTime() + 300000)) : mine[mine.length - 1];
  if (!pick) throw new AnswerError(404, `No MISO interval for ${node} contains ${iso(when)}. MISO's public feed covers the current day only.`);
  const r = pick.row;
  return {
    lmp: +r[iL], node_or_zone: String(r[iN]), operator: 'MISO', market: 'MISO real-time 5-minute ex-post LMP',
    start: pick.start, minutes: 5, published: r[iI] + ' EST',
    components: { losses: iMlc >= 0 ? +r[iMlc] : null, congestion: iMcc >= 0 ? +r[iMcc] : null }, source_url: MISO_ROLLING,
  };
}


// --- CAISO: OASIS answers with a zip file holding one CSV (or one XML error) -------------------
function unzipFirst(buf, wanted) {
  // read the zip's central directory, then inflate the first entry (or the entry named `wanted`)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new AnswerError(502, 'CAISO returned something that is not a zip file.');
  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16), method, size, local, name;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new AnswerError(502, 'The zip file is damaged.');
    method = buf.readUInt16LE(cd + 10); size = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28), extra = buf.readUInt16LE(cd + 30), comment = buf.readUInt16LE(cd + 32);
    local = buf.readUInt32LE(cd + 42);
    name = buf.slice(cd + 46, cd + 46 + nameLen).toString('utf8');
    if (!wanted || name === wanted) break;
    name = null; cd += 46 + nameLen + extra + comment;
  }
  if (!name) return null;
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.slice(start, start + size);
  const body = method === 0 ? data : inflateRawSync(data);
  return { name, text: body.toString('utf8') };
}
const caisoTime = d => d.toISOString().slice(0, 16).replace(/-/g, '') + '-0000'; // 20260913T14:00-0000
// OASIS throttles bursts (HTTP 429, or an XML error 1015). A throttled request is retried after a
// short wait, so a buyer gets the price instead of an error. Waits are swappable for tests.
const retry = { waitsMs: [2000, 4000], sleep: ms => new Promise(r => setTimeout(r, ms)) };
async function getZip(url, ttlMs) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body;
  for (let i = 0; ; i++) {
    try { return await getZipOnce(url); }
    catch (e) {
      if (!e.throttled || i >= retry.waitsMs.length) throw e;
      await retry.sleep(retry.waitsMs[i]);
    }
  }
}
function throttled() { const e = new AnswerError(503, 'CAISO OASIS is limiting requests and was still busy after two retries. Try again in a minute.'); e.throttled = true; return e; }
async function getZipOnce(url) {
  let r;
  try { r = await fetch(url, { headers: UA }); }
  catch (e) { throw new AnswerError(502, 'CAISO OASIS could not be reached. Try again shortly.'); }
  if (r.status === 429) throw throttled();
  if (!r.ok) throw new AnswerError(502, `CAISO OASIS answered HTTP ${r.status}.`);
  const out = unzipFirst(Buffer.from(await r.arrayBuffer()));
  if (/\.xml$/i.test(out.name) || /^\s*</.test(out.text)) {
    const desc = (out.text.match(/<(?:\w+:)?ERR_DESC>([^<]*)</) || [])[1] || 'unknown error';
    const code = (out.text.match(/<(?:\w+:)?ERR_CODE>([^<]*)</) || [])[1] || '';
    if (code === '1015' || /too many/i.test(desc)) throw throttled();
    throw new AnswerError(404, `CAISO OASIS returned no price: ${desc.trim()}`);
  }
  cache.set(url, { at: Date.now(), body: out.text });
  return out.text;
}
async function caiso(node, when, market) {
  if (market === 'real_time') throw new AnswerError(404, 'CAISO real-time prices are not covered yet; this miner answers CAISO day-ahead prices.');
  const t = when || new Date();
  const hour = new Date(Math.floor(t.getTime() / 3600000) * 3600000);
  const end = new Date(hour.getTime() + 3600000);
  const url = `${CAISO_OASIS}?queryname=PRC_LMP&market_run_id=DAM&startdatetime=${caisoTime(hour)}&enddatetime=${caisoTime(end)}&version=1&node=${encodeURIComponent(node)}&resultformat=6`;
  const past = end.getTime() < Date.now() - 2 * 86400000;
  const rows = parseCsv(await getZip(url, past ? 24 * 3600000 : 15 * 60000));
  const head = rows[0].map(h => h.trim().toUpperCase());
  const iS = head.indexOf('INTERVALSTARTTIME_GMT'), iE = head.indexOf('INTERVALENDTIME_GMT'), iN = head.indexOf('NODE');
  const iT = head.indexOf('LMP_TYPE'), iV = ['MW', 'PRC', 'VALUE'].map(c => head.indexOf(c)).find(i => i >= 0);
  const iDt = head.indexOf('OPR_DT'), iHr = head.indexOf('OPR_HR');
  if (iS < 0 || iN < 0 || iT < 0 || iV === undefined) throw new AnswerError(502, 'CAISO file layout changed; the answer cannot be read.');
  const mine = rows.slice(1).filter(r => r[iN] === node && new Date(r[iS]).getTime() === hour.getTime());
  const pick = type => { const r = mine.find(x => x[iT] === type); return r ? +r[iV] : null; };
  const lmp = pick('LMP');
  if (lmp === null) throw new AnswerError(404, `CAISO published no day-ahead price for ${node} for the hour starting ${iso(hour)}.`);
  return {
    lmp, node_or_zone: node, operator: 'CAISO', market: 'CAISO day-ahead hourly LMP (DAM)',
    start: hour, minutes: 60,
    published: iDt >= 0 ? `${mine[0][iDt]} hour ending ${mine[0][iHr]} Pacific (operating day, OPR_HR)` : mine[0][iS],
    components: { losses: pick('MCL'), congestion: pick('MCC'), energy: pick('MCE'), ghg: pick('MGHG') }, source_url: url,
  };
}

// --- answer -------------------------------------------------------------------------------------
async function answer(params) {
  const loc = resolveLocation(params.node_or_zone || params.node || params.zone || params.query);
  const when = parseRequestedTime(params.interval_start);
  // Day-ahead prices are published about one day ahead; nothing exists further out, so say so
  // before calling an operator (CAISO otherwise answers with a misleading rate-limit or empty result).
  if (when && when.getTime() > Date.now() + 2 * 86400000)
    throw new AnswerError(404, `${iso(when)} is in the future. Grid operators publish day-ahead prices about one day ahead, so no price exists yet for that interval.`);
  const raw = norm([params.market, params.query, params.node_or_zone].filter(Boolean).join(' '));
  const saysDayAhead = /DAY AHEAD|\bDAM\b|\bDA\b/.test(raw);
  const saysRealTime = /REAL TIME|\bRTM\b|\bRT\b|5 MINUTE/.test(raw);
  // NYISO and MISO default to real-time; CAISO defaults to day-ahead, the market the Intent's question asks about
  const market = saysDayAhead ? 'day_ahead' : saysRealTime ? 'real_time' : (loc.operator === 'CAISO' ? 'day_ahead' : 'real_time');
  const p = loc.operator === 'NYISO' ? await nyiso(loc.name, when, market)
    : loc.operator === 'CAISO' ? await caiso(loc.name, when, market)
    : await miso(loc.name, when, market);
  if (!isFinite(p.lmp)) throw new AnswerError(502, 'The operator returned a price that is not a number.');
  return {
    lmp_usd_per_mwh: p.lmp,
    node_or_zone: p.node_or_zone,
    market: p.market,
    interval_start: iso(p.start),
    interval_end: iso(new Date(p.start.getTime() + p.minutes * 60000)),
    currency: 'USD',
    operator: p.operator,
    marginal_cost_losses_usd_per_mwh: p.components.losses,
    marginal_cost_congestion_usd_per_mwh: p.components.congestion,
    ...(p.components.energy != null ? { marginal_cost_energy_usd_per_mwh: p.components.energy } : {}),
    ...(p.components.ghg != null ? { marginal_cost_ghg_usd_per_mwh: p.components.ghg } : {}),
    operator_time_stamp: p.published,
    source_url: p.source_url,
    verdict: 'found',
    confidence: 1,
    reason: `${p.operator} published ${p.lmp} USD/MWh for ${p.node_or_zone} for the interval starting ${iso(p.start)}.`
      + (loc.defaulted ? ' No CAISO location was named, so the NP15 trading hub (TH_NP15_GEN-APND) was used.' : ''),
    checked_at: iso(new Date()),
  };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const params = Object.fromEntries(url.searchParams.entries());
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');
  try {
    res.statusCode = 200;
    res.end(JSON.stringify(await answer(params)));
  } catch (e) {
    const status = e instanceof AnswerError ? e.status : 500;
    res.statusCode = status;
    res.end(JSON.stringify({ verdict: 'not_found', confidence: 0, error: e.message, reason: e.message, checked_at: iso(new Date()) }));
  }
}

export { answer, resolveLocation, unzipFirst, parseNyisoStamp, nyisoStampsInOrder, parseMisoStamp, easternToUtc, AnswerError, cache, retry };
