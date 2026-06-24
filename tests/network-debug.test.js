'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

function loadResp(status, body = {}, headers = '') {
  return {
    type: 'load',
    response: {
      status,
      responseText: typeof body === 'string' ? body : JSON.stringify(body),
      responseHeaders: headers
    }
  };
}

// ---------------------------------------------------------------------------
// getUrlHostPath
// ---------------------------------------------------------------------------

test('getUrlHostPath extracts host and path, dropping query string', () => {
  const a = loadUserscript();
  const r = a.getUrlHostPath('https://v3.football.api-sports.io/fixtures?apiKey=SECRET&date=2026-06-22');
  assert.equal(r.host, 'v3.football.api-sports.io');
  assert.equal(r.path, '/fixtures');
});

test('getUrlHostPath returns unknown/empty for invalid URLs', () => {
  const a = loadUserscript();
  const r = a.getUrlHostPath('not-a-url');
  assert.equal(r.host, 'unknown');
  assert.equal(r.path, '');
});

// ---------------------------------------------------------------------------
// updateNetworkStats
// ---------------------------------------------------------------------------

test('updateNetworkStats creates entry for new host', () => {
  const a = loadUserscript();
  a.updateNetworkStats('api.example.com', { status: 200, kind: 'http', ms: 120, ok: true });
  const s = a.networkStats.get('api.example.com');
  assert.equal(s.lastStatus, 200);
  assert.equal(s.lastKind, 'http');
  assert.equal(s.lastMs, 120);
  assert.equal(s.okCount, 1);
  assert.equal(s.errCount, 0);
  assert.ok(s.lastOkAt !== null);
  assert.equal(s.lastErrAt, null);
});

test('updateNetworkStats accumulates ok/err counts for same host', () => {
  const a = loadUserscript();
  a.updateNetworkStats('api.example.com', { status: 200, kind: 'http', ms: 50, ok: true });
  a.updateNetworkStats('api.example.com', { status: 403, kind: 'http', ms: 30, ok: false });
  a.updateNetworkStats('api.example.com', { status: 200, kind: 'http', ms: 80, ok: true });
  const s = a.networkStats.get('api.example.com');
  assert.equal(s.okCount, 2);
  assert.equal(s.errCount, 1);
  assert.equal(s.lastStatus, 200);
  assert.ok(s.lastOkAt !== null);
  assert.ok(s.lastErrAt !== null);
});

// ---------------------------------------------------------------------------
// gmFetchJson — network event recording
// ---------------------------------------------------------------------------

test('gmFetchJson 200: records network event and stats', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, { ok: true }, 'content-type: application/json\r\n') });
  a.gmFetchJson('https://api.example.com/data?apiKey=SECRET');
  const report = a.buildDebugReport();
  const host = report.network.byHost.find(h => h.host === 'api.example.com');
  assert.ok(host, 'host entry present');
  assert.equal(host.lastStatus, 200);
  assert.equal(host.lastKind, 'http');
  assert.equal(host.okCount, 1);
  assert.equal(host.errCount, 0);
});

test('gmFetchJson 200: query string not present in network report', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, {}) });
  a.gmFetchJson('https://api.example.com/fixtures?apiKey=TOPSECRET123&date=2026-06-22');
  const report = a.buildDebugReport();
  const str = JSON.stringify(report.network);
  assert.ok(!str.includes('TOPSECRET123'), 'query param value must not appear');
  assert.ok(!str.includes('apiKey='), 'apiKey param must not appear');
  const ev = report.network.recent[0];
  assert.equal(ev.path, '/fixtures');
  assert.equal(ev.host, 'api.example.com');
});

test('gmFetchJson 403: records error with ok=false', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(403, { message: 'Forbidden' }) });
  a.gmFetchJson('https://api.example.com/path').catch(() => {});
  const host = a.networkStats.get('api.example.com');
  assert.ok(host);
  assert.equal(host.lastStatus, 403);
  assert.equal(host.okCount, 0);
  assert.equal(host.errCount, 1);
  assert.ok(host.lastErrAt !== null);
});

test('gmFetchJson network error: records kind=network with status 0', () => {
  const a = loadUserscript({ gmXmlhttpRequest: { type: 'error' } });
  a.gmFetchJson('https://v3.football.api-sports.io/fixtures').catch(() => {});
  const host = a.networkStats.get('v3.football.api-sports.io');
  assert.ok(host);
  assert.equal(host.lastKind, 'network');
  assert.equal(host.lastStatus, 0);
  assert.equal(host.errCount, 1);
});

test('gmFetchJson timeout: records kind=timeout with status 0', () => {
  const a = loadUserscript({ gmXmlhttpRequest: { type: 'timeout' } });
  a.gmFetchJson('https://v3.football.api-sports.io/fixtures').catch(() => {});
  const host = a.networkStats.get('v3.football.api-sports.io');
  assert.ok(host);
  assert.equal(host.lastKind, 'timeout');
  assert.equal(host.lastStatus, 0);
  assert.equal(host.errCount, 1);
});

test('gmFetchJson: multiple calls accumulate per-host counts', () => {
  let n = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: () => loadResp(n++ === 0 ? 200 : 500, {})
  });
  a.gmFetchJson('https://host.example.com/a');
  a.gmFetchJson('https://host.example.com/b').catch(() => {});
  const host = a.networkStats.get('host.example.com');
  assert.equal(host.okCount, 1);
  assert.equal(host.errCount, 1);
  assert.equal(host.lastStatus, 500);
});

// ---------------------------------------------------------------------------
// gmFetchJsonWithMeta — network event recording + shape capture
// ---------------------------------------------------------------------------

test('gmFetchJsonWithMeta 200: records network event and captures shape', () => {
  const body = { response: [{ fixture: { id: 1 }, teams: { home: { name: 'A' }, away: { name: 'B' } } }], results: 1 };
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, body, 'content-type: application/json\r\n') });
  a.gmFetchJsonWithMeta('https://v3.football.api-sports.io/fixtures', {}, 'football');
  const report = a.buildDebugReport();
  const host = report.network.byHost.find(h => h.host === 'v3.football.api-sports.io');
  assert.ok(host, 'host entry present');
  assert.equal(host.lastStatus, 200);
  assert.equal(host.okCount, 1);
  const sample = report.network.samples['v3.football.api-sports.io'];
  assert.ok(sample, 'shape sample present');
  assert.equal(sample.type, 'object');
  assert.ok(sample.keys.includes('response'), '"response" key in top-level shape');
});

test('gmFetchJsonWithMeta: no valueSample when enableDebugMode is false', () => {
  const body = { response: [{ id: 1, homeTeam: 'FC Test' }] };
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, body) });
  a.uiSettings.enableDebugMode = false;
  a.gmFetchJsonWithMeta('https://v3.football.api-sports.io/fixtures', {}, 'test');
  const report = a.buildDebugReport();
  const sample = report.network.samples['v3.football.api-sports.io'];
  assert.ok(sample, 'sample present');
  assert.ok(!('valueSample' in sample), 'no valueSample when debug mode off');
});

test('gmFetchJsonWithMeta: valueSample present when enableDebugMode is true', () => {
  const body = { response: [{ id: 1, homeTeam: 'FC Test' }] };
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, body) });
  a.uiSettings.enableDebugMode = true;
  a.gmFetchJsonWithMeta('https://v3.football.api-sports.io/fixtures', {}, 'test');
  const report = a.buildDebugReport();
  const sample = report.network.samples['v3.football.api-sports.io'];
  assert.ok(sample, 'sample present');
  assert.ok('valueSample' in sample, 'valueSample present when debug mode on');
});

test('gmFetchJsonWithMeta 403: no shape captured, error recorded', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(403, { message: 'over quota' }) });
  a.gmFetchJsonWithMeta('https://v3.football.api-sports.io/status', {}, 'quota-check').catch(() => {});
  assert.ok(!a.networkSamples.has('v3.football.api-sports.io'), 'no shape on error');
  const host = a.networkStats.get('v3.football.api-sports.io');
  assert.equal(host.errCount, 1);
});

// ---------------------------------------------------------------------------
// buildDebugReport.network structure
// ---------------------------------------------------------------------------

test('buildDebugReport.network.recent contains only network-type events', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, {}) });
  a.recordDebugEvent('provider-fetch-error', { error: 'some provider error' });
  a.gmFetchJson('https://api.example.com/test');
  const report = a.buildDebugReport();
  assert.ok(report.network.recent.length >= 1);
  for (const ev of report.network.recent) {
    assert.equal(ev.type, 'network', `unexpected type: ${ev.type}`);
  }
});

test('buildDebugReport.network.recent is capped at 60 entries', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, {}) });
  for (let i = 0; i < 70; i++) {
    a.gmFetchJson(`https://api.example.com/item${i}`);
  }
  const report = a.buildDebugReport();
  assert.ok(report.network.recent.length <= 60, `got ${report.network.recent.length}`);
});

test('buildDebugReport.network.byHost lists all hosts with counts', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, {}) });
  a.gmFetchJson('https://host-a.example.com/x');
  a.gmFetchJson('https://host-b.example.com/y');
  const report = a.buildDebugReport();
  const hosts = report.network.byHost.map(h => h.host);
  assert.ok(hosts.includes('host-a.example.com'));
  assert.ok(hosts.includes('host-b.example.com'));
});

// ---------------------------------------------------------------------------
// Redaction guarantees
// ---------------------------------------------------------------------------

test('api-sports key in URL query is never in network report', () => {
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, {}) });
  a.__control.gmStore.set('tmBookieApiSportsKey', 'MY-SECRET-KEY-99');
  a.gmFetchJson('https://v3.football.api-sports.io/fixtures?apiKey=MY-SECRET-KEY-99');
  const str = JSON.stringify(a.buildDebugReport().network);
  assert.ok(!str.includes('MY-SECRET-KEY-99'), 'api-sports key must not appear in network report');
});

test('set-cookie header value is never in network events', () => {
  const hdrs = 'content-type: application/json\r\nset-cookie: session=abc123secret; HttpOnly\r\n';
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, {}, hdrs) });
  a.gmFetchJsonWithMeta('https://v3.football.api-sports.io/fixtures', {}, 'test');
  const str = JSON.stringify(a.buildDebugReport().network);
  assert.ok(!str.includes('abc123secret'), 'set-cookie value must not appear');
});

test('x-apisports-key and Authorization request headers are never logged', () => {
  const hdrs = 'content-type: application/json\r\nx-apisports-key: PROVIDER-SECRET\r\nauthorization: Bearer MY-AUTH-TOKEN\r\n';
  const a = loadUserscript({ gmXmlhttpRequest: loadResp(200, {}, hdrs) });
  a.gmFetchJsonWithMeta('https://v3.football.api-sports.io/fixtures', {}, 'test');
  const str = JSON.stringify(a.buildDebugReport().network);
  assert.ok(!str.includes('PROVIDER-SECRET'), 'x-apisports-key value must not appear');
  assert.ok(!str.includes('MY-AUTH-TOKEN'), 'Authorization value must not appear');
});
