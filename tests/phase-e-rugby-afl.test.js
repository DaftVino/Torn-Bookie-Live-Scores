'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

function makeNrlBoard(overrides = {}) {
  return {
    leagues: [{ name: 'Rugby League', abbreviation: 'NRL', slug: '3' }],
    events: [{
      id: '401800001',
      uid: 's:20~l:3~e:401800001',
      name: 'Warriors vs Cowboys',
      date: '2026-06-21T06:00Z',
      status: { type: { shortDetail: 'Final', detail: 'Final', name: 'STATUS_FINAL' } },
      competitions: [{
        id: '401800001',
        name: 'Warriors vs Cowboys',
        date: '2026-06-21T06:00Z',
        status: { type: { shortDetail: 'Final', detail: 'Final', name: 'STATUS_FINAL' } },
        competitors: [
          {
            homeAway: 'home',
            score: '38',
            team: { displayName: 'Warriors', name: 'Warriors', shortDisplayName: 'Warriors', abbreviation: 'WAR' }
          },
          {
            homeAway: 'away',
            score: '20',
            team: { displayName: 'Cowboys', name: 'Cowboys', shortDisplayName: 'Cowboys', abbreviation: 'NQL' }
          }
        ]
      }]
    }],
    ...overrides
  };
}

function makeApiSportsBody(homeName, awayName, opts = {}) {
  return {
    get: 'games',
    parameters: { date: opts.date || '2026-06-21' },
    errors: [],
    results: 1,
    response: [{
      game: { id: opts.gameId || 7788 },
      id: opts.id,
      timestamp: opts.timestamp || Math.floor(Date.UTC(2026, 5, 21, 6, 0, 0) / 1000),
      status: { short: opts.statusShort || 'FT', long: opts.statusLong || 'Full Time' },
      league: { name: opts.leagueName || 'NRL' },
      teams: {
        home: { name: homeName },
        away: { name: awayName }
      },
      scores: {
        home: opts.homeScore ?? 18,
        away: opts.awayScore ?? 14
      }
    }]
  };
}

function makeRugbyLeagueMatch(overrides = {}) {
  return {
    sport: 'Rugby League',
    sportKey: 'rugby-league',
    team1: 'Warriors',
    team2: 'Cowboys',
    name: 'Warriors v Cowboys',
    sourceKey: 'espn',
    startTimestamp: String(Date.UTC(2026, 5, 21, 6, 0, 0)),
    status: 'notstarted',
    ...overrides
  };
}

test('Phase E routing maps rugby-league to ESPN NRL and keeps AFL ESPN-primary', () => {
  const a = loadUserscript();
  a.setApiSportsKey('phase-e-key');

  assert.equal(a.chooseScoreSource({ sport: 'Rugby League', sportKey: 'rugby-league' }), 'espn');
  assert.equal(a.getEspnKey({ sport: 'Rugby League', sportKey: 'rugby-league' }), 'rugby_league_nrl');
  assert.ok(a.ESPN_ENDPOINTS.rugby_league_nrl.includes('/rugby-league/3/scoreboard'));

  const nrlPriority = a.getProviderPriority(makeRugbyLeagueMatch());
  assert.equal(nrlPriority[0], 'espn');
  assert.ok(nrlPriority.includes('apisports'));
  assert.ok(nrlPriority.indexOf('espn') < nrlPriority.indexOf('apisports'));

  const aflPriority = a.getProviderPriority({
    sport: 'Australian Football',
    sportKey: 'australian-football',
    sourceKey: 'espn'
  });
  assert.equal(aflPriority[0], 'espn');
  assert.ok(aflPriority.includes('apisports'));
  assert.ok(aflPriority.indexOf('espn') < aflPriority.indexOf('apisports'));
});

test('_findEspn maps standard ESPN NRL scoreboard teams, scores, status, date, and id', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: JSON.stringify(makeNrlBoard()), responseHeaders: '' }
    })
  });
  a.__resetCaches();

  const result = await a._findEspn(makeRugbyLeagueMatch());

  assert.equal(result.found, true, `expected ESPN match; detail: ${result.detail}`);
  assert.equal(result.sourceKey, 'espn');
  assert.equal(result.providerEventId, '401800001');
  assert.equal(result.team1Score, '38');
  assert.equal(result.team2Score, '20');
  assert.equal(result.detail, 'Final');
  assert.equal(result.rawEvent.date, '2026-06-21T06:00Z');
  assert.equal(a.__control.gmRequests[0].url, 'https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=20260621');
});

test('rugby-league staged fallback reaches API-Sports Rugby after ESPN miss', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: req => {
      if (req.url.includes('/rugby-league/3/scoreboard')) {
        return { type: 'load', response: { status: 200, responseText: JSON.stringify({ events: [] }), responseHeaders: '' } };
      }
      return {
        type: 'load',
        response: {
          status: 200,
          responseText: JSON.stringify(makeApiSportsBody('Warriors', 'Cowboys', { homeScore: 19, awayScore: 12 })),
          responseHeaders: 'x-ratelimit-requests-remaining: 91\r\nx-ratelimit-remaining: 8\r\n'
        }
      };
    }
  });
  a.__resetCaches();
  a.setApiSportsKey('phase-e-key');
  a.uiSettings.apiSportsRefreshMode = 'auto';
  a.uiSettings.enabledProviders.sofascore = false;

  const result = await a.findScoreForMatch(makeRugbyLeagueMatch());

  assert.equal(result.found, true, `expected fallback match; errors: ${result.providerErrors}`);
  assert.equal(result.sourceKey, 'apisports');
  assert.deepEqual(Array.from(result.providersTried), ['espn', 'apisports']);
  assert.equal(a.__control.gmRequests[0].url, 'https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=20260621');
  const apiRequest = a.__control.gmRequests.find(req => req.url.includes('v1.rugby.api-sports.io/games'));
  assert.ok(apiRequest, 'expected API-Sports Rugby fallback request');
  assert.equal(apiRequest.url, 'https://v1.rugby.api-sports.io/games?date=2026-06-21');
  assert.equal(apiRequest.headers['x-apisports-key'], 'phase-e-key');
});

test('_findApiSports maps flat scores for rugby union and sends key header', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: {
        status: 200,
        responseText: JSON.stringify(makeApiSportsBody('Leinster', 'Munster', {
          leagueName: 'United Rugby Championship',
          homeScore: 24,
          awayScore: 21
        })),
        responseHeaders: 'x-ratelimit-requests-remaining: 88\r\nx-ratelimit-remaining: 7\r\n'
      }
    })
  });
  a.__resetCaches();
  a.setApiSportsKey('rugby-key');
  a.uiSettings.apiSportsRefreshMode = 'auto';

  const result = await a._findApiSports({
    sport: 'Rugby',
    sportKey: 'rugby',
    team1: 'Leinster',
    team2: 'Munster',
    sourceKey: 'apisports',
    startTimestamp: String(Date.UTC(2026, 5, 21, 6, 0, 0)),
    status: 'notstarted'
  });

  assert.equal(result.found, true, `expected API-Sports rugby match; detail: ${result.detail}`);
  assert.equal(result.sourceKey, 'apisports');
  assert.equal(result.providerEventId, 7788);
  assert.equal(result.team1Score, 24);
  assert.equal(result.team2Score, 21);
  assert.equal(result.detail, 'Full Time');
  assert.equal(a.__control.gmRequests[0].url, 'https://v1.rugby.api-sports.io/games?date=2026-06-21');
  assert.equal(a.__control.gmRequests[0].headers['x-apisports-key'], 'rugby-key');
});

test('_findApiSports uses AFL host and caches date boards', async () => {
  let requestCount = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: () => {
      requestCount += 1;
      return {
        type: 'load',
        response: {
          status: 200,
          responseText: JSON.stringify(makeApiSportsBody('Collingwood', 'Carlton', {
            leagueName: 'AFL',
            homeScore: 81,
            awayScore: 72
          })),
          responseHeaders: ''
        }
      };
    }
  });
  a.__resetCaches();
  a.setApiSportsKey('afl-key');
  a.uiSettings.apiSportsRefreshMode = 'auto';

  const match = {
    sport: 'Australian Football',
    sportKey: 'australian-football',
    team1: 'Collingwood',
    team2: 'Carlton',
    sourceKey: 'espn',
    startTimestamp: String(Date.UTC(2026, 5, 21, 6, 0, 0)),
    status: 'notstarted'
  };

  const first = await a._findApiSports(match);
  const second = await a._findApiSports(match);

  assert.equal(first.found, true);
  assert.equal(second.found, true);
  assert.equal(requestCount, 1, 'second AFL lookup should use the cached date board');
  assert.equal(a.__control.gmRequests[0].url, 'https://v1.afl.api-sports.io/games?date=2026-06-21');
});

test('API-Sports no-key behavior skips provider and fires no request', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({ type: 'load', response: { status: 200, responseText: '{}', responseHeaders: '' } })
  });
  a.__resetCaches();
  a.removeApiSportsKey();

  const priority = a.getProviderPriority({ sport: 'Rugby', sportKey: 'rugby', sourceKey: 'apisports' });
  assert.ok(!priority.includes('apisports'));

  const result = await a._findApiSports({ sportKey: 'rugby' });
  assert.equal(result.found, false);
  assert.match(result.detail, /key not configured/);
  assert.equal(a.__control.gmRequests.length, 0);
});

// ---------------------------------------------------------------------------
// Fix 2 — per-provider manual-only refresh gate
// ---------------------------------------------------------------------------

function makeApiSportsRugbyMatch() {
  return {
    sport: 'Rugby',
    sportKey: 'rugby',
    team1: 'Leinster',
    team2: 'Munster',
    sourceKey: 'apisports',
    startTimestamp: String(Date.UTC(2026, 5, 21, 6, 0, 0)),
    status: 'notstarted'
  };
}

test('manual mode: api-sports skips the network during a non-manual refresh when no board is cached', async () => {
  let requestCount = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: () => {
      requestCount += 1;
      return { type: 'load', response: { status: 200, responseText: '{}', responseHeaders: '' } };
    }
  });
  a.__resetCaches();
  a.setApiSportsKey('manual-key');
  a.uiSettings.apiSportsRefreshMode = 'manual';

  // No refresh context defaults to auto/interval behavior: cache-only, no fetch.
  const result = await a._findApiSports(makeApiSportsRugbyMatch());

  assert.equal(result.found, false, 'manual mode with no cached board yields no match');
  assert.equal(requestCount, 0, 'manual mode must fire zero requests when nothing is cached');
});

test('manual mode: api-sports serves a cached board with zero new requests', async () => {
  let requestCount = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: () => {
      requestCount += 1;
      return {
        type: 'load',
        response: {
          status: 200,
          responseText: JSON.stringify(makeApiSportsBody('Leinster', 'Munster', {
            leagueName: 'United Rugby Championship',
            homeScore: 24,
            awayScore: 21
          })),
          responseHeaders: ''
        }
      };
    }
  });
  a.__resetCaches();
  a.setApiSportsKey('manual-key');

  const match = makeApiSportsRugbyMatch();

  // Warm the date board in auto mode (one network request).
  a.uiSettings.apiSportsRefreshMode = 'auto';
  const warm = await a._findApiSports(match);
  assert.equal(warm.found, true, 'auto mode resolves and caches the board');
  assert.equal(requestCount, 1, 'auto warm fires exactly one request');

  // Switch to manual: a non-manual (auto/interval) refresh must reuse the cached
  // board at 0 token cost rather than refetching.
  a.uiSettings.apiSportsRefreshMode = 'manual';
  const cached = await a._findApiSports(match);
  assert.equal(cached.found, true, 'cached board still resolves the match in manual mode');
  assert.equal(cached.team1Score, 24);
  assert.equal(cached.team2Score, 21);
  assert.equal(requestCount, 1, 'manual mode must not fire a new request when a board is cached');
});

test('manual mode: api-sports manual context fetches even when an auto lookup overlaps', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => undefined
  });
  a.__resetCaches();
  a.setApiSportsKey('manual-key');
  a.uiSettings.apiSportsRefreshMode = 'manual';

  const match = makeApiSportsRugbyMatch();
  const manualPromise = a._findApiSports(match, { manualRefresh: true });
  assert.equal(a.__control.gmRequests.length, 1, 'manual context should start one request');

  const autoResult = await a._findApiSports(match, { manualRefresh: false });
  assert.equal(autoResult.found, false, 'overlapping auto context should remain cache-only');
  assert.equal(a.__control.gmRequests.length, 1, 'overlapping auto context must not join or start a request');

  a.__control.gmRequests[0].onload({
    status: 200,
    responseText: JSON.stringify(makeApiSportsBody('Leinster', 'Munster', {
      leagueName: 'United Rugby Championship',
      homeScore: 31,
      awayScore: 28
    })),
    responseHeaders: ''
  });

  const manualResult = await manualPromise;
  assert.equal(manualResult.found, true, 'manual context should complete from its own request');
  assert.equal(manualResult.team1Score, 31);
  assert.equal(manualResult.team2Score, 28);
});

test('manual mode: api-sports auto context does not inherit a later manual refresh', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: {
        status: 200,
        responseText: JSON.stringify(makeApiSportsBody('Leinster', 'Munster')),
        responseHeaders: ''
      }
    })
  });
  a.__resetCaches();
  a.setApiSportsKey('manual-key');
  a.uiSettings.apiSportsRefreshMode = 'manual';

  const match = makeApiSportsRugbyMatch();
  const autoResult = await a._findApiSports(match, { manualRefresh: false });
  assert.equal(autoResult.found, false, 'auto context should not spend quota before manual refresh');
  assert.equal(a.__control.gmRequests.length, 0, 'auto context must not request in manual-only mode');

  const manualResult = await a._findApiSports(match, { manualRefresh: true });
  assert.equal(manualResult.found, true, 'later manual context should be allowed to fetch');
  assert.equal(a.__control.gmRequests.length, 1, 'only the manual context should spend quota');
});

test('auto mode: api-sports refetches as before (no manual gate)', async () => {
  let requestCount = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: () => {
      requestCount += 1;
      return {
        type: 'load',
        response: {
          status: 200,
          responseText: JSON.stringify(makeApiSportsBody('Leinster', 'Munster', {
            leagueName: 'United Rugby Championship',
            homeScore: 24,
            awayScore: 21
          })),
          responseHeaders: ''
        }
      };
    }
  });
  a.__resetCaches();
  a.setApiSportsKey('auto-key');
  a.uiSettings.apiSportsRefreshMode = 'auto';

  const result = await a._findApiSports(makeApiSportsRugbyMatch());
  assert.equal(result.found, true);
  assert.equal(requestCount, 1, 'auto mode fetches without the manual gate');
});
