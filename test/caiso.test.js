import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { answer, resolveLocation, unzipFirst, cache } from '../api/grid-price.js';

// build a one-file zip the way OASIS does (deflate, sizes in the central directory)
function zip(name, text) {
  const data = deflateRawSync(Buffer.from(text)), n = Buffer.from(name), raw = Buffer.from(text);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = 30 + n.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12); eocd.writeUInt32LE(cdOff, 16);
  return Buffer.concat([local, n, data, cd, n, eocd]);
}
const H = 'INTERVALSTARTTIME_GMT,INTERVALENDTIME_GMT,OPR_DT,OPR_HR,OPR_INTERVAL,NODE_ID_XML,NODE_ID,NODE,MARKET_RUN_ID,LMP_TYPE,XML_DATA_ITEM,PNODE_RESMRID,GRP_TYPE,POS,MW,GROUP';
// the real OASIS file for TH_NP15_GEN-APND, DAM, hour starting 2026-09-13T14:00Z (downloaded 19 Nov 2026)
const row = (type, item, v, g) => `2026-09-13T14:00:00-00:00,2026-09-13T15:00:00-00:00,2026-09-13,8,0,TH_NP15_GEN-APND,TH_NP15_GEN-APND,TH_NP15_GEN-APND,DAM,${type},${item},TH_NP15_GEN-APND,ALL_APNODES,0,${v},${g}`;
const CSV = [H, row('LMP', 'LMP_PRC', 38.09459, 1), row('MCC', 'LMP_CONG_PRC', -0.26689, 2), row('MCE', 'LMP_ENE_PRC', 27.70032, 3),
  row('MCL', 'LMP_LOSS_PRC', 0.20224, 4), row('MGHG', 'LMP_GHG_PRC', 10.45891, 5)].join('\n') + '\n';

function mock(body) {
  cache.clear();
  globalThis.__urls = [];
  globalThis.fetch = async url => { globalThis.__urls.push(url); return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) }; };
}

test('unzip reads the CSV back', () => {
  assert.equal(unzipFirst(zip('a.csv', 'hello')).text, 'hello');
});

test('CAISO names resolve', () => {
  assert.deepEqual(resolveLocation('TH_SP15_GEN-APND'), { operator: 'CAISO', name: 'TH_SP15_GEN-APND' });
  assert.equal(resolveLocation('CAISO NP15').name, 'TH_NP15_GEN-APND');
  assert.equal(resolveLocation('SP15').name, 'TH_SP15_GEN-APND');
  assert.equal(resolveLocation('Northern California').name, 'TH_NP15_GEN-APND');
  assert.equal(resolveLocation('CAISO').defaulted, true);
  assert.equal(resolveLocation('caiso DLAP_PGAE-APND').name, 'DLAP_PGAE-APND');
  assert.equal(resolveLocation('N.Y.C.').operator, 'NYISO');   // unchanged
  assert.equal(resolveLocation('MISO Indiana hub').name, 'INDIANA.HUB'); // unchanged
  assert.throws(() => resolveLocation('ISO-NE'), /ISO NE is not covered/);
});

test('CAISO day-ahead answer for the Intent question (no location, hour 14:00Z)', async () => {
  mock(zip('PRC_LMP.csv', CSV));
  const a = await answer({ node_or_zone: 'CAISO', interval_start: '2026-09-13T14:00:00Z' });
  assert.equal(a.lmp_usd_per_mwh, 38.09459);
  assert.equal(a.interval_start, '2026-09-13T14:00:00Z');
  assert.equal(a.interval_end, '2026-09-13T15:00:00Z');
  assert.equal(a.market, 'CAISO day-ahead hourly LMP (DAM)');
  assert.equal(a.marginal_cost_congestion_usd_per_mwh, -0.26689);
  assert.equal(a.marginal_cost_losses_usd_per_mwh, 0.20224);
  assert.equal(a.marginal_cost_energy_usd_per_mwh, 27.70032);
  assert.equal(a.marginal_cost_ghg_usd_per_mwh, 10.45891);
  assert.match(a.reason, /NP15 trading hub/);
  assert.match(globalThis.__urls[0], /startdatetime=20260913T14:00-0000&enddatetime=20260913T15:00-0000/);
  assert.match(globalThis.__urls[0], /node=TH_NP15_GEN-APND/);
});

test('a time inside the hour selects that hour', async () => {
  mock(zip('PRC_LMP.csv', CSV));
  const a = await answer({ node_or_zone: 'NP15', interval_start: '2026-09-13T14:37:00Z' });
  assert.equal(a.lmp_usd_per_mwh, 38.09459);
});

test('OASIS XML error becomes a clear 404', async () => {
  mock(zip('error.xml', '<m:OASISReport><m:ERR_CODE>1000</m:ERR_CODE><m:ERR_DESC>No data returned for the specified selection</m:ERR_DESC></m:OASISReport>'));
  await assert.rejects(answer({ node_or_zone: 'CAISO', interval_start: '2020-01-01T00:00:00Z' }), /No data returned/);
});

test('CAISO real-time is refused honestly', async () => {
  mock(zip('PRC_LMP.csv', CSV));
  await assert.rejects(answer({ node_or_zone: 'CAISO NP15', market: 'real_time', interval_start: '2026-09-13T14:00:00Z' }), /real-time prices are not covered/);
});

test('ERCOT names are refused, never mapped to NYISO WEST/NORTH (bug found 20 Nov)', () => {
  for (const x of ['HB_WEST', 'LZ_WEST', 'HB_NORTH', 'HB_HOUSTON', 'ERCOT Houston hub', 'west texas'])
    assert.throws(() => resolveLocation(x), /ERCOT \(Texas\) is not covered/);
  assert.throws(() => resolveLocation('WEST'), /Could not match/);          // ambiguous without NYISO
  assert.equal(resolveLocation('NYISO WEST').name, 'WEST');
  assert.equal(resolveLocation('NYISO zone A').name, 'WEST');
  assert.equal(resolveLocation('MISO TEXAS.HUB').name, 'TEXAS.HUB');    // MISO's Texas hub still works
});

// Throttling (reported by independent tester Jennycruzy, 26 Nov 2026): OASIS sometimes answers a
// burst with HTTP 429 or XML error 1015. The miner waits and retries instead of failing.
test('CAISO: a throttled request is retried and answered', async () => {
  const { retry } = await import('../api/grid-price.js');
  const waits = []; retry.sleep = async ms => { waits.push(ms); };
  cache.clear(); globalThis.__urls = [];
  const good = zip('PRC_LMP.csv', CSV), busy = zip('err.xml', '<m:ERR_CODE>1015</m:ERR_CODE><m:ERR_DESC>Too many requests</m:ERR_DESC>');
  const replies = [{ status: 429 }, { status: 200, body: busy }, { status: 200, body: good }];
  globalThis.fetch = async url => { globalThis.__urls.push(url); const r = replies.shift();
    return { ok: r.status === 200, status: r.status, arrayBuffer: async () => r.body.buffer.slice(r.body.byteOffset, r.body.byteOffset + r.body.length) }; };
  const a = await answer({ node_or_zone: 'CAISO', interval_start: '2026-09-13T14:00:00Z' });
  assert.equal(a.lmp_usd_per_mwh, 38.09459);
  assert.deepEqual(waits, [2000, 4000]);
  assert.equal(globalThis.__urls.length, 3);
});

test('CAISO: still throttled after two retries gives a clear error, not a wrong price', async () => {
  const { retry } = await import('../api/grid-price.js');
  retry.sleep = async () => {};
  cache.clear();
  globalThis.fetch = async () => ({ ok: false, status: 429, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(answer({ node_or_zone: 'CAISO', interval_start: '2026-09-13T14:00:00Z' }), e => e.status === 503 && /still busy after two retries/.test(e.message));
});
