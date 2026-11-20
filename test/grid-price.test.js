import test from 'node:test';
import assert from 'node:assert/strict';
import { answer, resolveLocation, easternToUtc, cache } from '../api/grid-price.js';

// Sample data copied from the operators' live files on 19 Nov 2026 (screenshots in the evaluator repo)
const NYISO_LATEST = `"Time Stamp","Name","PTID","LBMP ($/MWHr)","Marginal Cost Losses ($/MWHr)","Marginal Cost Congestion ($/MWHr)"
"11/19/2026 07:10:00","WEST",61752,36.49,-4.24,14.33
"11/19/2026 07:10:00","CAPITL",61757,57.37,2.31,0.00
"11/19/2026 07:10:00","N.Y.C.",61761,58.40,3.63,0.29
"11/19/2026 07:10:00","LONGIL",61762,59.57,4.52,0.00
`;
const NYISO_DAY = `"Time Stamp","Name","PTID","LBMP ($/MWHr)","Marginal Cost Losses ($/MWHr)","Marginal Cost Congestion ($/MWHr)"
"11/19/2026 07:05:00","N.Y.C.",61761,51.00,3.00,0.00
"11/19/2026 07:10:00","N.Y.C.",61761,58.40,3.63,0.29
"11/19/2026 07:15:00","N.Y.C.",61761,60.10,3.70,0.00
`;
const MISO = JSON.stringify({ headers: ['INTERVAL', 'CPNODE', 'LMP', 'MLC', 'MCC'], data: [
  ['2026-11-19T00:00:00', 'WEC.OAKCREKC5', '16.86', '0.53', '-2.95'],
  ['2026-11-19T00:00:00', 'INDIANA.HUB', '24.10', '0.80', '1.10'],
  ['2026-11-19T00:05:00', 'INDIANA.HUB', '25.40', '0.81', '1.20'],
]});

function mockFetch(map) {
  globalThis.fetch = async (url) => {
    const body = Object.entries(map).find(([k]) => url.includes(k));
    if (!body) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body[1] };
  };
}
test.beforeEach(() => { cache.clear(); mockFetch({ 'realtime_zone_lbmp.csv': NYISO_LATEST, '20261119realtime_zone.csv': NYISO_DAY, 'Rolling': MISO }); });

test('names map to the right operator and zone', () => {
  assert.deepEqual(resolveLocation('N.Y.C.'), { operator: 'NYISO', name: 'N.Y.C.' });
  assert.deepEqual(resolveLocation('NYISO zone J'), { operator: 'NYISO', name: 'N.Y.C.' });
  assert.deepEqual(resolveLocation('New York City'), { operator: 'NYISO', name: 'N.Y.C.' });
  assert.deepEqual(resolveLocation('Long Island'), { operator: 'NYISO', name: 'LONGIL' });
  assert.deepEqual(resolveLocation('Capital'), { operator: 'NYISO', name: 'CAPITL' });
  assert.deepEqual(resolveLocation('MISO Indiana Hub'), { operator: 'MISO', name: 'INDIANA.HUB' });
  assert.deepEqual(resolveLocation('INDIANA.HUB'), { operator: 'MISO', name: 'INDIANA.HUB' });
  assert.deepEqual(resolveLocation('wec.oakcrekc5'), { operator: 'MISO', name: 'WEC.OAKCREKC5' });
  assert.throws(() => resolveLocation('ERCOT Houston hub'), /ERCOT \(Texas\) is not covered/);
  assert.throws(() => resolveLocation('Mars'), /Could not match/);
  assert.throws(() => resolveLocation(''), /required/);
});

test('Eastern time converts to UTC across the DST change', () => {
  assert.equal(easternToUtc(2026, 11, 19, 7, 10).toISOString(), '2026-11-19T12:10:00.000Z'); // EST
  assert.equal(easternToUtc(2026, 7, 1, 7, 10).toISOString(), '2026-07-01T11:10:00.000Z');   // EDT
});

test('NYISO latest: value, interval start = stamp minus 5 min, USD', async () => {
  const a = await answer({ node_or_zone: 'NYC' });
  assert.equal(a.lmp_usd_per_mwh, 58.40);
  assert.equal(a.node_or_zone, 'N.Y.C.');
  assert.equal(a.interval_start, '2026-11-19T12:05:00Z');
  assert.equal(a.interval_end, '2026-11-19T12:10:00Z');
  assert.equal(a.currency, 'USD');
  assert.match(a.market, /NYISO real-time/);
});

test('NYISO with interval_start picks the interval that contains it', async () => {
  const a = await answer({ node_or_zone: 'N.Y.C.', interval_start: '2026-11-19T12:07:00Z' });
  assert.equal(a.lmp_usd_per_mwh, 58.40);
  const b = await answer({ node_or_zone: 'N.Y.C.', interval_start: '2026-11-19T12:10:00Z' });
  assert.equal(b.lmp_usd_per_mwh, 60.10);
  await assert.rejects(answer({ node_or_zone: 'N.Y.C.', interval_start: '2026-11-19T15:00:00Z' }), /No NYISO real-time interval/);
});

test('MISO latest and by time, EST is UTC-5', async () => {
  const a = await answer({ node_or_zone: 'Indiana hub' });
  assert.equal(a.lmp_usd_per_mwh, 25.40);
  assert.equal(a.interval_start, '2026-11-19T05:05:00Z');
  const b = await answer({ node_or_zone: 'INDIANA.HUB', interval_start: '2026-11-19T05:02:00Z' });
  assert.equal(b.lmp_usd_per_mwh, 24.10);
  await assert.rejects(answer({ node_or_zone: 'MISO NOPE.HUB' }), /no price for node NOPE.HUB/);
});

test('bad inputs give clear errors, not wrong answers', async () => {
  await assert.rejects(answer({ node_or_zone: 'NYC', interval_start: 'yesterday-ish' }), /not a date/);
  await assert.rejects(answer({ node_or_zone: 'MISO Indiana hub', market: 'day ahead' }), /only available for NYISO/);
  globalThis.fetch = async () => { throw new Error('down'); };
  cache.clear();
  await assert.rejects(answer({ node_or_zone: 'NYC' }), /could not be reached/);
});
