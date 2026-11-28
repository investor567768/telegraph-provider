import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { answer, parseCoords, rivals, cache, config } from '../api/route-eta.js';

// Shapes follow the public Nominatim, OSRM and Valhalla answers. Numbers are illustrative.
const place = (name, lat, lon, cc, country, importance, id) =>
  ({ display_name: name, lat: String(lat), lon: String(lon), importance, osm_type: 'relation', osm_id: id, address: { country_code: cc, country } });
const PLACES = {
  'q=Lagos': [place('Lagos, Nigeria', 6.4550, 3.3941, 'ng', 'Nigeria', 0.74, 1), place('Lagos, Faro, Portugal', 37.1028, -8.6730, 'pt', 'Portugal', 0.62, 2)],
  'q=Ibadan': [place('Ibadan, Oyo State, Nigeria', 7.3776, 3.9470, 'ng', 'Nigeria', 0.66, 3)],
  'q=Accra': [place('Accra, Greater Accra Region, Ghana', 5.5600, -0.2057, 'gh', 'Ghana', 0.70, 4)],
  'q=Nowhereville': [],
};
const OSRM_OK = { code: 'Ok', routes: [{ duration: 7012.4, distance: 128400.2 }] };
const trip = (time, withAdmins = false) => ({ trip: {
  summary: { time, length: 128.4, has_ferry: false }, legs: [{ shape: 'encoded_shape' }],
} });
let countries = [['NG', 'Nigeria']];
let valhallaDown = false;
let osrm = OSRM_OK;

test.beforeEach(() => {
  cache.clear(); config.geocodeGapMs = 0; countries = [['NG', 'Nigeria']]; valhallaDown = false; osrm = OSRM_OK;
  globalThis.fetch = async (url, init = {}) => {
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
    if (url.includes('nominatim')) {
      const k = Object.keys(PLACES).find(k => url.includes(k));
      return reply(200, k ? PLACES[k] : []);
    }
    if (url.includes('router.project-osrm.org')) return reply(osrm.code === 'Ok' ? 200 : 400, osrm);
    if (url.includes('valhalla')) {
      if (valhallaDown) return reply(503, { error: 'down' });
      const body = JSON.parse(init.body);
      // Shape seen live: admins repeat, each edge points at one through end_node.admin_index
      if (url.endsWith('/trace_attributes')) return reply(200, {
        units: 'kilometers',
        admins: countries.flatMap(([c, n]) => [{ country_code: c, country_text: n }, { country_code: c, country_text: n }]),
        edges: countries.flatMap((_, i) => [{ end_node: { admin_index: 2 * i } }, { end_node: { admin_index: 2 * i + 1 } }]),
      });
      return reply(200, body.costing === 'truck' ? trip(9100.6) : trip(7200));
    }
    return reply(404, {});
  };
});

test('coordinates are read latitude first, with or without a name', () => {
  assert.deepEqual(parseCoords('6.5244, 3.3792'), { lat: 6.5244, lon: 3.3792, name: '6.5244,3.3792', country_code: null, from_coordinates: true });
  assert.equal(parseCoords('Lagos (6.5244, 3.3792)').name, 'Lagos');
  assert.equal(parseCoords('Lagos'), null);
  assert.equal(parseCoords('95.0, 3.0'), null);
});

test('a rival in another country counts only when it is nearly as important', () => {
  const list = [{ country_code: 'NG', importance: 0.74 }, { country_code: 'PT', importance: 0.62 }, { country_code: 'US', importance: 0.2 }];
  assert.deepEqual(rivals(list).map(c => c.country_code), ['NG', 'PT']);
});

test('Lagos to Ibadan: same-country pairing settles which Lagos, and the scored duration is whole seconds', async () => {
  const a = await answer({ origin: 'Lagos', destination: 'Ibadan' });
  assert.equal(a.duration, 7012);
  assert.equal(a.distance_m, 128400);
  assert.equal(a.origin.country, 'Nigeria');
  assert.deepEqual(a.border_crossings, []);
  assert.deepEqual(a.countries_on_route, ['Nigeria']);
  assert.equal(a.truck_duration, 9101);
  assert.equal(a.has_ferry, false);
  assert.match(a.reason, /Portugal; the one in Nigeria was used because Ibadan is there too/);
  assert.equal(a.confidence, 0.9);
});

test('Lagos to Accra: distance settles which Lagos, and every border is listed in order', async () => {
  countries = [['NG', 'Nigeria'], ['BJ', 'Bénin'], ['TG', 'Togo'], ['GH', 'Ghana']];
  const a = await answer({ origin: 'Lagos', destination: 'Accra' });
  assert.equal(a.origin.country, 'Nigeria');
  assert.deepEqual(a.border_crossings, [
    { from: 'Nigeria', to: 'Benin' }, { from: 'Benin', to: 'Togo' }, { from: 'Togo', to: 'Ghana' },
  ]);
  assert.match(a.reason, /crosses 3 borders: Nigeria to Benin, Benin to Togo, Togo to Ghana/);
  assert.match(a.reason, /far closer to the other end/);
});

test('an ambiguous name the route cannot settle is refused with the options, never guessed', async () => {
  // A point about equally far from Lagos, Nigeria and Lagos, Portugal
  await assert.rejects(answer({ origin: 'Lagos', destination: '21.8, -2.8' }), e => {
    assert.equal(e.status, 422);
    assert.match(e.message, /matches places in 2 countries \(Nigeria, Portugal\)/);
    assert.equal(e.extra.options.length, 2);
    return true;
  });
});

test('coordinates skip the place search entirely', async () => {
  const a = await answer({ origin: '6.4550,3.3941', destination: '7.3776,3.9470' });
  assert.equal(a.duration, 7012);
  assert.equal(a.origin.lat, 6.455);
});

test('no driving route (separated by sea) is a 404 with a reason', async () => {
  osrm = { code: 'NoRoute', message: 'Impossible route between points' };
  await assert.rejects(answer({ origin: 'Lagos', destination: 'Ibadan' }), e => e.status === 404 && /no driving route/.test(e.message));
});

test('an unknown place is a 404 naming it', async () => {
  await assert.rejects(answer({ origin: 'Nowhereville', destination: 'Ibadan' }), e => e.status === 404 && /Nowhereville/.test(e.message));
});

test('missing origin or destination is a 400', async () => {
  await assert.rejects(answer({ origin: 'Lagos' }), e => e.status === 400);
});

test('if Valhalla is down, the scored car time still stands and the extras say why they are missing', async () => {
  valhallaDown = true;
  const a = await answer({ origin: 'Lagos', destination: 'Ibadan' });
  assert.equal(a.duration, 7012);
  assert.equal(a.truck_duration, null);
  assert.equal(a.border_crossings, null);
  assert.match(a.reason, /truck time could not be computed/);
  assert.match(a.reason, /border list is not available/);
});

test('handler returns 422 JSON with the options for an ambiguous place', async () => {
  let status, body;
  const res = { setHeader() {}, set statusCode(s) { status = s; }, end(b) { body = JSON.parse(b); } };
  await handler({ url: '/api/route-eta?origin=Lagos&destination=21.8,-2.8' }, res);
  assert.equal(status, 422);
  assert.equal(body.verdict, 'ambiguous');
  assert.equal(body.ambiguous, 'origin');
  assert.equal(body.options[1].country, 'Portugal');
});
