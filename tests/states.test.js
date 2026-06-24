'use strict';

// Realistic-state coverage that complements the existing suite. Focus areas
// requested by the validation brief that were not yet pinned by a dedicated test:
//   - delayed / postponed / suspended / abandoned / cancelled status handling
//   - which Torn statuses survive into the live/upcoming panel (section filter)
//   - multiple simultaneous live games
//   - provider failure -> fallback, and one provider failing while another wins
//   - HTTP-error / rate-limit (429) / timeout / parser-failure diagnostics
//   - stale / corrupted cache entries
//   - browser reload during an active match (capture gate)
//
// Every test is deterministic: fixed clock, in-memory caches reset per test,
// no live network. Tests prefixed BEHAVIOR: characterize current behavior that
// is a design choice worth pinning (not necessarily a defect).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { NOW, liveMatch, bookieData, SEC } = require('./fixtures');

const a = loadUserscript();

function j(v) { return JSON.parse(JSON.stringify(v)); }

// A candidate shape that scoreCandidate will accept for liveMatch().
function strongCandidate(overrides = {}) {
  return Object.assign({
    providerKey: 'espn',
    providerEventId: 'evtA',
    homeName: 'Boston Red Sox',
    awayName: 'New York Yankees',
    normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0),
    status: 'inprogress',
    competitionName: 'MLB',
    anchorKind: 'torn-start',
    offsetDays: 0,
    homeScore: 5,
    awayScore: 3
  }, overrides);
}

// ---------------------------------------------------------------------------
// Status classification: delayed / postponed / suspended / abandoned / cancelled
// ---------------------------------------------------------------------------

test('normalizeStatusToken collapses spacing/case/punctuation', () => {
  assert.equal(a.normalizeStatusToken('In Progress'), 'inprogress');
  assert.equal(a.normalizeStatusToken('Not_Started'), 'notstarted');
  assert.equal(a.normalizeStatusToken('  POST-PONED '), 'postponed');
  assert.equal(a.normalizeStatusToken(null), '');
});

test('isFinalStatus: finished/ft/final are final; abandoned/suspended/delayed are NOT', () => {
  for (const s of ['finished', 'FT', 'Full Time', 'complete', 'final']) {
    assert.equal(a.isFinalStatus(s), true, `${s} should be final`);
  }
  // BEHAVIOR: these tokens are absent from FINAL_STATUS_VALUES, so the script
  // does not treat them as completed games.
  for (const s of ['abandoned', 'suspended', 'delayed', 'cancelled', 'postponed']) {
    assert.equal(a.isFinalStatus(s), false, `${s} is not classified final`);
  }
});

test('isActuallyLive: structural live section wins over a non-live status token', () => {
  // Torn marks the bet live (sectionType=live); a stray "postponed" token does not flip it.
  assert.equal(a.isActuallyLive(liveMatch({ status: 'postponed', sectionType: 'live' })), true);
  // Upcoming section + a live-ish status token stays not-live.
  assert.equal(a.isActuallyLive(liveMatch({ sectionType: 'upcoming', status: 'inprogress' })), false);
  // No section, only a live token -> live.
  assert.equal(a.isActuallyLive({ status: 'inplay' }), true);
  // No section, only a non-live token -> not live.
  assert.equal(a.isActuallyLive({ status: 'postponed' }), false);
});

test('isActuallyLive: selected-game in-progress text is live without a timestamp', () => {
  assert.equal(a.normalizeStatusToken('Match is in progress'), 'matchisinprogress');
  assert.equal(a.normalizeStatusToken('Starts Match is in progress'), 'startsmatchisinprogress');
  assert.equal(a.isActuallyLive({ status: 'Match is in progress' }), true);
  assert.equal(a.isActuallyLive({ status: 'Starts Match is in progress' }), true);
  assert.equal(a.isActuallyLive({ rawStatus: 'Match is in progress' }), true);
});

test('isActuallyLive: scheduled and finished text stays non-live', () => {
  for (const s of ['scheduled', 'notstarted', 'finished', 'complete', 'completed', 'final']) {
    assert.equal(a.isActuallyLive({ status: s }), false, `${s} should not be live`);
  }
  assert.equal(a.isActuallyLive({ status: 'Starts 19:30 - 20/06/2026' }), false);
});

test('BEHAVIOR: delayed/abandoned/suspended are neither live nor final nor non-live tokens', () => {
  // These do not appear in any status set; isActuallyLive on a bare object is false
  // (no live token) and isFinalStatus is false -> they render as "in limbo".
  for (const s of ['delayed', 'abandoned', 'suspended']) {
    assert.equal(a.isActuallyLive({ status: s }), false, `${s} not live by token`);
    assert.equal(a.isFinalStatus(s), false, `${s} not final`);
  }
});

// ---------------------------------------------------------------------------
// Section filter: which Torn statuses survive into the panel
// ---------------------------------------------------------------------------

test('BEHAVIOR: only inprogress->live and notstarted->upcoming survive; other statuses are dropped', () => {
  const data = {
    gameBoxesList: [{
      alias: 'your-bets',
      matches: [
        { ID: 1, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'inprogress', name: 'A vs B', ep: [{ name: 'A' }, { name: 'B' }], startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)), bets: [{ amount: 1 }] },
        { ID: 2, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'notstarted', name: 'C vs D', ep: [{ name: 'C' }, { name: 'D' }], startTimestamp: SEC(Date.UTC(2026, 5, 21, 18, 0, 0)), bets: [{ amount: 1 }] },
        { ID: 3, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'postponed', name: 'E vs F', ep: [{ name: 'E' }, { name: 'F' }], startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)), bets: [{ amount: 1 }] },
        { ID: 4, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'cancelled', name: 'G vs H', ep: [{ name: 'G' }, { name: 'H' }], startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)), bets: [{ amount: 1 }] },
        { ID: 5, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'finished', name: 'I vs J', ep: [{ name: 'I' }, { name: 'J' }], startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)), bets: [{ amount: 1 }] },
        { ID: 6, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'delayed', name: 'K vs L', ep: [{ name: 'K' }, { name: 'L' }], startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)), bets: [{ amount: 1 }] }
      ]
    }]
  };
  const live = a.extractLiveBets(data);
  const upcoming = a.extractUpcomingBets(data);
  assert.deepEqual(live.map(m => m.tornId), [1]);
  assert.deepEqual(upcoming.map(m => m.tornId), [2]);
  // postponed/cancelled/finished/delayed appear in neither list.
  const shown = new Set([...live, ...upcoming].map(m => m.tornId));
  for (const id of [3, 4, 5, 6]) assert.equal(shown.has(id), false, `status id ${id} should be dropped`);
});

// ---------------------------------------------------------------------------
// Multiple simultaneous live games
// ---------------------------------------------------------------------------

test('multiple simultaneous live games are all extracted, grouped, and rendered', () => {
  // Two enabled (Baseball, default-on) inprogress matches at the same time.
  const data = {
    gameBoxesList: [{
      alias: 'your-bets',
      matches: [
        { ID: 201, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'inprogress', name: 'Red Sox vs Yankees', ep: [{ name: 'Boston Red Sox' }, { name: 'New York Yankees' }], startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)), bets: [{ amount: 100 }] },
        { ID: 202, sport: 'Baseball', stage: 'MLB', competition: 'MLB', status: 'inprogress', name: 'Cubs vs Mets', ep: [{ name: 'Chicago Cubs' }, { name: 'New York Mets' }], startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 30, 0)), bets: [{ amount: 200 }] }
      ]
    }]
  };
  const live = a.extractLiveBets(data);
  assert.equal(live.length, 2, 'both simultaneous live games extracted');
  const groups = a.groupMatchesBySport(live);
  assert.equal(groups.length, 1, 'same sport -> one group');
  assert.equal(groups[0].matches.length, 2, 'group holds both live matches');
  const html = a.renderSportGroups('live', 'Live', live, a.renderLiveMatch);
  for (const m of live) {
    const count = html.split(a.escapeHtml(m.name)).length - 1;
    assert.ok(count >= 1, `live match "${m.name}" should render`);
  }
});

// ---------------------------------------------------------------------------
// Provider fallback engine (resolveProviderMatch) — failures + recovery
// ---------------------------------------------------------------------------

test('provider fallback: first plan step throws, a later step resolves the match', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const match = liveMatch();
  const plan = [
    { reason: 'primary-anchor', providerDate: '2026-06-20', requestKey: 'd0' },
    { reason: 'adjacent-fallback', providerDate: '2026-06-21', requestKey: 'd1' }
  ];
  let step = 0;
  const fetchStep = async () => {
    step += 1;
    if (step === 1) throw new Error('boom on first date');
    return { candidates: [strongCandidate()], eventCount: 1, errors: [], parseFailures: [] };
  };
  const result = await a.resolveProviderMatch(match, 'espn', plan, fetchStep, { nowMs: NOW });
  assert.ok(result.resolution, 'a later step should resolve');
  assert.equal(result.resolution.candidate.providerEventId, 'evtA');
  assert.equal(step, 2, 'both steps were attempted');
});

test('provider fallback: all steps return no candidates -> no resolution, "no events" label', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const match = liveMatch();
  const plan = [{ reason: 'primary-anchor', providerDate: '2026-06-20', requestKey: 'd0' }];
  const fetchStep = async () => ({ candidates: [], eventCount: 0, errors: [], parseFailures: [] });
  const result = await a.resolveProviderMatch(match, 'espn', plan, fetchStep, { nowMs: NOW });
  assert.equal(result.resolution, null);
  assert.match(a.summarizeProviderResult('ESPN', result), /no events/);
});

test('one provider fails while another succeeds (independent resolves)', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const match = liveMatch();
  const plan = [{ reason: 'primary-anchor', providerDate: '2026-06-20', requestKey: 'd0' }];

  // Provider A: hard failure on every step.
  const failing = async () => { throw new Error('Request failed 500'); };
  const aRes = await a.resolveProviderMatch(match, 'espn', plan, failing, { nowMs: NOW });
  assert.equal(aRes.resolution, null);
  assert.match(a.summarizeProviderResult('ESPN', aRes), /fetch error/);

  // Provider B: succeeds with a strong candidate.
  const winning = async () => ({ candidates: [strongCandidate({ providerKey: 'sofascore', providerEventId: 'sofa1' })], eventCount: 1, errors: [], parseFailures: [] });
  const bRes = await a.resolveProviderMatch(match, 'sofascore', plan, winning, { nowMs: NOW });
  assert.ok(bRes.resolution, 'second provider resolves independently');
  assert.equal(bRes.resolution.candidate.providerEventId, 'sofa1');
});

// ---------------------------------------------------------------------------
// HTTP-error / rate-limit / timeout / parser diagnostics
// ---------------------------------------------------------------------------

test('summarizeProviderResult surfaces HTTP status, including 429 rate limiting', () => {
  const mk = (errs, extra = {}) => Object.assign(a.makeProviderResult(), { errors: errs, queried: [{ providerDate: '2026-06-20' }] }, extra);
  assert.match(a.summarizeProviderResult('TheScore', mk(['thescore request failed 429'])), /\[HTTP 429\]/);
  assert.match(a.summarizeProviderResult('ESPN', mk(['espn request failed 500'])), /\[HTTP 500\]/);
  assert.match(a.summarizeProviderResult('BBC', mk(['BBC request timeout'])), /fetch error/);
  // parser failure (events arrived but could not be parsed into candidates)
  const parseRes = Object.assign(a.makeProviderResult(), { parseFailures: ['bad json'], eventCount: 0, queried: [{ providerDate: '2026-06-20' }] });
  assert.match(a.summarizeProviderResult('LiveScore', parseRes), /parser failed/);
  // events found but no confident match
  const noMatch = Object.assign(a.makeProviderResult(), { eventCount: 3, queried: [{ providerDate: '2026-06-20' }] });
  assert.match(a.summarizeProviderResult('ESPN', noMatch), /no confident team match/);
});

test('ambiguous match is reported when two candidates tie within 10 points', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const match = liveMatch();
  const plan = [{ reason: 'primary-anchor', providerDate: '2026-06-20', requestKey: 'd0' }];
  const fetchStep = async () => ({
    candidates: [
      strongCandidate({ providerEventId: 'evt1' }),
      strongCandidate({ providerEventId: 'evt2' })
    ],
    eventCount: 2, errors: [], parseFailures: []
  });
  const result = await a.resolveProviderMatch(match, 'espn', plan, fetchStep, { nowMs: NOW });
  assert.equal(result.resolution, null, 'tie should not auto-resolve');
  assert.equal(result.ambiguous, true);
  assert.match(a.summarizeProviderResult('ESPN', result), /ambiguous match/);
});

// ---------------------------------------------------------------------------
// Stale / corrupted cache entries
// ---------------------------------------------------------------------------

test('stale providerCache entry past expiry triggers a refetch (no stale serve)', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  // Seed a stale entry directly into the shared cache.
  a.providerCache.set('k', { data: { events: ['STALE'] }, expiry: NOW - 1 });
  let calls = 0;
  const fresh = await a.fetchWithCache('k', () => { calls++; return Promise.resolve({ events: ['FRESH'] }); }, 1000, 500);
  assert.equal(calls, 1, 'expired entry must refetch');
  assert.deepEqual(j(fresh.events), ['FRESH']);
});

test('corrupted providerCache entry (within TTL) is returned verbatim — cache trusts its own shape', async () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  // A malformed-but-unexpired entry: fetchWithCache does not validate shape, it serves by TTL.
  a.providerCache.set('k', { data: { not: 'a board' }, expiry: NOW + 10000 });
  let calls = 0;
  const got = await a.fetchWithCache('k', () => { calls++; return Promise.resolve({ events: ['FRESH'] }); }, 1000, 500);
  assert.equal(calls, 0, 'unexpired entry is served without refetch');
  assert.deepEqual(j(got), { not: 'a board' });
  // Downstream provider parsers must tolerate this; they read events/Stages defensively.
});

test('resolved-event cache: a corrupted/garbage stored entry does not crash getResolvedEvent', () => {
  a.__resetCaches();
  a.__control.setNow(NOW);
  const match = liveMatch();
  // Write a structurally-broken entry directly under the real key.
  const key = `resolved-event:espn:${a.makeMatchKey(match)}`;
  a.resolvedEventCache.set(key, { garbage: true });
  // Should not throw; treats it as a miss or harmless object.
  assert.doesNotThrow(() => a.getResolvedEvent('espn', match));
});

// ---------------------------------------------------------------------------
// Browser reload during an active match (capture gate)
// ---------------------------------------------------------------------------

test('browser reload during a match: empty capture is not usable; panel shows the wait message', () => {
  // After a reload, capturedBookieData is empty until Torn re-fetches the bookie API.
  assert.equal(a.hasUsableBookieData(null), false);
  assert.equal(a.hasUsableBookieData({}), false);
  assert.equal(a.hasUsableBookieData({ gameBoxesList: [{ alias: 'your-bets', matches: [] }] }), false);
  // Once data arrives it becomes usable.
  assert.equal(a.hasUsableBookieData(bookieData()), true);
  // The wait-state error renders the friendly, action-oriented message (static literal branch).
  const body = a.renderErrorBody(new Error('Waiting for Torn Bookie data capture. Be sure you have selected YOUR BETS. Refresh the Bookie page if this persists.'));
  assert.match(body, /selected YOUR BETS/);
  assert.match(body, /<strong>/); // known-message branch keeps its bold call-to-action
});
