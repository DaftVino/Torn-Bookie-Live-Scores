'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

function makeMatch(overrides = {}) {
  return {
    sport: 'Football',
    sportKey: 'football',
    competition: 'Norwegian Eliteserien',
    team1: 'Alpha FC',
    team2: 'Beta United',
    sourceKey: 'espn',
    startTimestamp: String(Date.UTC(2026, 5, 22, 18, 0, 0)),
    status: 'notstarted',
    ...overrides
  };
}

function makeSofascoreBoard(status = { code: 6 }) {
  return {
    events: [{
      id: 123,
      startTimestamp: Math.floor(Date.UTC(2026, 5, 22, 18, 0, 0) / 1000),
      homeTeam: { name: 'Alpha FC', shortName: 'Alpha' },
      awayTeam: { name: 'Beta United', shortName: 'Beta' },
      homeScore: { current: 2 },
      awayScore: { current: 1 },
      status,
      tournament: { name: 'Test League' }
    }]
  };
}

function makeTennisLiveBoard() {
  return {
    events: [{
      id: 16390001,
      startTimestamp: Math.floor(Date.UTC(2026, 5, 25, 11, 35, 0) / 1000),
      homeTeam: { name: 'Sandro Kopp', shortName: 'S. Kopp' },
      awayTeam: { name: 'Dali Blanch', shortName: 'D. Blanch' },
      homeScore: { current: 1, display: 1, period1: 6, period2: 3 },
      awayScore: { current: 0, display: 0, period1: 4, period2: 2 },
      status: { code: 9, description: '2nd set', type: 'inprogress' },
      tournament: {
        name: 'Plovdiv, Bulgaria',
        category: { name: 'Challenger' },
        uniqueTournament: { name: 'ATP Challenger Plovdiv, Bulgaria Men Singles' }
      }
    }]
  };
}

function installSofascoreRefreshCapture(a) {
  const loc = a.__control.window.location;
  loc.origin = 'https://www.sofascore.com';
  loc.hostname = 'www.sofascore.com';
  loc.pathname = '/';
  loc.href = 'https://www.sofascore.com/#tbls-token-refresh';
  loc.hash = '#tbls-token-refresh';
  a.installSofascoreTokenCapture();
}

test('SofaScore fetch uses www host and x-requested-with token header', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: JSON.stringify(makeSofascoreBoard()), responseHeaders: '' }
    })
  });
  a.__resetCaches();
  a.setSofascoreToken('stored-token', Date.UTC(2026, 5, 22, 12, 0, 0));

  await a.resolveSofascoreMatch(makeMatch(), 'football');

  assert.equal(a.__control.gmRequests.length, 1);
  const req = a.__control.gmRequests[0];
  assert.ok(req.url.startsWith('https://www.sofascore.com/api/v1/sport/football/scheduled-events/'));
  assert.equal(req.headers['x-requested-with'], 'stored-token');
  assert.equal(req.headers.Origin, 'https://www.sofascore.com');
  assert.equal(req.headers.Referer, 'https://www.sofascore.com/');
  assert.equal(req.anonymous, undefined);
});

test('SofaScore live tennis uses events/live before the date schedule endpoint', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: (req) => {
      const body = req.url.endsWith('/events/live') ? makeTennisLiveBoard() : { events: [] };
      return {
        type: 'load',
        response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' }
      };
    }
  });
  a.__resetCaches();
  a.setSofascoreToken('stored-token', Date.UTC(2026, 5, 25, 12, 0, 0));

  const result = await a._findSofascore(makeMatch({
    sport: 'Tennis',
    sportKey: 'tennis',
    competition: 'Plovdiv 2026(Challenger)',
    team1: 'Sandro Kopp',
    team2: 'Dali Blanch',
    startTimestamp: String(Date.UTC(2026, 5, 25, 11, 35, 0)),
    sectionType: 'live',
    status: '2nd Set',
    rawStatus: 'inprogress'
  }));

  assert.equal(result.found, true, result.detail);
  assert.equal(a.__control.gmRequests.length, 1);
  assert.ok(a.__control.gmRequests[0].url.endsWith('/api/v1/sport/tennis/events/live'));
  assert.equal(result.team1Score, '6 3');
  assert.equal(result.team2Score, '4 2');
  assert.equal(result.detail, '2nd set');
  assert.equal(result.providerEventId, 16390001);
});

test('SofaScore non-live tennis keeps the date schedule endpoint', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: JSON.stringify({ events: [] }), responseHeaders: '' }
    })
  });
  a.__resetCaches();

  await a.resolveSofascoreMatch(makeMatch({
    sport: 'Tennis',
    sportKey: 'tennis',
    sectionType: 'upcoming',
    status: 'notstarted'
  }), 'tennis');

  assert.equal(a.__control.gmRequests.length, 3);
  assert.ok(a.__control.gmRequests.every(req => req.url.includes('/api/v1/sport/tennis/scheduled-events/')));
  assert.ok(a.__control.gmRequests.every(req => !req.url.endsWith('/events/live')));
});

test('SofaScore live football uses events/live before the date schedule endpoint', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: (req) => {
      const body = req.url.endsWith('/events/live') ? makeSofascoreBoard({ code: 9, description: '1st half', type: 'inprogress' }) : { events: [] };
      return {
        type: 'load',
        response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' }
      };
    }
  });
  a.__resetCaches();
  a.setSofascoreToken('stored-token', Date.UTC(2026, 5, 22, 12, 0, 0));

  const result = await a._findSofascore(makeMatch({
    sectionType: 'live',
    status: '1st half',
    rawStatus: 'inprogress',
    startTimestamp: String(Date.UTC(2026, 5, 22, 18, 0, 0))
  }));

  assert.equal(result.found, true, result.detail);
  assert.equal(a.__control.gmRequests.length, 1);
  assert.ok(a.__control.gmRequests[0].url.endsWith('/api/v1/sport/football/events/live'));
  assert.equal(result.team1Score, 2);
  assert.equal(result.team2Score, 1);
  assert.equal(result.detail, '1st half');
  assert.equal(result.providerEventId, 123);
});

test('SofaScore live football no-match does not fall through to scheduled-events', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: (req) => {
      const body = req.url.endsWith('/events/live')
        ? {
            events: [{
              id: 456,
              startTimestamp: Math.floor(Date.UTC(2026, 5, 22, 18, 0, 0) / 1000),
              homeTeam: { name: 'Wrong Home' },
              awayTeam: { name: 'Wrong Away' },
              homeScore: { current: 0 },
              awayScore: { current: 0 },
              status: { code: 9, description: '1st half', type: 'inprogress' },
              tournament: { name: 'Test League' }
            }]
          }
        : { events: [] };
      return {
        type: 'load',
        response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' }
      };
    }
  });
  a.__resetCaches();

  const result = await a._findSofascore(makeMatch({
    sectionType: 'live',
    status: '1st half',
    rawStatus: 'inprogress',
    startTimestamp: String(Date.UTC(2026, 5, 22, 18, 0, 0))
  }));

  assert.equal(result.found, false);
  assert.equal(a.__control.gmRequests.length, 1);
  assert.ok(a.__control.gmRequests[0].url.endsWith('/api/v1/sport/football/events/live'));
  assert.ok(a.__control.gmRequests.every(req => !req.url.includes('/scheduled-events/')));
});

test('SofaScore non-live football keeps the date schedule endpoint', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: JSON.stringify({ events: [] }), responseHeaders: '' }
    })
  });
  a.__resetCaches();

  await a.resolveSofascoreMatch(makeMatch({
    sectionType: 'upcoming',
    status: 'notstarted'
  }), 'football');

  assert.equal(a.__control.gmRequests.length, 3);
  assert.ok(a.__control.gmRequests.every(req => req.url.includes('/api/v1/sport/football/scheduled-events/')));
  assert.ok(a.__control.gmRequests.every(req => !req.url.endsWith('/events/live')));
});

test('SofaScore token store uses fallback, stored value, and timestamp', () => {
  const a = loadUserscript();
  assert.equal(a.getSofascoreToken(), 'e06c91');

  const ts = Date.UTC(2026, 5, 22, 13, 0, 0);
  assert.equal(a.setSofascoreToken('fresh-token', ts), true);
  assert.equal(a.getSofascoreToken(), 'fresh-token');
  assert.equal(a.getSofascoreTokenTimestamp(), ts);
});

test('SofaScore capture helper stores x-requested-with only for API v1 requests', () => {
  const a = loadUserscript();
  const ts = Date.UTC(2026, 5, 22, 14, 0, 0);

  assert.equal(a.captureSofascoreRequestedWith('https://www.sofascore.com/api/v1/event/1', 'x-requested-with', 'abcd12', ts), true);
  assert.equal(a.getSofascoreToken(), 'abcd12');
  assert.equal(a.getSofascoreTokenTimestamp(), ts);

  assert.equal(a.captureSofascoreRequestedWith('https://www.sofascore.com/api/v2/event/1', 'x-requested-with', 'ignored', ts + 1), false);
  assert.equal(a.getSofascoreToken(), 'abcd12');
});

test('SofaScore refresh fetch does not close only because an old token timestamp exists', async () => {
  const a = loadUserscript();
  installSofascoreRefreshCapture(a);
  a.setSofascoreToken('stale-token', Date.UTC(2026, 5, 22, 12, 0, 0));

  await a.__control.window.fetch('https://www.sofascore.com/api/v1/event/1', { headers: {} });

  assert.notEqual(a.__control.window.__closed, true);
  assert.equal(a.getSofascoreToken(), 'stale-token');
});

test('SofaScore refresh fetch closes after capturing a fresh token in this session', async () => {
  const a = loadUserscript();
  installSofascoreRefreshCapture(a);
  a.setSofascoreToken('stale-token', Date.UTC(2026, 5, 22, 12, 0, 0));

  await a.__control.window.fetch('https://www.sofascore.com/api/v1/event/1', {
    headers: { 'x-requested-with': 'fresh-token' }
  });

  assert.equal(a.getSofascoreToken(), 'fresh-token');
  assert.equal(a.__control.window.__closed, true);
});

test('SofaScore 403 triggers one background token refresh within cooldown', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 403, responseText: '{"error":{"code":403}}', responseHeaders: '' }
    })
  });
  a.__resetCaches();
  a.__control.setNow(Date.UTC(2026, 5, 22, 12, 0, 0));

  const first = await a.resolveSofascoreMatch(makeMatch(), 'football');
  const second = await a.resolveSofascoreMatch(makeMatch(), 'football');

  assert.notEqual(first.found, true);
  assert.notEqual(second.found, true);
  assert.equal(a.__control.gmOpenedTabs.length, 1);
  assert.equal(a.__control.gmOpenedTabs[0].url, 'https://www.sofascore.com/#tbls-token-refresh');
  assert.equal(a.__control.gmOpenedTabs[0].opts.active, false);
});

test('SofaScore 404 reports endpoint failure without token refresh', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 404, responseText: '{"error":{"code":404}}', responseHeaders: '' }
    })
  });
  a.__resetCaches();

  const result = await a.resolveSofascoreMatch(makeMatch({ sport: 'Tennis', sportKey: 'tennis' }), 'tennis');

  assert.equal(result.resolution, null);
  assert.equal(a.__control.gmOpenedTabs.length, 0);
  assert.match(a.summarizeProviderResult('SofaScore', result), /fetch error/);
  assert.match(a.summarizeProviderResult('SofaScore', result), /HTTP 404/);
});

test('SofaScore empty response fails gracefully and queues refresh', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: '', responseHeaders: '' }
    })
  });
  a.__resetCaches();

  const result = await a.resolveSofascoreMatch(makeMatch(), 'football');

  assert.notEqual(result.found, true);
  assert.equal(a.__control.gmOpenedTabs.length, 1);
});

test('getProviderPriority places sofascore after espn and before apifootball for soccer', () => {
  const a = loadUserscript();
  a.setApiSportsKey('api-sports-key');
  a.uiSettings.enabledProviders.apifootball = true;

  const priority = a.getProviderPriority(makeMatch());
  assert.ok(priority.includes('espn'), priority.join(','));
  assert.ok(priority.includes('sofascore'), priority.join(','));
  assert.ok(priority.includes('apifootball'), priority.join(','));
  assert.ok(priority.indexOf('espn') < priority.indexOf('sofascore'));
  assert.ok(priority.indexOf('sofascore') < priority.indexOf('apifootball'));
});

test('SofaScore status codes map to stable detail labels', () => {
  const a = loadUserscript();
  assert.equal(a.sofascoreStatusDetail({ code: 6 }), 'live');
  assert.equal(a.sofascoreStatusDetail({ code: 7 }), 'live');
  assert.equal(a.sofascoreStatusDetail({ code: 100 }), 'finished');
  assert.equal(a.sofascoreStatusDetail({ code: 60 }), 'postponed');
  assert.equal(a.sofascoreStatusDetail({ code: 70 }), 'canceled');
  assert.equal(a.sofascoreStatusDetail({ code: 90 }), 'canceled');
  assert.equal(a.sofascoreStatusDetail({ code: 0 }), 'scheduled');
});

test('_findSofascore uses status code mapping in result detail', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: JSON.stringify(makeSofascoreBoard({ code: 100 })), responseHeaders: '' }
    })
  });
  a.__resetCaches();

  const result = await a._findSofascore(makeMatch());

  assert.equal(result.found, true, result.detail);
  assert.equal(result.team1Score, 2);
  assert.equal(result.team2Score, 1);
  assert.equal(result.detail, 'finished');
});
