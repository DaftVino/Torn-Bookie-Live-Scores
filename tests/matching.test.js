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
  assert.equal(a.normalizeName('Tom\u00e1s Barrios Vera'), 'tomas barrios vera');
  assert.equal(a.normalizeName('St. George'), 'st george');
  assert.equal(a.normalizeName('  Multiple   Spaces '), 'multiple spaces');
  assert.equal(a.normalizeName(null), '');
});

test('calcTeamMatchScore: exact, alias, containment, jaccard', () => {
  assert.equal(a.calcTeamMatchScore('Boston Red Sox', 'boston red sox'), 100);
  assert.equal(a.calcTeamMatchScore('Cloud9', 'C9'), 95);          // alias
  assert.equal(a.calcTeamMatchScore('Natus Vincere', 'NaVi'), 95); // alias
  assert.equal(a.calcTeamMatchScore('FC Barcelona', 'Barcelona'), 80); // safe token containment (only extra token is neutral affix "fc")
  assert.equal(a.calcTeamMatchScore('', 'x'), 0);
});

test('calcTeamMatchScore: min-length guard catches short containment (York/New York)', () => {
  // The shorter side ("York", 4 chars) is below MIN_LEN, so containment is skipped
  // and the score drops to the jaccard path. This is the case the guard DOES cover.
  assert.ok(a.calcTeamMatchScore('York', 'New York') < 60);
});

// ---- Fixed (Medium): containment no longer over-matches contained names ----
// Raw character containment used to grant 80 whenever a >=5-char normalized name was a
// substring of a longer one, so "mexico" matched "new mexico", "arsenal" matched
// "arsenal reserves", and "united" matched "manchester united". Conservative token-
// sequence containment now only returns 80 when the shorter name's full token sequence
// is contiguous in the longer name AND every leftover token is a neutral club affix
// (fc/cf/sc/club). A disqualifying qualifier ("new", "reserves", ...), a non-neutral
// extra token ("manchester"), or a generic single token ("united") falls through to the
// Jaccard path, which scores these below CONFIDENCE_THRESHOLD.
const CONFIDENCE_THRESHOLD = a.CONFIDENCE_THRESHOLD;
test('FIXED: containment does not over-match contained names (< threshold)', () => {
  // "new" is a disqualifying qualifier -> not a neutral affix -> falls through to Jaccard.
  assert.ok(a.calcTeamMatchScore('Mexico', 'New Mexico') < CONFIDENCE_THRESHOLD);
  // "reserves" is a disqualifying qualifier.
  assert.ok(a.calcTeamMatchScore('Arsenal', 'Arsenal Reserves') < CONFIDENCE_THRESHOLD);
  // "united" is an ambiguous generic single token AND "manchester" is a non-neutral extra.
  assert.ok(a.calcTeamMatchScore('United', 'Manchester United') < CONFIDENCE_THRESHOLD);
  // The full (both-sides) pair must no longer be accepted in either orientation.
  const m = { team1: 'Mexico', team2: 'USA' };
  assert.ok(a.matchTeamPair(m, 'New Mexico', 'USA').confidence < CONFIDENCE_THRESHOLD);
  assert.ok(a.matchTeamPair(m, 'USA', 'New Mexico').confidence < CONFIDENCE_THRESHOLD);
});

// Disqualifying qualifiers (reserve/youth/gender/secondary-squad) must each block the
// 80 containment score. These are the qualifiers called out by the fix plan. The phase
// scope is the containment branch only, so the guarantee is "no 80" (< 80); Phase D
// separately covers the 1-2 char qualifier Jaccard residual below.
test('FIXED: disqualifying qualifiers block containment confidence', () => {
  for (const q of ['New', 'Reserve', 'Reserves', 'Women', 'W', 'B', 'II', 'U19', 'U21', 'U23']) {
    assert.ok(
      a.calcTeamMatchScore('Chelsea', `Chelsea ${q}`) < 80,
      `expected "Chelsea" / "Chelsea ${q}" to be denied the 80 containment score`
    );
  }
  // Multi-character qualifiers also fall fully below threshold via Jaccard.
  for (const q of ['New', 'Reserve', 'Reserves', 'Women', 'U19', 'U21', 'U23']) {
    assert.ok(a.calcTeamMatchScore('Chelsea', `Chelsea ${q}`) < CONFIDENCE_THRESHOLD);
  }
});

test('FIXED: short secondary-side qualifiers block Jaccard confidence', () => {
  for (const q of ['B', 'II', 'W']) {
    assert.ok(
      a.calcTeamMatchScore('Central SC', `Central ${q}`) < CONFIDENCE_THRESHOLD,
      `expected "Central SC" / "Central ${q}" to stay below confidence threshold`
    );
  }
});

test('FIXED: reserve and youth qualifiers block Jaccard confidence', () => {
  for (const q of ['2', 'Reserve', 'Reserves', 'Women', 'U19', 'U21', 'U23', 'Youth']) {
    assert.ok(
      a.calcTeamMatchScore('Central SC', `Central ${q}`) < CONFIDENCE_THRESHOLD,
      `expected "Central SC" / "Central ${q}" to stay below confidence threshold`
    );
  }
});

// Generic one-token names must not qualify by containment alone, even when the only
// leftover token is an otherwise-neutral affix: "United"/"United FC" must NOT get the 80
// containment score (it would have, pre-fix). The plan's threshold guarantee for generic
// tokens is the "United"/"Manchester United" case covered above.
test('FIXED: generic single-token names cannot qualify by containment alone', () => {
  for (const g of ['United', 'City', 'Town', 'Athletic', 'Sporting', 'Racing', 'Real']) {
    assert.ok(
      a.calcTeamMatchScore(g, `${g} FC`) < 80,
      `expected generic "${g}" / "${g} FC" to be denied the 80 containment score`
    );
  }
});

// Positive regression: legitimate contiguous token-sequence containment still scores 80.
// Path for each: none of these names are in TEAM_ALIASES and none are exact, so the score
// comes from the safe token-containment branch (the only extra token is a neutral affix).
test('FIXED: legitimate neutral-affix containment still scores 80', () => {
  assert.equal(a.calcTeamMatchScore('Barcelona', 'FC Barcelona'), 80);            // extra "fc"
  assert.equal(a.calcTeamMatchScore('Real Madrid', 'Real Madrid CF'), 80);        // extra "cf"
  assert.equal(a.calcTeamMatchScore('Manchester United', 'Manchester United FC'), 80); // extra "fc"
  assert.equal(a.calcTeamMatchScore('Central SC', 'Central'), 80);                // extra "sc"
  // Multi-token containment is direction-independent.
  assert.equal(a.calcTeamMatchScore('Real Madrid CF', 'Real Madrid'), 80);
});

test('football club aliases are generated from openfootball data', () => {
  assert.ok(a.FOOTBALL_CLUB_ALIAS_GROUPS.length > 2000);
  assert.equal(a.calcTeamMatchScore('RSB Berkane', 'RS Berkane'), 35);
  assert.equal(a.calcFootballClubMatchScore('RSB Berkane', 'RS Berkane'), 95);
  assert.equal(a.calcFootballClubMatchScore('FAR Rabat', 'AS FAR Rabat'), 95);
  assert.equal(a.calcFootballClubMatchScore('MAS Fes', 'Maghreb AS de Fès'), 95);
});

test('football fuzzy aliases resolve debug-report Moroccan club variants', () => {
  const cases = [
    ['RSB Berkane', 'FAR Rabat', 'RS Berkane', 'AS FAR Rabat'],
    ['Renaissance Club Zemamra', 'Olympic Club de Safi', 'RCA Zemamra', 'OC Safi'],
    ['Renaissance Club Zemamra', 'Olympic Club de Safi', 'Renaissance Zemamra', 'Olympique Safi'],
    ['Union Touarga Sport', 'Difaa El Jadida', 'US Touarga', 'Difaâ Hassani El-Jadidi']
  ];
  for (const [team1, team2, home, away] of cases) {
    const pair = a.matchTeamPair({ team1, team2, sportKey: 'football' }, home, away);
    assert.equal(pair.team1IsHome, true, `${team1} / ${team2}`);
    assert.ok(pair.confidence >= a.CONFIDENCE_THRESHOLD, `${team1} / ${team2}`);
  }
});

test('football acronym aliases resolve compact provider names', () => {
  assert.equal(a.calcFootballClubMatchScore('KACM', 'Kawkab Athletic Club Marrakech'), 95);
  assert.equal(a.calcFootballClubMatchScore('CODM Meknes', 'Club Omnisports De Meknès'), 95);
  assert.equal(a.calcFootballClubMatchScore('FUS Rabat', 'Fath Union Sport Rabat'), 95);
});

test('football alias fallback keeps obvious false positives below threshold', () => {
  assert.equal(a.calcFootballClubMatchScore('Manchester United', 'Manchester City'), 0);
  assert.ok(
    a.matchTeamPair({ team1: 'Manchester United', team2: 'Arsenal', sportKey: 'football' }, 'Manchester City', 'Arsenal').confidence < a.CONFIDENCE_THRESHOLD
  );
  assert.equal(a.calcFootballClubMatchScore('United', 'United FC'), 0);
  assert.equal(a.calcFootballClubMatchScore('City', 'City FC'), 0);
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

test('scoreCandidate accepts tennis players with safe extra trailing surname tokens', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({
    team1: 'Paul Jubb',
    team2: 'Tomas Barrios',
    sport: 'Tennis',
    sportKey: 'tennis',
    competition: 'Plovdiv 2026(Challenger)',
    startTimestamp: String(Date.UTC(2026, 5, 24, 12, 0, 0))
  });
  const cand = {
    providerKey: 'sofascore',
    providerEventId: 'jubb-barrios',
    homeName: 'Paul Jubb',
    awayName: 'Tom\u00e1s Barrios Vera',
    competitionName: 'Plovdiv 2026',
    normalizedStartMs: Date.UTC(2026, 5, 24, 12, 0, 0),
    status: '1st set',
    anchorKind: 'torn-start',
    offsetDays: 0
  };

  const s = a.scoreCandidate(m, cand, { nowMs: NOW });
  assert.equal(s.accepted, true);
  assert.ok(s.team.confidence >= a.CONFIDENCE_THRESHOLD);
});

test('scoreCandidate accepts tennis provider family-name-first and collapsed hyphen variants', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({
    team1: 'Soon-Woo Kwon',
    team2: 'Arthur Gea',
    sport: 'Tennis',
    sportKey: 'tennis',
    competition: 'Wimbledon, Qualification ATP 2026 (Grand Slam)',
    sectionType: 'live',
    status: 'Match is in progress',
    rawStatus: 'inprogress',
    startTimestamp: ''
  });
  const cand = {
    providerKey: 'sofascore',
    providerEventId: 'kwon-gea',
    homeName: 'Kwon Soonwoo',
    awayName: 'Arthur Gea',
    competitionName: 'Wimbledon Qualification',
    normalizedStartMs: NOW,
    status: '2nd set',
    anchorKind: 'current-live',
    offsetDays: 0
  };

  const s = a.scoreCandidate(m, cand, { nowMs: NOW });
  assert.equal(s.accepted, true);
  assert.ok(s.team.confidence >= a.CONFIDENCE_THRESHOLD);
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

test('resolveProviderMatch records top rejected candidate diagnostics', async () => {
  const b = loadUserscript();
  b.__control.setNow(NOW);
  const m = liveMatch({
    team1: 'Mathys Erhard',
    team2: 'Inaki Montes',
    sport: 'Tennis',
    sportKey: 'tennis',
    competition: 'Plovdiv 2026(Challenger)'
  });
  const step = b.buildLookupStep('torn-start', Date.UTC(2026, 5, 24, 12, 0, 0), 0, 'primary', 'iso');
  const result = await b.resolveProviderMatch(m, 'sofascore', [step], async lookup => ({
    eventCount: 1,
    candidates: [{
      providerKey: 'sofascore',
      providerEventId: 'bad-candidate',
      queriedDate: lookup.providerDate,
      anchorKind: lookup.anchorKind,
      offsetDays: lookup.offsetDays,
      normalizedStartMs: Date.UTC(2026, 5, 24, 12, 0, 0),
      homeName: 'Paul Jubb',
      awayName: 'Tomas Barrios',
      competitionName: 'Plovdiv 2026',
      status: '1st set'
    }]
  }));

  assert.equal(result.resolution, null);
  assert.equal(result.candidateDiagnostics.length, 1);
  assert.equal(result.candidateDiagnostics[0].teams, 'Paul Jubb v Tomas Barrios');
  assert.equal(result.candidateDiagnostics[0].reason, 'team-confidence');
  assert.equal(result.candidateDiagnostics[0].tournament, 'Plovdiv 2026');
  assert.match(b.summarizeProviderResult('SofaScore', result), /top candidate Paul Jubb v Tomas Barrios/);
});

test('resolveProviderMatch records football candidate diagnostics when provider events do not match', async () => {
  const b = loadUserscript();
  b.__control.setNow(NOW);
  const m = liveMatch({
    team1: 'Young Africans',
    team2: 'Azam FC',
    sport: 'Football',
    sportKey: 'football',
    competition: 'Premier League 2025/2026(Tanzania 1)'
  });
  const step = b.buildLookupStep('torn-start', Date.UTC(2026, 5, 24, 13, 0, 0), 0, 'primary', 'iso');
  const result = await b.resolveProviderMatch(m, 'bbcsport', [step], async lookup => ({
    eventCount: 2,
    candidates: [{
      providerKey: 'bbcsport',
      providerEventId: 'bbc-football-candidate',
      queriedDate: lookup.providerDate,
      anchorKind: lookup.anchorKind,
      offsetDays: lookup.offsetDays,
      normalizedStartMs: Date.UTC(2026, 5, 24, 13, 0, 0),
      homeName: 'Dodoma Jiji FC',
      awayName: 'JKT Tanzania',
      competitionName: 'Premier League',
      status: 'inprogress'
    }]
  }));

  assert.equal(result.resolution, null);
  assert.equal(result.candidateDiagnostics.length, 1);
  assert.equal(result.candidateDiagnostics[0].providerKey, 'bbcsport');
  assert.equal(result.candidateDiagnostics[0].teams, 'Dodoma Jiji FC v JKT Tanzania');
  assert.match(b.summarizeProviderResult('BBC Sport', result), /events found/);
  assert.match(b.summarizeProviderResult('BBC Sport', result), /top candidate Dodoma Jiji FC v JKT Tanzania/);
});

test('resolveProviderMatch records Torn-live/provider-scheduled contradictions', async () => {
  const b = loadUserscript();
  b.__control.setNow(NOW);
  const m = liveMatch({
    team1: 'Alina Korneeva',
    team2: 'Andrea Lazaro Garcia',
    sport: 'Tennis',
    sportKey: 'tennis',
    sectionType: 'live',
    status: '1st Set',
    rawStatus: 'inprogress',
    startTimestamp: String(Date.UTC(2026, 5, 24, 12, 0, 0)),
    competition: 'Wimbledon, Qualification WTA 2026(Grand Slam)'
  });
  const step = b.buildLookupStep('torn-start', Date.UTC(2026, 5, 24, 12, 0, 0), 0, 'primary', 'iso');
  const result = await b.resolveProviderMatch(m, 'sofascore', [step], async lookup => ({
    eventCount: 1,
    candidates: [{
      providerKey: 'sofascore',
      providerEventId: 'scheduled-candidate',
      queriedDate: lookup.providerDate,
      anchorKind: lookup.anchorKind,
      offsetDays: lookup.offsetDays,
      normalizedStartMs: Date.UTC(2026, 5, 24, 12, 0, 0),
      homeName: 'Alina Korneeva',
      awayName: 'Andrea Lazaro Garcia',
      competitionName: 'Wimbledon Qualification',
      status: 'scheduled'
    }]
  }));

  assert.ok(result.resolution);
  assert.equal(result.statusDiagnostics.length, 1);
  assert.equal(result.statusDiagnostics[0].providerStatus, 'scheduled');
  assert.equal(result.statusDiagnostics[0].tornRawStatus, 'inprogress');
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
