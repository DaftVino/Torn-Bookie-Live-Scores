'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { liveMatch, NOW } = require('./fixtures');

const a = loadUserscript();
const SEC = ms => Math.floor(ms / 1000);

test('normalizeName: accents, ampersand, punctuation, casing', () => {
  assert.equal(a.normalizeName('Köln'), 'koln');
  assert.equal(a.normalizeName('AT&T'), 'atandt');
  assert.equal(a.normalizeName('St. George'), 'st george');
  assert.equal(a.normalizeName('  Multiple   Spaces '), 'multiple spaces');
  assert.equal(a.normalizeName(null), '');
});

test('calcTeamMatchScore: exact, alias, containment, jaccard', () => {
  assert.equal(a.calcTeamMatchScore('Boston Red Sox', 'boston red sox'), 100);
  assert.equal(a.calcTeamMatchScore('Cloud9', 'C9'), 95);          // alias
  assert.equal(a.calcTeamMatchScore('Natus Vincere', 'NaVi'), 95); // alias
  assert.equal(a.calcTeamMatchScore('Tottenham Hotspur', 'Tottenham'), 80); // containment (no alias)
  assert.equal(a.calcTeamMatchScore('', 'x'), 0);
});

test('calcTeamMatchScore: min-length guard catches short containment (York/New York)', () => {
  // The shorter side ("York", 4 chars) is below MIN_LEN, so containment is skipped
  // and the score drops to the jaccard path. This is the case the guard DOES cover.
  assert.ok(a.calcTeamMatchScore('York', 'New York') < 60);
});

// ---- Documented defect (Medium): containment guard does not do what its comment claims ----
// Source comment (line ~1270): "Containment ... prevents 'mexico' matching 'new mexico'".
// In reality the guard only requires BOTH normalized names to be >= 5 chars; a 6-char
// name fully contained in a longer one still scores 80 (>= CONFIDENCE_THRESHOLD 60).
// This produces false-positive matches for reserve/youth/"New X" opponents that play on
// the same day (e.g. "Arsenal" vs "Arsenal Reserves"). Pin the actual behavior.
test('DEFECT: containment heuristic over-matches contained names (>= threshold)', () => {
  assert.equal(a.calcTeamMatchScore('Mexico', 'New Mexico'), 80);            // comment claims this is prevented
  assert.equal(a.calcTeamMatchScore('Arsenal', 'Arsenal Reserves'), 80);
  assert.equal(a.calcTeamMatchScore('United', 'Manchester United'), 80);
  // And it flows through to a full (both-sides) accepted pair:
  const m = { team1: 'Mexico', team2: 'USA' };
  assert.equal(a.matchTeamPair(m, 'New Mexico', 'USA').confidence, 80);
});

test('calcTeamMatchScore: distinct same-league teams stay below threshold', () => {
  assert.ok(a.calcTeamMatchScore('Manchester United', 'Manchester City') < 60);
});

test('matchTeamPair: orientation detection (home/away)', () => {
  const m = { team1: 'Boston Red Sox', team2: 'New York Yankees' };
  const homeOriented = a.matchTeamPair(m, 'Boston Red Sox', 'New York Yankees');
  assert.equal(homeOriented.team1IsHome, true);
  assert.ok(homeOriented.confidence >= 60);
  const awayOriented = a.matchTeamPair(m, 'New York Yankees', 'Boston Red Sox');
  assert.equal(awayOriented.team1IsHome, false);
  assert.ok(awayOriented.confidence >= 60);
});

test('matchTeamPair: rejects when below confidence threshold', () => {
  const m = { team1: 'Boston Red Sox', team2: 'New York Yankees' };
  const res = a.matchTeamPair(m, 'Chicago Cubs', 'LA Dodgers');
  assert.equal(res.confidence, 0);
});

test('scoreTeamOrientation uses short names/codes when full names miss', () => {
  const m = { team1: 'Boston Red Sox', team2: 'New York Yankees' };
  const cand = { homeName: 'BOS Red Sox', awayName: 'NY Yankees', homeShortName: 'Boston Red Sox', awayShortName: 'New York Yankees' };
  const res = a.scoreTeamOrientation(m, cand);
  assert.ok(res.confidence >= 60);
});

test('scoreCandidate accepts a strong same-time same-comp candidate', () => {
  a.__control.setNow(NOW);
  const m = liveMatch();
  const cand = {
    providerKey: 'espn', providerEventId: '1',
    homeName: 'Boston Red Sox', awayName: 'New York Yankees',
    competitionName: 'MLB',
    normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0),
    status: 'inprogress', anchorKind: 'torn-start', offsetDays: 0
  };
  const s = a.scoreCandidate(m, cand, { nowMs: NOW });
  assert.equal(s.accepted, true);
  assert.ok(s.score >= 75);
});

test('scoreCandidate rejects wrong teams (team-confidence) and far time (time-window)', () => {
  a.__control.setNow(NOW);
  const m = liveMatch();
  const wrongTeams = { homeName: 'Chicago Cubs', awayName: 'LA Dodgers', normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), status: 'inprogress' };
  assert.equal(a.scoreCandidate(m, wrongTeams, { nowMs: NOW }).reason, 'team-confidence');

  const farTime = {
    homeName: 'Boston Red Sox', awayName: 'New York Yankees',
    normalizedStartMs: Date.UTC(2026, 5, 25, 18, 0, 0), // +5 days, well outside live tolerance
    status: 'scheduled'
  };
  const r = a.scoreCandidate(m, farTime, { nowMs: NOW });
  assert.equal(r.accepted, false);
});

test('selectBestCandidate: picks clear winner; flags ambiguity on near-tie', () => {
  a.__control.setNow(NOW);
  const m = liveMatch();
  const base = {
    homeName: 'Boston Red Sox', awayName: 'New York Yankees', competitionName: 'MLB',
    normalizedStartMs: Date.UTC(2026, 5, 20, 18, 0, 0), status: 'inprogress',
    anchorKind: 'torn-start', offsetDays: 0
  };
  const winner = a.selectBestCandidate(m, [{ ...base, providerEventId: '1' }, { ...base, homeName: 'Chicago Cubs', awayName: 'LA Dodgers', providerEventId: '2' }], { nowMs: NOW });
  assert.equal(winner.resolution.candidate.providerEventId, '1');
  assert.equal(winner.ambiguous, false);

  const tie = a.selectBestCandidate(m, [{ ...base, providerEventId: '1' }, { ...base, providerEventId: '2' }], { nowMs: NOW });
  assert.equal(tie.resolution, null);
  assert.equal(tie.ambiguous, true);
});

test('isCandidateTimeCompatible: live tolerance 36h, upcoming 12h', () => {
  a.__control.setNow(NOW);
  const m = liveMatch();
  const anchor = Date.UTC(2026, 5, 20, 18, 0, 0);
  const within = anchor + 10 * 60 * 60 * 1000;  // +10h
  const beyond = anchor + 30 * 60 * 60 * 1000;  // +30h
  assert.equal(a.isCandidateTimeCompatible(m, { normalizedStartMs: within }, anchor, true, NOW), true);
  assert.equal(a.isCandidateTimeCompatible(m, { normalizedStartMs: beyond }, anchor, false, NOW), false);
});

test('isCricketMatch / isGlobalDateSport', () => {
  assert.equal(a.isCricketMatch({ sportKey: 'cricket' }), true);
  assert.equal(a.isCricketMatch({ sport: 'Cricket' }), true);
  assert.equal(a.isGlobalDateSport({ sportKey: 'tennis' }), true);
  assert.equal(a.isGlobalDateSport({ sportKey: 'baseball' }), false);
});

test('makeCandidateDedupKey + dedupeCandidates merge same event from multiple dates', () => {
  const c1 = { providerKey: 'espn', providerEventId: '42', homeName: 'A', awayName: 'B', queriedDate: '2026-06-20', offsetDays: 0 };
  const c2 = { providerKey: 'espn', providerEventId: '42', homeName: 'A', awayName: 'B', queriedDate: '2026-06-21', offsetDays: 1 };
  const out = a.dedupeCandidates([c1, c2]);
  assert.equal(out.length, 1);
  assert.equal(out[0].discoveredBy.length, 2);
});

test('dedupeCandidates falls back to team tuple when no event id', () => {
  const c1 = { providerKey: 'sofascore', homeName: 'Team A', awayName: 'Team B', normalizedStartMs: 123 };
  const c2 = { providerKey: 'sofascore', homeName: 'team a', awayName: 'team b', normalizedStartMs: 123 };
  assert.equal(a.dedupeCandidates([c1, c2]).length, 1);
});

test('hasCompetitionCompatibility: substring either direction', () => {
  assert.equal(a.hasCompetitionCompatibility({ competition: 'MLB' }, { competitionName: 'MLB Regular Season' }), true);
  assert.equal(a.hasCompetitionCompatibility({ competition: 'NHL' }, { competitionName: 'KHL' }), false);
  assert.equal(a.hasCompetitionCompatibility({ competition: '' }, { competitionName: 'x' }), false);
});

test('parseGameTeams splits on vs / v / @', () => {
  assert.deepEqual(a.parseGameTeams('Boston Red Sox vs New York Yankees').join('|'), 'Boston Red Sox|New York Yankees');
  assert.deepEqual(a.parseGameTeams('India v Australia').join('|'), 'India|Australia');
  assert.deepEqual(a.parseGameTeams('A @ B').join('|'), 'A|B');
  assert.deepEqual(a.parseGameTeams('No Separator Here').join('|'), 'No Separator Here|');
});
