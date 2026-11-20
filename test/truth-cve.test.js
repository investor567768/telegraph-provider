import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, normaliseId, cache } from '../api/truth/cve.js';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function mockFetch(routes) {
  globalThis.fetch = async url => {
    for (const [part, resp] of routes) if (url.includes(part)) return typeof resp === 'function' ? resp() : resp;
    throw new Error('unexpected url ' + url);
  };
}

// Shape copied from the real NVD record for CVE-2021-44228 (checked 20 Nov 2026):
// NIST Primary 3.1 = 10.0, Apache Secondary 3.1 = 10.0, v2 = 9.3
const LOG4J = { vulnerabilities: [{ cve: {
  id: 'CVE-2021-44228', published: '2021-12-10T10:15:09.143', vulnStatus: 'Analyzed',
  descriptions: [{ lang: 'en', value: 'Apache Log4j2 JNDI features ...' }],
  references: [{ url: 'https://logging.apache.org/log4j/2.x/security.html' }],
  metrics: {
    cvssMetricV31: [
      { source: 'nvd@nist.gov', type: 'Primary', cvssData: { version: '3.1', baseScore: 10.0, baseSeverity: 'CRITICAL' } },
      { source: '134c704f-9b21-4f2e-91b3-4a467353bcc0', type: 'Secondary', cvssData: { version: '3.1', baseScore: 10.0, baseSeverity: 'CRITICAL' } },
    ],
    cvssMetricV2: [{ source: 'nvd@nist.gov', type: 'Primary', cvssData: { version: '2.0', baseScore: 9.3 } }],
  },
} }] };

test('normalises CVE ids', () => {
  assert.equal(normaliseId('cve 2021 44228'), 'CVE-2021-44228');
  assert.equal(normaliseId('What is CVE-2024-3094?'), 'CVE-2024-3094');
  assert.throws(() => normaliseId('log4j'), /CVE-YYYY-NNNN/);
});

test('Log4Shell: NIST primary 3.1 score', async () => {
  cache.clear();
  mockFetch([['nvd.nist.gov', json(LOG4J)]]);
  const a = await answer({ cve_id: 'CVE-2021-44228' });
  assert.equal(a.cvss_base_score, 10.0);
  assert.equal(a.cvss_score, 10.0);
  assert.equal(a.severity, 'CRITICAL');
  assert.equal(a.score_source, 'NIST NVD');
  assert.equal(a.cvss_version, '3.1');
});

test('prefers NIST score even when a CNA score is listed first', async () => {
  cache.clear();
  const rec = structuredClone(LOG4J);
  rec.vulnerabilities[0].cve.metrics.cvssMetricV31 = [
    { source: 'cna@example.org', type: 'Secondary', cvssData: { baseScore: 7.5, baseSeverity: 'HIGH' } },
    { source: 'nvd@nist.gov', type: 'Primary', cvssData: { baseScore: 9.8, baseSeverity: 'CRITICAL' } },
  ];
  mockFetch([['nvd.nist.gov', json(rec)]]);
  assert.equal((await answer({ cve_id: 'CVE-2099-0001' })).cvss_base_score, 9.8);
});

test('not yet scored by NIST: CNA score in the NVD record', async () => {
  cache.clear();
  const rec = structuredClone(LOG4J);
  rec.vulnerabilities[0].cve.vulnStatus = 'Awaiting Analysis';
  rec.vulnerabilities[0].cve.metrics = { cvssMetricV40: [{ source: 'cna@example.org', type: 'Secondary', cvssData: { baseScore: 8.7, baseSeverity: 'HIGH' } }] };
  mockFetch([['nvd.nist.gov', json(rec)]]);
  const a = await answer({ cve_id: 'CVE-2099-0002' });
  assert.equal(a.cvss_base_score, 8.7);
  assert.equal(a.cvss_version, '4.0');
  assert.match(a.score_source, /^CNA via NVD/);
});

test('no score in NVD: falls back to CVE.org CNA score', async () => {
  cache.clear();
  const nvd = { vulnerabilities: [{ cve: { id: 'CVE-2099-0003', vulnStatus: 'Received', metrics: {}, descriptions: [], references: [] } }] };
  const org = { cveMetadata: { state: 'PUBLISHED', datePublished: '2099-01-01T00:00:00Z' }, containers: {
    cna: { metrics: [{ cvssV3_1: { baseScore: 6.1, baseSeverity: 'MEDIUM' } }], descriptions: [{ lang: 'en', value: 'XSS' }], references: [{ url: 'https://example.org' }] } } };
  mockFetch([['nvd.nist.gov', json(nvd)], ['cveawg.mitre.org', json(org)]]);
  const a = await answer({ cve_id: 'CVE-2099-0003' });
  assert.equal(a.cvss_base_score, 6.1);
  assert.equal(a.score_source, 'CNA via CVE.org');
  assert.equal(a.description, 'XSS');
});

test('unknown CVE is 404, rejected CVE is 404, rate limit is 503', async () => {
  cache.clear();
  mockFetch([['nvd.nist.gov', json({ vulnerabilities: [] })], ['cveawg.mitre.org', json({}, 404)]]);
  await assert.rejects(answer({ cve_id: 'CVE-2099-9999' }), e => e.status === 404);
  mockFetch([['nvd.nist.gov', json({ vulnerabilities: [{ cve: { id: 'x', vulnStatus: 'Rejected', metrics: {} } }] })]]);
  await assert.rejects(answer({ cve_id: 'CVE-2099-9998' }), e => e.status === 404 && /rejected/.test(e.message));
  mockFetch([['nvd.nist.gov', json({}, 403)]]);
  await assert.rejects(answer({ cve_id: 'CVE-2099-9997' }), e => e.status === 503);
});
