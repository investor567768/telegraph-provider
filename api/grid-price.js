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
//
// Time stamps: NYISO real-time postings are stamped at the END of each 5-minute interval, in US Eastern
// prevailing time; day-ahead rows are stamped at the start of the hour. MISO publishes in EST (UTC-5) all
// year; its rolling file starts at 00:00, so its stamps are read as interval starts.

const NYISO_LATEST = 'http://mis.nyiso.com/public/realtime/realtime_zone_lbmp.csv';
const NYISO_RT_DAY = d => `http://mis.nyiso.com/public/csv/realtime/${d}realtime_zone.csv`;
const NYISO_DA_DAY = d => `http://mis.nyiso.com/public/csv/damlbmp/${d}damlbmp_zone.csv`;
const MISO_ROLLING = 'https://public-api.misoenergy.org/api/MarketPricing/GetRealTimeFiveMinExPost/Rolling';
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
const OTHER_OPERATORS = ['ERCOT', 'CAISO', 'PJM', 'SPP', 'ISO-NE', 'ISONE', 'AESO', 'IESO'];

class AnswerError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const norm = s => String(s || '').toUpperCase().replace(/[_\-]/g, ' ').replace(/\s+/g, ' ').trim();

// Work out which operator and which location the buyer means.
function resolveLocation(raw) {
  const q = norm(raw);
  if (!q) throw new AnswerError(400, 'node_or_zone is required, for example "N.Y.C.", "NYISO zone J" or "MISO INDIANA.HUB".');
  const saysNyiso = /\bNYISO\b|\bNEW YORK\b|\bNY\b/.test(q);
  const saysMiso = /\bMISO\b/.test(q);
  const stripped = q.replace(/\b(NYISO|MISO|ZONE|LOAD ZONE|HUB|TRADING HUB|NODE|PRICE|LMP|LBMP|REAL TIME|DAY AHEAD)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // NYISO official zone names written exactly (N.Y.C. contains dots, so check before MISO node names)
  const official = Object.keys(NYISO_ZONES).find(z => q.replace(/^NYISO\s+/, '') === z);
  if (official && !saysMiso) return { operator: 'NYISO', name: official };

  // MISO node given exactly, e.g. WEC.OAKCREKC5 or INDIANA.HUB
  const exactNode = q.replace(/^MISO\s+/, '').replace(/\s+/g, '');
  if (/^[A-Z0-9_]+\.[A-Z0-9_.]+$/.test(exactNode) && !saysNyiso) return { operator: 'MISO', name: exactNode };

  if (!saysMiso) {
    for (const [zone, words] of Object.entries(NYISO_ZONES)) {
      const hit = words.some(w => w.length === 1 ? (saysNyiso && stripped === w) : (stripped === w || stripped.includes(w)));
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
  if (other) throw new AnswerError(404, `${other} is not covered. This miner answers NYISO zones and MISO nodes and hubs.`);
  throw new AnswerError(404, `Could not match "${raw}" to a NYISO zone or MISO node. Examples: "N.Y.C.", "NYISO zone J", "MISO INDIANA.HUB".`);
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

// --- operators ----------------------------------------------------------------------------------
async function nyiso(zone, when, market) {
  const dayAhead = market === 'day_ahead';
  const intervalMin = dayAhead ? 60 : 5;
  let url;
  if (dayAhead) url = NYISO_DA_DAY(easternDateKey(when || new Date()));
  else url = when ? NYISO_RT_DAY(easternDateKey(when)) : NYISO_LATEST;
  const rows = parseCsv(await getText(url, when ? 10 * 60000 : 60000));
  const head = rows[0].map(h => h.trim());
  const iT = head.indexOf('Time Stamp'), iN = head.indexOf('Name'), iL = head.findIndex(h => h.startsWith('LBMP'));
  const iLoss = head.findIndex(h => h.startsWith('Marginal Cost Losses')), iCong = head.findIndex(h => h.startsWith('Marginal Cost Congestion'));
  if (iT < 0 || iN < 0 || iL < 0) throw new AnswerError(502, 'NYISO file layout changed; the answer cannot be read.');
  const mine = rows.slice(1).filter(r => r[iN] === zone).map(r => {
    const stamp = parseNyisoStamp(r[iT]);
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

// --- answer -------------------------------------------------------------------------------------
async function answer(params) {
  const loc = resolveLocation(params.node_or_zone || params.node || params.zone || params.query);
  const when = parseRequestedTime(params.interval_start);
  const raw = norm(params.market || params.query || '');
  const market = /DAY AHEAD|DAM\b|DA\b/.test(raw) ? 'day_ahead' : 'real_time';
  const p = loc.operator === 'NYISO' ? await nyiso(loc.name, when, market) : await miso(loc.name, when, market);
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
    operator_time_stamp: p.published,
    source_url: p.source_url,
    verdict: 'found',
    confidence: 1,
    reason: `${p.operator} published ${p.lmp} USD/MWh for ${p.node_or_zone} for the interval starting ${iso(p.start)}.`,
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

export { answer, resolveLocation, parseNyisoStamp, parseMisoStamp, easternToUtc, AnswerError, cache };
