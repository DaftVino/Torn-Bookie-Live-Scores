'use strict';

// Runtime-stability characterization: cache growth, in-flight cleanup, and
// the absence of auto-eviction on the two long-lived Maps. Deterministic;
// uses the shared caches directly through the harness.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { NOW, liveMatch } = require('./fixtures');

const a = loadUserscript();

test('inFlightRequests returns to empty after success and after rejection (no leak)', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  await a.fetchWithCache('ok', () => Promise.resolve({ events: [] }), 1000, 500);
  await a.fetchWithCache('bad', () => Promise.reject(new Error('x')), 1000, 500);
  assert.equal(a.inFlightRequests.size, 0, 'no in-flight entries leak');
});

test('providerCache: expired entries are swept when size exceeds 200, unexpired entries remain', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);

  // Fill 101 entries with a long TTL — these must survive the sweep
  for (let i = 0; i < 101; i++) {
    await a.fetchWithCache(`long-${i}`, () => Promise.resolve({ n: i }), 60000, 30000);
  }
  // Fill 100 more entries with a short TTL — these will be swept
  for (let i = 0; i < 100; i++) {
    await a.fetchWithCache(`short-${i}`, () => Promise.resolve({ n: i }), 500, 250);
  }
  assert.equal(a.providerCache.size, 201, '201 entries present before any expiry');

  // Advance past the short TTL but not past the long TTL
  a.__control.setNow(NOW + 600);

  // A new fetchWithCache call triggers the sweep (size > 200)
  await a.fetchWithCache('trigger', () => Promise.resolve({ n: 999 }), 1000, 500);

  // 100 short-TTL entries are swept; 101 long-TTL entries and 'trigger' remain
  assert.equal(a.providerCache.size, 102, 'expired short-TTL entries swept; unexpired + trigger remain');
  assert.ok(a.providerCache.has('long-0'), 'unexpired long-0 survives sweep');
  assert.ok(!a.providerCache.has('short-0'), 'expired short-0 removed by sweep');
  assert.ok(a.providerCache.has('trigger'), 'newly fetched trigger entry present');

  // Re-fetching an existing key overwrites in place without changing size
  await a.fetchWithCache('long-0', () => Promise.resolve({ n: 'refreshed' }), 60000, 30000);
  assert.equal(a.providerCache.size, 102, 'overwrite-by-key keeps size stable');
});

test('providerCache: no sweep occurs when size is 200 or fewer (unexpired entries preserved)', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  for (let i = 0; i < 25; i++) {
    await a.fetchWithCache(`key-${i}`, () => Promise.resolve({ events: [i] }), 1000, 500);
  }
  assert.equal(a.providerCache.size, 25, 'one entry per distinct key');
  a.__control.setNow(NOW + 10 * 60 * 1000);
  // Size ≤ 200, so no sweep runs; expired entries remain resident until re-fetched
  assert.equal(a.providerCache.size, 25, 'expired entries not evicted below threshold');
});

test('enrichmentCache: cache is bounded at 50 entries; oldest entry evicted when cap is reached', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);

  // Fill exactly to the cap
  for (let i = 0; i < 50; i++) {
    a.getEnrichment(liveMatch({ tornId: 1000 + i, team1: `Team ${i}`, team2: `Foe ${i}` }));
  }
  assert.equal(a.enrichmentCache.size, 50, 'cache fills to 50 without eviction');

  // A 51st distinct match triggers eviction of the oldest (first-inserted) entry
  const newest = liveMatch({ tornId: 9999, team1: 'Newest Team', team2: 'Newest Foe' });
  a.getEnrichment(newest);
  assert.equal(a.enrichmentCache.size, 50, 'cache stays bounded at 50 after eviction');
  assert.ok(a.enrichmentCache.has(a.makeMatchKey(newest)), 'newest entry retained');
  const oldestKey = a.makeMatchKey(liveMatch({ tornId: 1000, team1: 'Team 0', team2: 'Foe 0' }));
  assert.ok(!a.enrichmentCache.has(oldestKey), 'oldest entry evicted to make room');
});

test('enrichmentCache: re-accessing an existing key does not trigger eviction', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);

  // Fill to cap minus one
  for (let i = 0; i < 49; i++) {
    a.getEnrichment(liveMatch({ tornId: 1000 + i, team1: `Team ${i}`, team2: `Foe ${i}` }));
  }
  const existing = liveMatch({ tornId: 1000, team1: 'Team 0', team2: 'Foe 0' });
  a.getEnrichment(existing); // re-access existing key — no eviction
  assert.equal(a.enrichmentCache.size, 49, 'no eviction when key already present');
  assert.ok(a.enrichmentCache.has(a.makeMatchKey(existing)), 'existing entry still present');

  // Add one more to reach the cap exactly
  a.getEnrichment(liveMatch({ tornId: 1050, team1: 'Team 50', team2: 'Foe 50' }));
  assert.equal(a.enrichmentCache.size, 50, 'size at cap after 50th distinct entry');
  assert.ok(a.enrichmentCache.has(a.makeMatchKey(existing)), 'entry 0 survives; no eviction below cap');
});

test('resolvedEventCache self-evicts a single entry on expired access (bounded reuse window)', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const m = liveMatch();
  a.putResolvedEvent('espn', m, { candidate: { providerEventId: 'evt1', normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), homeName: 'Boston Red Sox', awayName: 'New York Yankees', status: 'inprogress' }, pair: { confidence: 100 } });
  assert.equal(a.resolvedEventCache.size, 1);
  a.__control.setNow(NOW + 5 * 60 * 1000 + 1); // past active TTL
  assert.equal(a.getResolvedEvent('espn', m), null);
  assert.equal(a.resolvedEventCache.size, 0, 'expired entry deleted on access');
});
