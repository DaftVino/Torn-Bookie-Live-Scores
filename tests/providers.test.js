'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

const a = loadUserscript();

test('detectEsportsGameKey matches by sport/stage/competition aliases', () => {
  assert.equal(a.detectEsportsGameKey({ sport: 'Counter-Strike' }), 'counter-strike');
  assert.equal(a.detectEsportsGameKey({ competition: 'CSGO Major' }), 'counter-strike');
  // Note: the 'cs2' alias is <=3 chars so it only matches as an exact token; a
  // competition string like 'CS2 Major' is NOT detected (see audit, Informational).
  assert.equal(a.detectEsportsGameKey({ competition: 'CS2 Major' }), '');
  // 'LoL Worlds' is NOT detected: 'lol' is exact-only and 'league of legends'
  // is not a substring of 'lol worlds' (see audit, Informational).
  assert.equal(a.detectEsportsGameKey({ stage: 'LoL Worlds' }), '');
  assert.equal(a.detectEsportsGameKey({ sport: 'League of Legends' }), 'league-of-legends');
  assert.equal(a.detectEsportsGameKey({ name: 'Dota 2 The International' }), 'dota-2');
  assert.equal(a.detectEsportsGameKey({ sport: 'Valorant' }), 'valorant');
  assert.equal(a.detectEsportsGameKey({ sport: 'Baseball' }), '');
});

test('detectEsportsGameKey short-alias requires exact token (no substring on <=3 chars)', () => {
  // "lol" is <=3 chars so it must equal a token, not be a substring of e.g. "Holloway"
  assert.equal(a.detectEsportsGameKey({ name: 'Max Holloway' }), '');
  assert.equal(a.detectEsportsGameKey({ name: 'lol' }), 'league-of-legends');
});

test('isExcludedSport excludes horse racing but never esports', () => {
  assert.equal(a.isExcludedSport({ sport: 'Horse Racing' }), true);
  assert.equal(a.isExcludedSport({ alias: 'horse-racing' }), true);
  assert.equal(a.isExcludedSport({ sport: 'Counter-Strike' }), false);
  assert.equal(a.isExcludedSport({ sport: 'Baseball' }), false);
});

test('getSportKey / getSportLabel for esports and traditional', () => {
  assert.equal(a.getSportKey({ sport: 'Counter-Strike' }), 'counter-strike');
  assert.equal(a.getSportLabel({ sport: 'Counter-Strike' }), 'Counter-Strike');
  assert.equal(a.getSportKey({ sport: 'Baseball' }), 'baseball');
  assert.equal(a.getSportLabel({ sport: 'Motorsports' }), 'Formula 1');
  assert.equal(a.getSportLabel({ sport: 'Mixed Martial arts' }), 'MMA / UFC');
});

test('chooseScoreSource routes leagues to the right provider', () => {
  assert.equal(a.chooseScoreSource({ sport: 'Baseball', stage: 'MLB' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Hockey', stage: 'NHL' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Basketball', competition: 'NBA' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'World Championship' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'FIFA Club World Cup' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'Australian A-League Men' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'Norwegian Eliteserien' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Tennis' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Australian Football' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Rugby League', sportKey: 'rugby-league' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Rugby', sportKey: 'rugby' }), 'apisports');
  assert.equal(a.chooseScoreSource({ sport: 'Cricket', sportKey: 'cricket' }), 'espncricinfo');
  assert.equal(a.chooseScoreSource({ sport: 'Counter-Strike' }), 'pandascore');
  assert.equal(a.chooseScoreSource({ sport: 'Football' }), 'torn'); // generic soccer -> default
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'MLS Next Pro' }), 'torn'); // no ESPN slug
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'Chile Cup' }), 'torn'); // no ESPN slug
});

test('getEspnKey maps recognised leagues, null otherwise', () => {
  assert.equal(a.getEspnKey({ sport: 'Baseball', stage: 'MLB' }), 'baseball_mlb');
  assert.equal(a.getEspnKey({ sport: 'American Football', competition: 'NFL' }), 'football_nfl');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'World Cup' }), 'soccer_world');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'World Championship' }), 'soccer_world');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'FIFA Club World Cup' }), 'soccer_fifa_cwc');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Australian A-League Men' }), 'soccer_aus_aleague');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Norwegian Eliteserien' }), 'soccer_nor_elite');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Premier League 2025/2026(Tanzania 1)' }), null);
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'MLS Next Pro' }), null);
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Georgia' }), null);
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Latvia' }), null);
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Lithuania' }), null);
  assert.equal(a.getEspnKey({ sport: 'Australian Football' }), 'australian_football_afl');
  assert.equal(a.getEspnKey({ sport: 'Rugby League', sportKey: 'rugby-league' }), 'rugby_league_nrl');
  assert.equal(a.getEspnKey({ sport: 'Tennis' }), 'tennis_all');
});

test('C2-FIX: getEspnKey maps the high-value soccer leagues', () => {
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'UEFA Champions League' }), 'soccer_uefa_champions');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'English Premier League' }), 'soccer_eng_pl');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Premier League', league: 'England' }), 'soccer_eng_pl');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Premier League', league: 'eng.1' }), 'soccer_eng_pl');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Premier League 2025/2026(Tanzania 1)' }), null);
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Spanish La Liga' }), 'soccer_esp_laliga');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'German Bundesliga' }), 'soccer_ger_bundesliga');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'French Ligue 1' }), 'soccer_fra_ligue1');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Italian Serie A' }), 'soccer_ita_seriea');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Brazil Serie A' }), 'soccer_bra_seriea');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Major League Soccer' }), 'soccer_usa_mls');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'Mexican Liga MX' }), 'soccer_mex_ligamx');
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'English Premier League' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Football', competition: 'Premier League 2025/2026(Tanzania 1)' }), 'torn');
  // The MLS top-flight matcher must not swallow MLS Next Pro (a different ESPN board).
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'MLS Next Pro' }), null);
  // Every mapped key must resolve to a real ESPN_ENDPOINTS URL (guards against typos).
  for (const comp of ['UEFA Champions League', 'English Premier League', 'Spanish La Liga', 'Italian Serie A', 'Brazil Serie A']) {
    const key = a.getEspnKey({ sport: 'Football', competition: comp });
    assert.ok(a.ESPN_ENDPOINTS[key], `expected ESPN_ENDPOINTS["${key}"] to exist for ${comp}`);
  }
});

test('isProviderSupportedForSport keys off sportKey maps', () => {
  assert.equal(a.isProviderSupportedForSport('espn', { sport: 'Baseball', stage: 'MLB' }), true);
  assert.equal(a.isProviderSupportedForSport('espn', { sport: 'Australian Football' }), true);
  assert.equal(a.isProviderSupportedForSport('espn', { sport: 'Rugby League', sportKey: 'rugby-league' }), true);
  assert.equal(a.isProviderSupportedForSport('espncricinfo', { sport: 'Cricket', sportKey: 'cricket' }), true);
  assert.equal(a.isProviderSupportedForSport('sofascore', { sportKey: 'tennis' }), true);
  assert.equal(a.isProviderSupportedForSport('livescore', { sportKey: 'football' }), false); // soccer excluded
  assert.equal(a.isProviderSupportedForSport('thescore', { sportKey: 'basketball' }), false);
  assert.equal(a.isProviderSupportedForSport('pandascore', { sportKey: 'counter-strike' }), true);
});

test('getProviderPriority filters by enabled + supported and de-dupes primary', () => {
  // Baseball/MLB: primary espn. thescore/bbcsport disabled by default; livescore/sofascore
  // support depends on sportKey map. Expect espn first.
  const order = a.getProviderPriority({ sport: 'Baseball', stage: 'MLB', sportKey: 'baseball', sourceKey: 'espn' });
  assert.equal(order[0], 'espn');
  assert.ok(!order.includes('thescore')); // disabled by default

  const soccer = a.getProviderPriority({
    sport: 'Football',
    competition: 'Norwegian Eliteserien',
    sportKey: 'football',
    sourceKey: 'espn'
  });
  assert.equal(soccer[0], 'espn');

  // Tennis -> SofaScore first while ESPN ID coverage is incomplete.
  const tennis = a.getProviderPriority({ sport: 'Tennis', sportKey: 'tennis', sourceKey: 'espn' });
  assert.equal(tennis[0], 'sofascore');
  assert.equal(tennis[1], 'espn');
  assert.ok(!tennis.includes('livescore'));
  assert.ok(!tennis.includes('thescore'));
  assert.ok(!tennis.includes('bbcsport'));

  // Australian Football -> espn primary; sofascore/livescore follow
  const afl = a.getProviderPriority({ sport: 'Australian Football', sportKey: 'australian-football', sourceKey: 'espn' });
  assert.equal(afl[0], 'espn');
});

test('isProviderSupportedForSport: ESPN now supports tennis', () => {
  assert.equal(a.isProviderSupportedForSport('espn', { sport: 'Tennis', sportKey: 'tennis' }), true);
  assert.equal(a.isProviderSupportedForSport('espn', { sport: 'Baseball', stage: 'MLB' }), true);
  assert.equal(a.isProviderSupportedForSport('espn', { sport: 'Football', competition: 'Chile Cup' }), false);
});

test('ESPN_ENDPOINTS includes tennis_all, australian_football_afl, and rugby_league_nrl', () => {
  assert.ok(a.ESPN_ENDPOINTS.tennis_all.includes('/tennis/all/scoreboard'));
  assert.ok(!a.ESPN_ENDPOINTS.tennis_atp, 'tennis_atp should be removed');
  assert.ok(!a.ESPN_ENDPOINTS.tennis_wta, 'tennis_wta should be removed');
  assert.ok(a.ESPN_ENDPOINTS.australian_football_afl.includes('/australian-football/afl/scoreboard'));
  assert.ok(a.ESPN_ENDPOINTS.rugby_league_nrl.includes('/rugby-league/3/scoreboard'));
});

test('getProviderPriority suppresses known 404 tennis providers even if toggled', () => {
  assert.ok(!a.getProviderPriority({ sportKey: 'tennis', sourceKey: 'sofascore' }).includes('thescore'));
  a.uiSettings.enabledProviders.thescore = true;
  assert.ok(!a.getProviderPriority({ sportKey: 'tennis', sourceKey: 'sofascore' }).includes('thescore'));
  a.uiSettings.enabledProviders.thescore = false; // restore
});

test('Tanzania Premier League routes to football fallbacks, not ESPN English Premier League', () => {
  const b = loadUserscript();
  b.setApiSportsKey('test-key-tanzania');
  b.uiSettings.enabledProviders.apifootball = true;
  const match = {
    sport: 'Football',
    sportKey: 'football',
    competition: 'Premier League 2025/2026(Tanzania 1)',
    sourceKey: 'torn'
  };
  const priority = b.getProviderPriority(match);
  assert.equal(b.getEspnKey(match), null);
  assert.ok(!priority.includes('espn'), priority.join(','));
  assert.ok(priority.includes('sofascore'), priority.join(','));
  assert.ok(priority.includes('apifootball'), priority.join(','));
});

test('known 404 tennis providers are not supported until remapped', () => {
  assert.equal(a.isProviderSupportedForSport('livescore', { sportKey: 'tennis' }), false);
  assert.equal(a.isProviderSupportedForSport('thescore', { sportKey: 'tennis' }), false);
  assert.equal(a.isProviderSupportedForSport('bbcsport', { sportKey: 'tennis' }), false);
});

test('isNhlMatch detects NHL via stage/competition', () => {
  assert.equal(a.isNhlMatch({ sport: 'Hockey', stage: 'NHL' }), true);
  assert.equal(a.isNhlMatch({ sport: 'Hockey', competition: 'AHL' }), false);
  assert.equal(a.isNhlMatch({ sport: 'Baseball' }), false);
});

test('getStatsProviderPriority picks NHL/football/default ladders', () => {
  assert.equal(a.getStatsProviderPriority({ sport: 'Hockey', stage: 'NHL' })[0], 'nhl');
  assert.equal(a.getStatsProviderPriority({ sportKey: 'american-football' })[0], 'espn-reuse');
  assert.equal(a.getStatsProviderPriority({ sportKey: 'baseball' })[0], 'espn-reuse');
});

// -- _findEspnTennis ----------------------------------------------------------
// Verified shape (Wimbledon 2026): flat events[].competitors[] — no groupings, no team object.
// Scores in linescores[].value (numeric, e.g. 7.0).

function makeTennisAllBoard(overrides = {}) {
  return {
    events: [{
      id: 'wimbledon-match-1',
      name: 'Wimbledon',
      date: '2026-06-20T14:00Z',
      status: { type: { shortDetail: 'Final', name: 'STATUS_FINAL' } },
      competitors: [
        {
          homeAway: 'home',
          winner: true,
          athlete: { displayName: 'Novak Djokovic', fullName: 'Novak Djokovic', shortName: 'N. Djokovic' },
          linescores: [{ value: 7 }, { value: 6 }]
        },
        {
          homeAway: 'away',
          winner: false,
          athlete: { displayName: 'Carlos Alcaraz', fullName: 'Carlos Alcaraz', shortName: 'C. Alcaraz' },
          linescores: [{ value: 5 }, { value: 4 }]
        }
      ]
    }],
    ...overrides
  };
}

function makeTennisAllBoardWta(overrides = {}) {
  return {
    events: [{
      id: 'eastbourne-match-1',
      name: 'Eastbourne',
      date: '2026-06-20T16:00Z',
      status: { type: { shortDetail: 'In Progress', name: 'STATUS_IN_PROGRESS' } },
      competitors: [
        {
          homeAway: 'home',
          winner: false,
          athlete: { displayName: 'Iga Swiatek', fullName: 'Iga Swiatek', shortName: 'I. Swiatek' },
          linescores: [{ value: 6 }, { value: 3 }]
        },
        {
          homeAway: 'away',
          winner: false,
          athlete: { displayName: 'Coco Gauff', fullName: 'Coco Gauff', shortName: 'C. Gauff' },
          linescores: [{ value: 4 }, { value: 1 }]
        }
      ]
    }],
    ...overrides
  };
}

// C3-FIX: URL contract — leagueId + eventId in query params
test('_findEspnTennis: URL uses /tennis/all/scoreboard with leagueId and eventId', async () => {
  const b = loadUserscript({
    gmXmlhttpRequest: (req) => {
      return { type: 'load', response: { status: 200, responseText: JSON.stringify({ events: [] }), responseHeaders: '' } };
    }
  });
  b.__resetCaches();
  const match = {
    sport: 'Tennis', sportKey: 'tennis', team1: 'Djokovic', team2: 'Alcaraz',
    startTimestamp: String(Date.UTC(2026, 5, 22, 14, 0, 0) / 1000),
    sourceKey: 'espn'
  };
  await b._findEspnTennis(match);
  const urls = b.__control.gmRequests.map(r => r.url);
  // Wimbledon (leagueId=188) must appear with correct eventId and dates
  const wimbledonUrl = urls.find(u => u.includes('leagueId=188'));
  assert.ok(wimbledonUrl, 'should request leagueId=188 (Wimbledon)');
  assert.ok(wimbledonUrl.includes('eventId=188-2026'), `expected eventId=188-2026 in: ${wimbledonUrl}`);
  assert.ok(wimbledonUrl.includes('dates=20260622'), `expected dates=20260622 in: ${wimbledonUrl}`);
  assert.ok(wimbledonUrl.includes('/tennis/all/scoreboard'), `expected /tennis/all/scoreboard in: ${wimbledonUrl}`);
});

// C3-FIX: Multiple league IDs queried
test('_findEspnTennis: all TENNIS_LEAGUE_IDS are queried', async () => {
  const b = loadUserscript({
    gmXmlhttpRequest: () => ({ type: 'load', response: { status: 200, responseText: JSON.stringify({ events: [] }), responseHeaders: '' } })
  });
  b.__resetCaches();
  const match = {
    sport: 'Tennis', sportKey: 'tennis', team1: 'Djokovic', team2: 'Alcaraz',
    startTimestamp: String(Date.UTC(2026, 5, 22, 14, 0, 0) / 1000),
    sourceKey: 'espn'
  };
  await b._findEspnTennis(match);
  const leagueIds = b.__control.gmRequests
    .map(r => { const m = r.url.match(/leagueId=(\d+)/); return m ? m[1] : null; })
    .filter(Boolean);
  // At minimum, all 5 seeded league IDs should appear (188, 444, 637, 636, 635).
  // 2026-06-24 ESPN probe verified Wimbledon qualifying/Eastbourne/Mallorca/Bad
  // Homburg on the tennis/all board; Plovdiv was not present there.
  for (const id of ['188', '444', '637', '636', '635']) {
    assert.ok(leagueIds.includes(id), `leagueId=${id} not found in requests`);
  }
});

// C3-FIX: Flat shape extraction — linescores[].value (numeric)
test('_findEspnTennis: extracts candidate from verified flat shape (linescores value)', async () => {
  const b = loadUserscript({
    gmXmlhttpRequest: (req) => {
      const body = req.url.includes('leagueId=188') ? makeTennisAllBoard() : { events: [] };
      return { type: 'load', response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' } };
    }
  });
  b.__resetCaches();
  const match = {
    sport: 'Tennis', sportKey: 'tennis', team1: 'Djokovic', team2: 'Alcaraz',
    startTimestamp: String(Date.UTC(2026, 5, 20, 14, 0, 0) / 1000),
    sourceKey: 'espn'
  };
  const result = await b._findEspnTennis(match);
  assert.equal(result.found, true, `expected found; detail: ${result.detail}`);
  assert.equal(result.team1Score, '7 6');
  assert.equal(result.team2Score, '5 4');
});

// C3-FIX: Match found in second tournament (different leagueId)
test('_findEspnTennis: finds match in a second tournament when first returns empty', async () => {
  const b = loadUserscript({
    gmXmlhttpRequest: (req) => {
      // Eastbourne (leagueId=444) has the match; Wimbledon (188) is empty
      const body = req.url.includes('leagueId=444') ? makeTennisAllBoardWta() : { events: [] };
      return { type: 'load', response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' } };
    }
  });
  b.__resetCaches();
  const match = {
    sport: 'Tennis', sportKey: 'tennis', team1: 'Swiatek', team2: 'Gauff',
    startTimestamp: String(Date.UTC(2026, 5, 20, 16, 0, 0) / 1000),
    sourceKey: 'espn'
  };
  const result = await b._findEspnTennis(match);
  assert.equal(result.found, true, `expected found; detail: ${result.detail}`);
  assert.equal(result.team1Score, '6 3');
  assert.equal(result.team2Score, '4 1');
});

// C3-FIX: Caching — N requests on first call, 0 new requests on second call
test('_findEspnTennis: caches per (leagueId-year, date) — no duplicate requests on second call', async () => {
  const b = loadUserscript({
    gmXmlhttpRequest: (req) => {
      const body = req.url.includes('leagueId=188') ? makeTennisAllBoard() : { events: [] };
      return { type: 'load', response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' } };
    }
  });
  b.__resetCaches();
  const match = {
    sport: 'Tennis', sportKey: 'tennis', team1: 'Djokovic', team2: 'Alcaraz',
    startTimestamp: String(Date.UTC(2026, 5, 20, 14, 0, 0) / 1000),
    sourceKey: 'espn'
  };
  await b._findEspnTennis(match);
  const afterFirst = b.__control.gmRequests.length;
  await b._findEspnTennis(match);
  // Second call: all tournaments already cached, no new network requests
  assert.equal(b.__control.gmRequests.length, afterFirst, 'second call should make 0 new requests (all cached)');
  // First call should have queried all 5 seeded league IDs
  assert.equal(afterFirst, 5, `expected 5 requests (one per league ID), got ${afterFirst}`);
});

// C3-FIX: Negative — empty events array records no candidates, does not throw
test('_findEspnTennis: graceful when all boards return empty events', async () => {
  const b = loadUserscript({
    gmXmlhttpRequest: () => ({ type: 'load', response: { status: 200, responseText: JSON.stringify({ events: [] }), responseHeaders: '' } })
  });
  b.__resetCaches();
  const match = {
    sport: 'Tennis', sportKey: 'tennis', team1: 'Djokovic', team2: 'Alcaraz',
    startTimestamp: String(Date.UTC(2026, 5, 20, 14, 0, 0) / 1000),
    sourceKey: 'espn'
  };
  const result = await b._findEspnTennis(match);
  assert.equal(result.found, false);
  assert.ok(typeof result.detail === 'string');
});

// C3-FIX: Negative — boards with error field record errors without throwing
test('_findEspnTennis: graceful when all boards have errors', async () => {
  const b = loadUserscript({
    gmXmlhttpRequest: () => ({ type: 'load', response: { status: 200, responseText: '{"error":"unavailable"}', responseHeaders: '' } })
  });
  b.__resetCaches();
  const match = {
    sport: 'Tennis', sportKey: 'tennis', team1: 'Djokovic', team2: 'Alcaraz',
    startTimestamp: String(Date.UTC(2026, 5, 20, 14, 0, 0) / 1000),
    sourceKey: 'espn'
  };
  const result = await b._findEspnTennis(match);
  assert.equal(result.found, false);
  assert.ok(typeof result.detail === 'string');
});

// ---------------------------------------------------------------------------
// Fix 3 — per-sport quota: distinct keys, not one overwritten value
// ---------------------------------------------------------------------------

test('Fix 3: rugby and AFL _findApiSports calls write distinct latestApiSportsQuota keys', async () => {
  const makeBoard = (home, away) => JSON.stringify({
    errors: [],
    results: 1,
    response: [{
      teams: { home: { name: home }, away: { name: away } },
      scores: { home: { current: 0 }, away: { current: 0 } },
      status: { short: 'NS', long: 'Not Started' },
      league: { name: 'Test League', id: 1 },
      fixture: { id: 1, timestamp: Math.floor(Date.UTC(2026, 5, 22, 10, 0, 0) / 1000) }
    }]
  });

  const c = loadUserscript({
    gmXmlhttpRequest: (req) => ({
      type: 'load',
      response: {
        status: 200,
        responseText: req.url.includes('rugby') ? makeBoard('Lions', 'Sharks') : makeBoard('Collingwood', 'Carlton'),
        responseHeaders: 'x-ratelimit-requests-remaining: 90\r\nx-ratelimit-remaining: 8\r\n'
      }
    })
  });
  c.__resetCaches();
  c.setApiSportsKey('quota-test-key');
  c.uiSettings.apiSportsRefreshMode = 'auto';

  await c._findApiSports({ sport: 'Rugby', sportKey: 'rugby', team1: 'Lions', team2: 'Sharks',
    startTimestamp: String(Date.UTC(2026, 5, 22, 10, 0, 0)), status: 'notstarted', sourceKey: 'torn' });

  await c._findApiSports({ sport: 'Australian Football', sportKey: 'australian-football',
    team1: 'Collingwood', team2: 'Carlton',
    startTimestamp: String(Date.UTC(2026, 5, 22, 12, 0, 0)), status: 'notstarted', sourceKey: 'torn' });

  const report = c.buildDebugReport();
  const quota = report.settings.apiSportsQuota;
  assert.ok(quota && typeof quota === 'object', 'apiSportsQuota must be an object in the debug report');
  assert.ok('API-Sports Rugby' in quota, 'must have a Rugby key');
  assert.ok('API-Sports AFL' in quota, 'must have an AFL key');
  assert.equal(quota['API-Sports Rugby'].dayRemaining, '90', 'rugby day-remaining must be recorded');
  assert.equal(quota['API-Sports AFL'].dayRemaining, '90', 'AFL day-remaining must be recorded');
});
