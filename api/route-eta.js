// Border-Aware Freight Route ETA: a miner for Telegraph's ROUTE_ETA_GENERAL Intent.
//
// Scored answer: `duration`, the car driving time in whole seconds between two places.
// Extra, unscored fields for freight and delivery agents:
//   border_crossings  every national border the driving route crosses, in order
//   countries_on_route  the countries the route passes through
//   truck_duration    driving time for Valhalla's default truck profile
//   has_ferry         whether the route relies on a ferry
//
// Sources (all public and keyless):
//   Places:  OpenStreetMap Nominatim  https://nominatim.openstreetmap.org/search
//   Car:     OSRM demo server         https://router.project-osrm.org/route/v1/driving
//   Truck, ferry and borders:  Valhalla on FOSSGIS  https://valhalla1.openstreetmap.de
//
// Place names are never guessed. When a name matches places in different countries and
// nothing in the question settles which one is meant, the miner refuses and lists them.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const VALHALLA = 'https://valhalla1.openstreetmap.de';
const UA = { 'user-agent': 'telegraph-provider/1.0 (+https://github.com/investor567768/telegraph-provider)' };

// Nominatim asks for at most one request per second; two place lookups are spaced by this gap.
const config = { geocodeGapMs: 1100 };
// A rival place counts as a real alternative when it is at least this important relative to the best match.
const RIVAL_RATIO = 0.75;

class AnswerError extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
}
const iso = d => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cache = new Map();
async function getJson(url, ttlMs, what, init) {
  const key = init ? url + '|' + init.body : url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body;
  let r;
  try { r = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers || {}) } }); }
  catch { throw new AnswerError(502, `${what} could not be reached. Try again shortly.`); }
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!r.ok && !(body && (body.code || body.error))) throw new AnswerError(502, `${what} answered HTTP ${r.status}.`);
  if (body === null) throw new AnswerError(502, `${what} returned something that is not JSON.`);
  cache.set(key, { at: Date.now(), body });
  return body;
}

// --- places ----------------------------------------------------------------------------------

// "6.5244,3.3792" or "Lagos (6.5244, 3.3792)" -> a point, latitude first
function parseCoords(raw) {
  const m = String(raw).match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = +m[1], lon = +m[2];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = String(raw).replace(/\(?\s*-?\d{1,2}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*\)?/, '').trim();
  return { lat, lon, name: name || `${lat},${lon}`, country_code: null, from_coordinates: true };
}

async function candidates(query) {
  const url = `${NOMINATIM}?format=jsonv2&limit=6&addressdetails=1&accept-language=en&q=${encodeURIComponent(query)}`;
  const rows = await getJson(url, 7 * 86400000, 'The OpenStreetMap place search');
  if (!Array.isArray(rows)) throw new AnswerError(502, 'The OpenStreetMap place search returned an unexpected answer.');
  return rows.map(r => ({
    name: r.display_name,
    lat: +r.lat, lon: +r.lon,
    country_code: (r.address?.country_code || '').toUpperCase() || null,
    country: r.address?.country || null,
    importance: +r.importance || 0,
    osm: `${r.osm_type}/${r.osm_id}`,
  })).filter(c => isFinite(c.lat) && isFinite(c.lon));
}

// Real alternatives: the best match plus any place in another country that is nearly as important
function rivals(list) {
  if (!list.length) return [];
  const best = list[0].importance || 0;
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (out.length && (c.importance || 0) < best * RIVAL_RATIO) continue;
    const k = c.country_code || c.osm;
    if (seen.has(k)) continue;
    seen.add(k); out.push(c);
  }
  return out;
}

function km(a, b) {
  const r = Math.PI / 180, s = Math.sin, c = Math.cos;
  const h = s((b.lat - a.lat) * r / 2) ** 2 + c(a.lat * r) * c(b.lat * r) * s((b.lon - a.lon) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// The pairing of candidates that is clearly nearest (under half the distance of the next pairing), or null
function closest(oR, dR) {
  const pairs = [];
  for (const a of oR) for (const b of dR) pairs.push([a, b, km(a, b)]);
  pairs.sort((x, y) => x[2] - y[2]);
  return pairs.length > 1 && pairs[0][2] < pairs[1][2] * 0.5 ? pairs[0] : null;
}

// Pick one place for each end. A name that is ambiguous across countries is settled by the other end
// (Lagos -> Ibadan means Lagos, Nigeria); if it still cannot be settled, refuse with the options.
function choosePair(originList, destList, originQuery, destQuery) {
  if (!originList.length) throw new AnswerError(404, `No place called "${originQuery}" was found on OpenStreetMap.`);
  if (!destList.length) throw new AnswerError(404, `No place called "${destQuery}" was found on OpenStreetMap.`);
  const oR = originList.fixed ? [originList[0]] : rivals(originList);
  const dR = destList.fixed ? [destList[0]] : rivals(destList);
  const notes = [];
  let o = oR[0], d = dR[0];
  if (oR.length > 1 || dR.length > 1) {
    const shared = [];
    for (const a of oR) for (const b of dR)
      if (a.country_code && a.country_code === b.country_code) shared.push([a, b, (a.importance || 0) + (b.importance || 0)]);
    shared.sort((x, y) => y[2] - x[2]);
    if (shared.length) {
      [o, d] = shared[0];
      if (oR.length > 1) notes.push(`"${originQuery}" also matches places in ${oR.filter(c => c !== o).map(c => c.country).join(', ')}; the one in ${o.country} was used because ${destQuery} is there too.`);
      if (dR.length > 1) notes.push(`"${destQuery}" also matches places in ${dR.filter(c => c !== d).map(c => c.country).join(', ')}; the one in ${d.country} was used because ${originQuery} is there too.`);
    } else if (closest(oR, dR)) {
      const c = closest(oR, dR);
      [o, d] = c;
      const other = (list, pick, q) => list.length > 1 ? [`"${q}" also matches places in ${list.filter(x => x !== pick).map(x => x.country).join(', ')}; the one in ${pick.country} was used because it is far closer to the other end of the route.`] : [];
      notes.push(...other(oR, o, originQuery), ...other(dR, d, destQuery));
    } else {
      const side = oR.length > 1 ? [originQuery, oR, 'origin'] : [destQuery, dR, 'destination'];
      throw new AnswerError(422,
        `"${side[0]}" matches places in ${side[1].length} countries (${side[1].map(c => c.country).join(', ')}), and the other end of the route does not settle which one is meant. Name the country, for example "${side[0]}, ${side[1][0].country}".`,
        { ambiguous: side[2], options: side[1].map(c => ({ name: c.name, country: c.country, lat: c.lat, lon: c.lon })) });
    }
  }
  return { o, d, notes };
}

async function resolvePlaces(originQuery, destQuery) {
  const oFixed = parseCoords(originQuery), dFixed = parseCoords(destQuery);
  let oList, dList;
  if (oFixed) { oList = [oFixed]; oList.fixed = true; } else oList = await candidates(originQuery);
  if (dFixed) { dList = [dFixed]; dList.fixed = true; }
  else { if (!oFixed) await sleep(config.geocodeGapMs); dList = await candidates(destQuery); }
  return choosePair(oList, dList, originQuery, destQuery);
}

// --- routing ---------------------------------------------------------------------------------

async function carRoute(o, d) {
  const url = `${OSRM}/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false&alternatives=false&steps=false`;
  const j = await getJson(url, 6 * 3600000, 'The OSRM routing server');
  if (j.code === 'NoRoute' || (j.code === 'Ok' && !j.routes?.length))
    throw new AnswerError(404, 'There is no driving route between these two places (they may be separated by sea).');
  if (j.code !== 'Ok') throw new AnswerError(502, `The OSRM routing server could not route this (${j.code}${j.message ? ': ' + j.message : ''}).`);
  return { seconds: j.routes[0].duration, metres: j.routes[0].distance, source_url: url };
}

function valhallaBody(o, d, costing, extra = {}) {
  return JSON.stringify({ locations: [{ lat: o.lat, lon: o.lon }, { lat: d.lat, lon: d.lon }], costing, units: 'kilometers', directions_type: 'none', ...extra });
}
async function valhalla(path, body) {
  return getJson(`${VALHALLA}/${path}`, 6 * 3600000, 'The Valhalla routing server',
    { method: 'POST', body, headers: { 'content-type': 'application/json' } });
}

// Countries in the order the route passes through them. Valhalla's trace_attributes returns an
// `admins` list and, for each road segment, `end_node.admin_index` pointing into it (checked live 28 Nov).
const regionName = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
  return (code, fallback) => { try { return (dn && dn.of(code)) || fallback || code; } catch { return fallback || code; } };
})();
async function borders(shape) {
  const j = await valhalla('trace_attributes', JSON.stringify({
    shape_match: 'edge_walk', encoded_polyline: shape, costing: 'auto',
    filters: { attributes: ['admin.country_code', 'admin.country_text', 'node.admin_index'], action: 'include' },
  }));
  if (!Array.isArray(j.admins) || !Array.isArray(j.edges) || !j.edges.length) throw new AnswerError(502, 'Valhalla returned no country data for the route.');
  const order = [];
  for (const e of j.edges) {
    const i = e.end_node?.admin_index ?? e.admin_index;
    const a = j.admins[i];
    if (!a || !a.country_code) continue;
    if (order[order.length - 1]?.code !== a.country_code) order.push({ code: a.country_code, name: regionName(a.country_code, a.country_text) });
  }
  if (!order.length) throw new AnswerError(502, 'Valhalla returned no country names for the route.');
  return order;
}

// Truck time, ferry flag and borders are extras: if Valhalla fails, the car answer still stands.
async function extras(o, d) {
  const out = { truck_duration: null, has_ferry: null, countries_on_route: null, border_crossings: null, notes: [] };
  const [auto, truck] = await Promise.allSettled([
    valhalla('route', valhallaBody(o, d, 'auto')),
    valhalla('route', valhallaBody(o, d, 'truck')),
  ]);
  if (truck.status === 'fulfilled' && truck.value.trip?.summary) out.truck_duration = Math.round(truck.value.trip.summary.time);
  else out.notes.push('The truck time could not be computed by Valhalla.');
  const trip = auto.status === 'fulfilled' ? auto.value.trip : null;
  if (trip?.summary) out.has_ferry = !!trip.summary.has_ferry;
  const shape = trip?.legs?.[0]?.shape;
  if (shape) {
    try {
      const order = await borders(shape);
      out.countries_on_route = order.map(c => c.name);
      out.border_crossings = order.slice(1).map((c, i) => ({ from: order[i].name, to: c.name }));
    } catch (e) { out.notes.push(`The border list could not be read from Valhalla (${e.message}).`); }
  } else out.notes.push('The border list could not be computed because Valhalla returned no route.');
  return out;
}

// --- answer ----------------------------------------------------------------------------------

function fmt(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

async function answer(params) {
  const originQuery = String(params.origin || params.from || '').trim();
  const destQuery = String(params.destination || params.to || '').trim();
  if (!originQuery || !destQuery) throw new AnswerError(400, 'Both origin and destination are required, as place names or as latitude,longitude.');
  if (originQuery.length > 256 || destQuery.length > 256) throw new AnswerError(400, 'Origin and destination must each be at most 256 characters.');

  const { o, d, notes } = await resolvePlaces(originQuery, destQuery);
  const car = await carRoute(o, d);
  const x = await extras(o, d);
  const duration = Math.round(car.seconds);
  if (!(duration >= 1 && duration <= 1000000)) throw new AnswerError(404, `The driving time (${duration} s) is outside the range this Intent accepts.`);

  const crossings = x.border_crossings;
  const borderText = crossings == null ? 'The border list is not available for this answer.'
    : crossings.length === 0 ? `The route stays inside ${x.countries_on_route[0] || 'one country'}.`
    : `The route crosses ${crossings.length} border${crossings.length > 1 ? 's' : ''}: ${crossings.map(c => `${c.from} to ${c.to}`).join(', ')}.`;
  const place = p => ({ query: p.query, name: p.name, country: p.country || null, country_code: p.country_code, lat: p.lat, lon: p.lon });

  return {
    duration,
    distance_m: Math.round(car.metres),
    origin: place({ ...o, query: originQuery }),
    destination: place({ ...d, query: destQuery }),
    border_crossings: crossings,
    countries_on_route: x.countries_on_route,
    truck_duration: x.truck_duration,
    has_ferry: x.has_ferry,
    profile: 'car, no live traffic (OSRM on OpenStreetMap)',
    truck_profile: x.truck_duration == null ? null : "Valhalla's default truck profile, no live traffic",
    source_url: car.source_url,
    sources: ['OpenStreetMap Nominatim (places)', 'OSRM (car route)', 'Valhalla on FOSSGIS (truck route, ferry, borders)'],
    attribution: '© OpenStreetMap contributors',
    verdict: 'found',
    confidence: notes.length ? 0.9 : 1,
    reason: `Driving ${originQuery} to ${destQuery} takes about ${fmt(duration)} by car (${Math.round(car.metres / 1000)} km)`
      + (x.truck_duration != null ? ` and about ${fmt(x.truck_duration)} by truck` : '') + `. ${borderText}`
      + (x.has_ferry ? ' The route uses a ferry.' : '')
      + (notes.length ? ' ' + notes.join(' ') : '') + (x.notes.length ? ' ' + x.notes.join(' ') : ''),
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
    res.end(JSON.stringify({ verdict: status === 422 ? 'ambiguous' : 'not_found', confidence: 0, error: e.message, reason: e.message, ...(e.extra || {}), checked_at: iso(new Date()) }));
  }
}

export { answer, parseCoords, rivals, choosePair, closest, km, borders, AnswerError, cache, config };
