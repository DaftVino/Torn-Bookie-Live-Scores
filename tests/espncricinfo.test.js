'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

function makeCricketMatch(overrides = {}) {
  return {
    sport: 'Cricket',
    sportKey: 'cricket',
    team1: 'India',
    team2: 'England',
    competition: 'Test Championship',
    sourceKey: 'espncricinfo',
    startTimestamp: String(Date.UTC(2026, 5, 22, 10, 0, 0)),
    status: 'notstarted',
    ...overrides
  };
}

function makeCricinfoBody(overrides = {}) {
  return {
    content: {
      matches: [{
        objectId: 1001,
        slug: 'india-vs-england-1st-test',
        title: 'India vs England, 1st Test',
        status: 'RESULT',
        statusText: 'India won by 8 wickets',
        startDate: '2026-06-22T10:00:00.000Z',
        series: { objectId: 999, longName: 'Test Championship' },
        ground: { name: 'Lord\'s' },
        teams: [
          {
            team: { name: 'India', longName: 'India', abbreviation: 'IND' },
            score: '358 & 76/2'
          },
          {
            team: { name: 'England', longName: 'England', abbreviation: 'ENG' },
            score: '162/2'
          }
        ]
      }],
      ...overrides
    }
  };
}

test('Phase F routing makes cricket ESPNcricinfo-primary and excludes SofaScore cricket', () => {
  const a = loadUserscript();

  assert.equal(a.chooseScoreSource({ sport: 'Cricket', sportKey: 'cricket' }), 'espncricinfo');
  assert.equal(a.isProviderSupportedForSport('espncricinfo', { sport: 'Cricket', sportKey: 'cricket' }), true);
  assert.equal(a.SOFASCORE_SPORT_SLUGS.cricket, undefined);

  const priority = a.getProviderPriority(makeCricketMatch());
  assert.equal(priority[0], 'espncricinfo');
  assert.ok(!priority.includes('sofascore'));
});

test('_findEspnCricinfo requests scheduled/result DD-MM-YYYY date boards', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: req => {
      const body = req.url.includes('/matches/result?') ? makeCricinfoBody() : { content: { matches: [] } };
      return { type: 'load', response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' } };
    }
  });
  a.__resetCaches();

  const result = await a._findEspnCricinfo(makeCricketMatch());
  const urls = a.__control.gmRequests.map(req => req.url);

  assert.equal(result.found, true, `expected cricket match; detail: ${result.detail}`);
  assert.ok(urls.includes('https://hs-consumer-api.espncricinfo.com/v1/pages/matches/scheduled?lang=en&filterType=DATE&filterValue=22-06-2026'));
  assert.ok(urls.includes('https://hs-consumer-api.espncricinfo.com/v1/pages/matches/result?lang=en&filterType=DATE&filterValue=22-06-2026'));
});

test('_findEspnCricinfo maps team long names, status, id, venue, and multi-innings scores', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: req => {
      const body = req.url.includes('/matches/result?') ? makeCricinfoBody() : { content: { matches: [] } };
      return { type: 'load', response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' } };
    }
  });
  a.__resetCaches();

  const result = await a._findEspnCricinfo(makeCricketMatch());

  assert.equal(result.found, true, `expected cricket match; detail: ${result.detail}`);
  assert.equal(result.sourceKey, 'espncricinfo');
  assert.equal(result.sourceLabel, 'ESPNcricinfo');
  assert.equal(result.providerEventId, 1001);
  assert.equal(result.team1Score, '358 & 76/2');
  assert.equal(result.team2Score, '162/2');
  assert.equal(result.detail, 'India won by 8 wickets');
  assert.equal(result.venue, 'Lord\'s');
  assert.equal(result.providerStartMs, Date.UTC(2026, 5, 22, 10, 0, 0));
});

test('_findEspnCricinfo live cricket queries live/current endpoints before date boards', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: req => {
      const body = req.url.includes('/matches/current?') ? makeCricinfoBody({
        matches: [{
          objectId: 2002,
          statusText: 'Day 2 - England trail by 84 runs',
          startDate: '2026-06-21T10:00:00.000Z',
          series: { longName: 'Test Championship' },
          teams: [
            { team: { longName: 'India', abbreviation: 'IND' }, score: '358' },
            { team: { longName: 'England', abbreviation: 'ENG' }, score: '162/2' }
          ]
        }]
      }) : { content: { matches: [] } };
      return { type: 'load', response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' } };
    }
  });
  a.__resetCaches();
  a.__control.setNow(Date.UTC(2026, 5, 22, 12, 0, 0));

  const result = await a._findEspnCricinfo(makeCricketMatch({
    status: 'inprogress',
    startTimestamp: String(Date.UTC(2026, 5, 21, 10, 0, 0))
  }));
  const urls = a.__control.gmRequests.map(req => req.url);

  assert.equal(result.found, true, `expected live cricket match; detail: ${result.detail}`);
  assert.equal(urls[0], 'https://hs-consumer-api.espncricinfo.com/v1/pages/matches/live?lang=en');
  assert.equal(urls[1], 'https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en&latest=true');
});

test('_findEspnCricinfo caches date boards for repeated cricket lookups', async () => {
  let requestCount = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: req => {
      requestCount += 1;
      const body = req.url.includes('/matches/result?') ? makeCricinfoBody() : { content: { matches: [] } };
      return { type: 'load', response: { status: 200, responseText: JSON.stringify(body), responseHeaders: '' } };
    }
  });
  a.__resetCaches();

  await a._findEspnCricinfo(makeCricketMatch());
  await a._findEspnCricinfo(makeCricketMatch());

  assert.equal(requestCount, 2, 'scheduled and result date boards should be fetched once each');
});

test('_findEspnCricinfo handles empty boards without throwing', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: JSON.stringify({ content: { matches: [] } }), responseHeaders: '' }
    })
  });
  a.__resetCaches();

  const result = await a._findEspnCricinfo(makeCricketMatch());

  assert.equal(result.found, false);
  assert.match(result.detail, /ESPNcricinfo/);
});
