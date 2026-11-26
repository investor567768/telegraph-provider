import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { answer, nyisoStampsInOrder, cache } from '../api/grid-price.js';

// Fall-back day, 1 Nov 2026: NYISO's real-time file repeats the 01:00-01:55 stamps,
// first in daylight time (EDT) and then in standard time (EST).
// Values for 01:05 are the ones an independent tester read from NYISO's own monthly zip on 26 Nov 2026.
const H = '"Time Stamp","Name","PTID","LBMP ($/MWHr)","Marginal Cost Losses ($/MWHr)","Marginal Cost Congestion ($/MWHr)"';
const row = (t, v) => `"11/01/2026 ${t}","N.Y.C.",61761,${v},1.00,0.00`;
const FALLBACK = [H, row('00:55:00', 31.00), row('01:00:00', 32.00), row('01:05:00', 33.33),
  row('01:00:00', 32.50), row('01:05:00', 33.46), row('02:00:00', 35.00)].join('\n') + '\n';

// Build a real zip in memory holding two daily files, so the reader must pick the right one by name
function zip(files) {
  const locals = [], central = []; let off = 0;
  for (const [name, text] of files) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, data); central.push(ch, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const MONTH = zip([['20261031realtime_zone.csv', H + '\n' + row('01:05:00', 99.99) + '\n'], ['20261101realtime_zone.csv', FALLBACK]]);

const asked = [];
test.beforeEach(() => {
  cache.clear(); asked.length = 0;
  globalThis.fetch = async (url) => {
    asked.push(url);
    if (url.endsWith('20261101realtime_zone_csv.zip')) {
      const ab = MONTH.buffer.slice(MONTH.byteOffset, MONTH.byteOffset + MONTH.length);
      return { ok: true, status: 200, arrayBuffer: async () => ab };
    }
    return { ok: false, status: 404, text: async () => '' }; // the daily file has been archived
  };
});

test('repeated fall-back stamps: first is EDT, second is EST', () => {
  const t = nyisoStampsInOrder(['11/01/2026 01:05:00', '11/01/2026 01:05:00', '11/01/2026 02:00:00']);
  assert.equal(t[0].toISOString(), '2026-11-01T05:05:00.000Z');
  assert.equal(t[1].toISOString(), '2026-11-01T06:05:00.000Z');
  assert.equal(t[2].toISOString(), '2026-11-01T07:00:00.000Z');
});

test('archived day is read from the monthly zip, daylight-time hour (tester case 1)', async () => {
  const a = await answer({ node_or_zone: 'NYC', interval_start: '2026-11-01T05:00:00Z' });
  assert.equal(a.lmp_usd_per_mwh, 33.33);
  assert.equal(a.interval_start, '2026-11-01T05:00:00Z');
  assert.match(a.source_url, /20261101realtime_zone_csv\.zip \(20261101realtime_zone\.csv inside\)/);
  assert.ok(asked.some(u => u.endsWith('20261101realtime_zone.csv')), 'tries the daily file first');
});

test('archived day, standard-time hour (tester case 2)', async () => {
  const a = await answer({ node_or_zone: 'NYC', interval_start: '2026-11-01T06:00:00Z' });
  assert.equal(a.lmp_usd_per_mwh, 33.46);
});

test('the right day is picked out of a zip holding several days', async () => {
  const a = await answer({ node_or_zone: 'NYC', interval_start: '2026-11-01T06:57:00Z' });
  assert.equal(a.lmp_usd_per_mwh, 35.00); // 02:00 EST stamp = interval 06:55-07:00Z
});

test('future dates are refused before any operator is called (tester case 3)', async () => {
  for (const q of [{ node_or_zone: 'CAISO', interval_start: '2027-01-01T00:00:00Z' }, { node_or_zone: 'NYC', interval_start: '2027-01-01T00:00:00Z' }]) {
    await assert.rejects(() => answer(q), e => e.status === 404 && /in the future/.test(e.message));
  }
  assert.equal(asked.length, 0);
});
