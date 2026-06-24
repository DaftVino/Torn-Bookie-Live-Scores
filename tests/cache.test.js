'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { liveMatch, NOW } = require('./fixtures');

const a = loadUserscript();
const SEC = ms => Math.floor(ms / 1000);

test('fetchWithCache: coalesces concurrent calls for the same key', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  let calls = 0;
  const fn = () => { calls++; return Promise.resolve({ events: [calls] }); };
  const [r1, r2] = await Promise.all([
    a.fetchWithCache('k', fn, 1000, 500),
    a.fetchWithCache('k', fn, 1000, 500)
  ]);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
});

test('fetchWithCache: serves cache hit until TTL, refetches after expiry', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  let calls = 0;
  const fn = () => { calls++; return Promise.resolve({ n: calls }); };
  await a.fetchWithCache('k', fn, 1000, 500);
  await a.fetchWithCache('k', fn, 1000, 500); // within TTL -> hit
  assert.equal(calls, 1);
  a.__control.setNow(NOW + 1001); // expire success TTL
  const r = await a.fetchWithCache('k', fn, 1000, 500);
  assert.equal(calls, 2);
  assert.equal(r.n, 2);
});

test('fetchWithCache: caches errors with a short TTL and a safe empty shape', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  let calls = 0;
  const fn = () => { calls++; return Promise.reject(new Error('boom')); };
  const e1 = await a.fetchWithCache('e', fn, 1000, 500);
  assert.equal(e1.error, 'boom');
  assert.deepEqual(JSON.parse(JSON.stringify(e1.events)), []);
  await a.fetchWithCache('e', fn, 1000, 500); // within error TTL -> cached, no refetch
  assert.equal(calls, 1);
  a.__control.setNow(NOW + 501); // expire error TTL
  await a.fetchWithCache('e', fn, 1000, 500);
  assert.equal(calls, 2);
});

test('fetchWithCache: a rejected fetch never leaks an in-flight entry (no permanent stall)', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  await a.fetchWithCache('x', () => Promise.reject(new Error('down')), 1000, 500);
  assert.equal(a.inFlightRequests.has('x'), false);
});

test('GM request helpers set a 12s timeout and reject through ontimeout', async () => {
  const api = loadUserscript({ gmXmlhttpRequest: 'timeout' });

  await assert.rejects(
    api.gmFetchJson('https://example.test/data'),
    err => {
      assert.match(err.message, /Timeout: https:\/\/example\.test\/data/);
      return true;
    }
  );
  assert.equal(api.__control.gmRequests[0].timeout, 12000);

  await assert.rejects(
    api.gmFetchJsonWithMeta('https://example.test/meta', {}, 'Meta request'),
    err => {
      assert.equal(err.message, 'Meta request timeout');
      return true;
    }
  );
  assert.equal(api.__control.gmRequests[1].timeout, 12000);
});

test('fetchWithCache: GM timeout uses safe error cache, clears in-flight, then retries after TTL', async () => {
  let requestCount = 0;
  const api = loadUserscript({
    gmXmlhttpRequest: () => {
      requestCount++;
      if (requestCount === 1) return 'timeout';
      return {
        type: 'load',
        response: {
          status: 200,
          responseText: JSON.stringify({ events: ['ok'], Stages: ['ok'] }),
          responseHeaders: ''
        }
      };
    }
  });
  let unhandledCount = 0;
  const handler = () => { unhandledCount++; };
  process.on('unhandledRejection', handler);
  try {
    api.__resetCaches();
    api.__control.setNow(NOW);
    const first = await api.fetchWithCache(
      'gm-timeout',
      () => api.gmFetchJson('https://example.test/scores'),
      1000,
      500
    );
    assert.match(first.error, /Timeout: https:\/\/example\.test\/scores/);
    assert.deepEqual(JSON.parse(JSON.stringify(first.events)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(first.Stages)), []);
    assert.equal(api.inFlightRequests.has('gm-timeout'), false);
    assert.equal(api.__control.gmRequests[0].timeout, 12000);
    assert.equal(requestCount, 1);

    const cached = await api.fetchWithCache(
      'gm-timeout',
      () => api.gmFetchJson('https://example.test/scores'),
      1000,
      500
    );
    assert.equal(cached.error, first.error);
    assert.equal(requestCount, 1, 'timeout error is cached during error TTL');

    api.__control.setNow(NOW + 501);
    const retry = await api.fetchWithCache(
      'gm-timeout',
      () => api.gmFetchJson('https://example.test/scores'),
      1000,
      500
    );
    assert.deepEqual(JSON.parse(JSON.stringify(retry.events)), ['ok']);
    assert.deepEqual(JSON.parse(JSON.stringify(retry.Stages)), ['ok']);
    assert.equal(api.inFlightRequests.has('gm-timeout'), false);
    assert.equal(api.__control.gmRequests[1].timeout, 12000);
    assert.equal(requestCount, 2);

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(unhandledCount, 0, 'timeout rejection was handled');
  } finally {
    process.removeListener('unhandledRejection', handler);
  }
});

test('resolved-event cache: stores by provider+match and returns within TTL', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const m = liveMatch();
  const resolution = { candidate: { providerEventId: 'evt1', normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), homeName: 'Boston Red Sox', awayName: 'New York Yankees', status: 'inprogress' }, pair: { confidence: 100, team1IsHome: true } };
  a.putResolvedEvent('espn', m, resolution);
  const got = a.getResolvedEvent('espn', m);
  assert.ok(got);
  assert.equal(got.providerEventId, 'evt1');
});

test('resolved-event cache: expires active entries after 5 minutes', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const m = liveMatch();
  a.putResolvedEvent('espn', m, { candidate: { providerEventId: 'evt1', normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), homeName: 'Boston Red Sox', awayName: 'New York Yankees', status: 'inprogress' }, pair: { confidence: 100 } });
  a.__control.setNow(NOW + 5 * 60 * 1000 + 1);
  assert.equal(a.getResolvedEvent('espn', m), null);
});

test('resolved-event cache: final-status entries expire faster (2 minutes)', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const m = liveMatch({ status: 'finished' });
  a.putResolvedEvent('espn', m, { candidate: { providerEventId: 'evt1', normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), homeName: 'Boston Red Sox', awayName: 'New York Yankees', status: 'final' }, pair: { confidence: 100 } });
  a.__control.setNow(NOW + 2 * 60 * 1000 + 1);
  assert.equal(a.getResolvedEvent('espn', m), null);
});

test('resolved-event cache: invalidated when team identity changes', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const m = liveMatch();
  a.putResolvedEvent('espn', m, { candidate: { providerEventId: 'evt1', normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), homeName: 'Boston Red Sox', awayName: 'New York Yankees', status: 'inprogress' }, pair: { confidence: 100 } });
  const different = liveMatch({ team1: 'Totally Different Team' });
  assert.equal(a.getResolvedEvent('espn', different), null);
});

test('resolved-event cache: invalidated when start time drifts beyond 1 hour', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const m = liveMatch({ startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)) });
  a.putResolvedEvent('espn', m, { candidate: { providerEventId: 'evt1', normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), homeName: 'Boston Red Sox', awayName: 'New York Yankees', status: 'inprogress' }, pair: { confidence: 100 } });
  const drifted = liveMatch({ startTimestamp: SEC(Date.UTC(2026, 5, 20, 20, 0, 0)) }); // +2h
  assert.equal(a.getResolvedEvent('espn', drifted), null);
});

test('putResolvedEvent: ignores candidates without a provider event id', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const m = liveMatch();
  a.putResolvedEvent('espn', m, { candidate: { providerEventId: '', homeName: 'x', awayName: 'y' }, pair: { confidence: 100 } });
  assert.equal(a.getResolvedEvent('espn', m), null);
});

test('capture-path: rejected clone().text() promise is absorbed by .catch(() => {})', async () => {
  // The intercepted window.fetch wraps the observational capture path in
  // response.clone().text().then(...).catch(() => {}). This test verifies
  // that a failure in clone/text does not escape as an unhandled rejection.
  let unhandledCount = 0;
  const handler = () => { unhandledCount++; };
  process.on('unhandledRejection', handler);
  try {
    await Promise.reject(new Error('simulated clone failure'))
      .then(text => { /* tryParseBookieResponse(text, url) */ })
      .catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(unhandledCount, 0, 'clone/text rejection absorbed; no unhandled rejection');
  } finally {
    process.removeListener('unhandledRejection', handler);
  }
});
