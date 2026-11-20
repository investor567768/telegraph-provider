// Truth source for Telegraph evaluators: CVE severity scores.
// Intents: VULNERABILITY_TRIAGE_GENERAL (answer: cvss_base_score) and CVE_LOOKUP_CVSS
// (answer: cve_id, cvss_score, severity, description, published, references).
//
// Sources (no API key):
//   1. NIST National Vulnerability Database:  https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=...
//      We take NIST's own score on purpose (source nvd@nist.gov), newest CVSS version first:
//      v3.1, then v4.0, then v3.0. If NIST has not scored it, we take the reporting organisation's
//      (CNA) score listed in the same NVD record.
//   2. If NVD has no score at all, the official CVE record at CVE.org:
//      https://cveawg.mitre.org/api/cve/<id>  (CNA score, then CISA's ADP score).
// The answer always says which organisation's score it is (score_source) and which CVSS version.

const NVD = id => `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`;
const CVEORG = id => `https://cveawg.mitre.org/api/cve/${id}`;
const UA = { 'user-agent': 'telegraph-provider/1.0 (+https://github.com/investor567768)' };
const TTL = 6 * 3600 * 1000;
const cache = new Map();

class AnswerError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function normaliseId(raw) {
  const m = String(raw || '').toUpperCase().replace(/[‐-―]/g, '-').match(/CVE[-_\s]?(\d{4})[-_\s]?(\d{4,7})/);
  if (!m) throw new AnswerError(400, 'cve_id is required, in the form CVE-YYYY-NNNN, for example CVE-2021-44228.');
  return `CVE-${m[1]}-${m[2]}`;
}

async function getJson(url, who) {
  let r;
  try { r = await fetch(url, { headers: UA }); }
  catch (e) { throw new AnswerError(502, `${who} could not be reached. Try again shortly.`); }
  if (r.status === 404) return null;
  if (r.status === 403 || r.status === 429 || r.status === 503) throw new AnswerError(503, `${who} is limiting requests. Try again in about 30 seconds.`);
  if (!r.ok) throw new AnswerError(502, `${who} answered HTTP ${r.status}.`);
  return r.json();
}

const ORDER = [['cvssMetricV31', '3.1'], ['cvssMetricV40', '4.0'], ['cvssMetricV30', '3.0']];

function pickNvd(metrics = {}) {
  // NIST's own score first, any version; then the reporting organisation's.
  for (const nist of [true, false]) {
    for (const [key, version] of ORDER) {
      const m = (metrics[key] || []).find(x => (x.source === 'nvd@nist.gov') === nist && x.cvssData && isFinite(x.cvssData.baseScore));
      if (m) return { score: m.cvssData.baseScore, severity: m.cvssData.baseSeverity, version, source: nist ? 'NIST NVD' : `CNA via NVD (${m.source})` };
    }
  }
  return null;
}

function pickCveOrg(rec) {
  const c = rec && rec.containers || {};
  const sets = [['CNA', c.cna && c.cna.metrics], ...((c.adp || []).map(a => [`ADP ${a.providerMetadata && a.providerMetadata.shortName || ''}`.trim(), a.metrics]))];
  for (const [who, metrics] of sets) {
    for (const [key, version] of [['cvssV3_1', '3.1'], ['cvssV4_0', '4.0'], ['cvssV3_0', '3.0']]) {
      const m = (metrics || []).find(x => x[key] && isFinite(x[key].baseScore));
      if (m) return { score: m[key].baseScore, severity: m[key].baseSeverity, version, source: `${who} via CVE.org` };
    }
  }
  return null;
}

async function answer(params) {
  const id = normaliseId(params.cve_id || params.cveId || params.cve);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const nvd = await getJson(NVD(id), 'The National Vulnerability Database');
  const v = nvd && nvd.vulnerabilities && nvd.vulnerabilities[0] && nvd.vulnerabilities[0].cve;
  let pick = v ? pickNvd(v.metrics) : null;
  let description = v && ((v.descriptions || []).find(d => d.lang === 'en') || {}).value;
  let published = v && v.published;
  let references = v ? (v.references || []).map(r => r.url).slice(0, 10) : [];
  let rejected = v && /reject/i.test(v.vulnStatus || '');

  if (!pick && !rejected) {
    const rec = await getJson(CVEORG(id), 'CVE.org');
    if (!v && !rec) throw new AnswerError(404, `${id} was not found in the National Vulnerability Database or at CVE.org.`);
    if (rec) {
      if (rec.cveMetadata && rec.cveMetadata.state === 'REJECTED') rejected = true;
      pick = pickCveOrg(rec);
      const cna = rec.containers && rec.containers.cna || {};
      description = description || ((cna.descriptions || []).find(d => /^en/.test(d.lang)) || {}).value;
      published = published || (rec.cveMetadata && rec.cveMetadata.datePublished);
      if (!references.length) references = (cna.references || []).map(r => r.url).slice(0, 10);
    }
  }
  if (rejected) throw new AnswerError(404, `${id} has been rejected (withdrawn) by the CVE program, so it has no score.`);
  if (!pick) throw new AnswerError(404, `${id} exists but has not been given a CVSS score by NIST or by the organisation that reported it yet.`);

  const value = {
    cve_id: id,
    cvss_score: pick.score,
    cvss_base_score: pick.score,
    severity: pick.severity ? String(pick.severity).toUpperCase() : null,
    cvss_version: pick.version,
    score_source: pick.source,
    description: description || null,
    published: published || null,
    references,
    source_url: `https://nvd.nist.gov/vuln/detail/${id}`,
    checked_at: new Date().toISOString(),
  };
  cache.set(id, { at: Date.now(), value });
  return value;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');
  try {
    const out = await answer(Object.fromEntries(url.searchParams.entries()));
    res.setHeader('cache-control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = e instanceof AnswerError ? e.status : 500;
    res.end(JSON.stringify({ error: e.message, checked_at: new Date().toISOString() }));
  }
}

export { answer, normaliseId, pickNvd, pickCveOrg, AnswerError, cache };
