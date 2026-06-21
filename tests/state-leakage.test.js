'use strict';

// These tests deliberately run the same stateful sequences multiple times and in
// varied order to surface cross-test state leakage in the shared module caches and
// the controllable clock. If any iteration diverges, ordering-dependence exists.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { liveMatch, bookieData, NOW } = require('./fixtures');

const a = loadUserscript();
const SEC = ms => Math.floor(ms / 1000);

test('repeated cache fill/expiry cycles are deterministic', async () => {
  for (let i = 0; i < 25; i++) {
    a.__resetCaches();
    a.__control.setNow(NOW);
    let calls = 0;
    const fn = () => { calls++; return Promise.resolve({ i, calls }); };
    await a.fetchWithCache('cycle', fn, 1000, 500);
    await a.fetchWithCache('cycle', fn, 1000, 500);
    assert.equal(calls, 1, `iteration ${i}: expected single call within TTL`);
    a.__control.setNow(NOW + 2000);
    await a.fetchWithCache('cycle', fn, 1000, 500);
    assert.equal(calls, 2, `iteration ${i}: expected refetch after expiry`);
  }
  // caches left non-empty here on purpose; next test must not depend on it
});

test('resolved-event put/get is stable regardless of leftover cache state', () => {
  for (let i = 0; i < 25; i++) {
    a.__control.setNow(NOW);
    const m = liveMatch({ team1: `Team ${i} Alpha`, team2: `Team ${i} Beta`, startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)) });
    a.putResolvedEvent('espn', m, { candidate: { providerEventId: `e${i}`, normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), homeName: `Team ${i} Alpha`, awayName: `Team ${i} Beta`, status: 'inprogress' }, pair: { confidence: 100 } });
    const got = a.getResolvedEvent('espn', m);
    assert.equal(got.providerEventId, `e${i}`);
    a.__control.setNow(NOW + 6 * 60 * 1000);
    assert.equal(a.getResolvedEvent('espn', m), null, `iteration ${i}: should expire`);
  }
});

test('pure extraction is referentially stable across repeated calls', () => {
  a.__control.setNow(NOW);
  const first = JSON.stringify(a.extractLiveBets(bookieData()));
  for (let i = 0; i < 50; i++) {
    assert.equal(JSON.stringify(a.extractLiveBets(bookieData())), first);
  }
});

test('clock control fully determines time-dependent helpers', () => {
  a.__control.setNow(Date.UTC(2030, 0, 1, 0, 0, 0));
  assert.equal(a.getLiveRecoveryMs(liveMatch()), Date.UTC(2030, 0, 1, 0, 0, 0));
  a.__control.setNow(NOW);
  assert.equal(a.getLiveRecoveryMs(liveMatch()), NOW);
  // non-live match has no recovery time
  assert.equal(a.getLiveRecoveryMs(liveMatch({ sectionType: 'upcoming', status: 'notstarted', isLive: false })), null);
});
