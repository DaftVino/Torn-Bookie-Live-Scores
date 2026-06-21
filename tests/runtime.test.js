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

test('BEHAVIOR: providerCache grows monotonically across distinct keys and is NOT auto-pruned on expiry', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  for (let i = 0; i < 25; i++) {
    await a.fetchWithCache(`key-${i}`, () => Promise.resolve({ events: [i] }), 1000, 500);
  }
  assert.equal(a.providerCache.size, 25, 'one entry per distinct key');
  // Advance well past every TTL. fetchWithCache only overwrites on access; it has
  // no sweep, so expired entries remain resident until their key is fetched again.
  a.__control.setNow(NOW + 10 * 60 * 1000);
  assert.equal(a.providerCache.size, 25, 'expired entries are not evicted by time alone');
  // Re-fetching an existing key refreshes in place (does not add a new entry).
  await a.fetchWithCache('key-0', () => Promise.resolve({ events: ['fresh'] }), 1000, 500);
  assert.equal(a.providerCache.size, 25, 'overwrite-by-key keeps size stable');
});

test('BEHAVIOR: enrichmentCache grows one entry per distinct match key and is never pruned', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  for (let i = 0; i < 15; i++) {
    a.getEnrichment(liveMatch({ tornId: 1000 + i, team1: `Team ${i}`, team2: `Foe ${i}` }));
  }
  assert.equal(a.enrichmentCache.size, 15, 'one enrichment per distinct match');
  a.__control.setNow(NOW + 24 * 60 * 60 * 1000); // a full day later
  // Re-reading does not evict; there is no delete/clear path for this Map.
  a.getEnrichment(liveMatch({ tornId: 1000, team1: 'Team 0', team2: 'Foe 0' }));
  assert.equal(a.enrichmentCache.size, 15, 'no eviction after a day; stable on re-read');
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
