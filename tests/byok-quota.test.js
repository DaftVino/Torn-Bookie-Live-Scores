const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

function loadResp(status, body, responseHeaders = '') {
  return {
    type: 'load',
    response: {
      status,
      responseText: typeof body === 'string' ? body : JSON.stringify(body),
      responseHeaders
    }
  };
}

test('BYOK quota display shows Not pulled yet before provider usage', () => {
  const a = loadUserscript();
  assert.match(a.renderByokQuotaBlock('theoddsapi', 'Not pulled yet'), /Not pulled yet/);
});

test('BYOK quota display uses provider headers and local 24-hour usage', () => {
  const a = loadUserscript();
  a.__control.setNow(Date.UTC(2026, 5, 24, 12, 0, 0));
  a.recordByokUsage({
    providerKey: 'theoddsapi',
    familyKey: 'basketball_nba',
    label: 'The Odds API',
    requestCost: 3,
    outcome: 'ok'
  });
  a.updateByokQuotaState({
    providerKey: 'theoddsapi',
    familyKey: 'basketball_nba',
    label: 'The Odds API',
    headers: {
      'x-requests-remaining': '47',
      'x-requests-used': '53',
      'x-requests-last': '3'
    },
    status: 200
  });

  const row = a.getByokQuotaDisplayRows('theoddsapi')[0];
  const text = a.formatByokQuotaRow(row);
  assert.match(text, /Remaining: 47/);
  assert.match(text, /Used: 53/);
  assert.match(text, /Last cost: 3/);
  assert.match(text, /Local 24h: 3 credits/);
});

test('BYOK quota display falls back to local usage when headers are missing', () => {
  const a = loadUserscript();
  a.recordByokUsage({
    providerKey: 'pandascore',
    familyKey: 'lol',
    label: 'PandaScore lol',
    requestCost: 1,
    outcome: 'ok'
  });
  a.updateByokQuotaState({
    providerKey: 'pandascore',
    familyKey: 'lol',
    label: 'PandaScore lol',
    headers: {},
    status: 200
  });

  const text = a.formatByokQuotaRow(a.getByokQuotaDisplayRows('pandascore')[0]);
  assert.match(text, /Provider quota not reported/);
  assert.match(text, /Local 24h: 1 request/);
});

test('BYOK local usage ignores entries older than 24 hours', () => {
  const a = loadUserscript();
  const now = Date.UTC(2026, 5, 24, 12, 0, 0);
  a.__control.setNow(now - (25 * a.HOUR_MS));
  a.recordByokUsage({ providerKey: 'apisports', familyKey: 'API-Sports Rugby', label: 'API-Sports Rugby', outcome: 'ok' });
  a.__control.setNow(now);
  a.recordByokUsage({ providerKey: 'apisports', familyKey: 'API-Sports Rugby', label: 'API-Sports Rugby', outcome: 'ok' });

  const summary = a.getByokUsageSummary('apisports', now);
  assert.equal(summary['apisports:api-sports rugby'].requests, 1);
});

test('API-Football _findApiFootball records one local request for cached date board', async () => {
  let requestCount = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: () => {
      requestCount++;
      return loadResp(200, { errors: [], results: 0, response: [] }, 'x-ratelimit-requests-remaining: 98\r\nx-ratelimit-remaining: 8\r\n');
    }
  });
  a.setApiSportsKey('cache-key');
  a.uiSettings.apiSportsRefreshMode = 'auto';
  const match = {
    sport: 'Football',
    sportKey: 'football',
    team1: 'Dodoma Jiji FC',
    team2: 'JKT Tanzania',
    startTimestamp: String(Date.UTC(2026, 5, 24, 12, 0, 0)),
    status: 'inprogress',
    sourceKey: 'torn'
  };

  await a._findApiFootball(match);
  await a._findApiFootball(match);

  const summary = a.getByokUsageSummary(['apifootball']);
  assert.equal(requestCount, 3, 'live lookup checks previous/current/next date once');
  assert.equal(Object.values(summary).reduce((sum, row) => sum + row.requests, 0), 3);
});

test('BYOK explicit quota exhaustion displays Out of Tokens and skips automatic retry', async () => {
  let requestCount = 0;
  const a = loadUserscript({
    gmXmlhttpRequest: () => {
      requestCount++;
      return loadResp(429, { message: 'rate limit quota exhausted' }, 'x-ratelimit-requests-remaining: 0\r\n');
    }
  });
  a.setApiSportsKey('quota-key');
  a.uiSettings.apiSportsRefreshMode = 'auto';
  const match = {
    sport: 'Football',
    sportKey: 'football',
    team1: 'A',
    team2: 'B',
    startTimestamp: String(Date.UTC(2026, 5, 24, 12, 0, 0)),
    status: 'inprogress',
    sourceKey: 'torn'
  };

  await a._findApiFootball(match);
  assert.equal(a.isByokQuotaExhausted('apifootball', 'Football'), true);
  assert.match(a.formatByokQuotaRow(a.getByokQuotaDisplayRows('apifootball')[0]), /Out of Tokens/);

  await a._findApiFootball(match);
  assert.equal(requestCount, 1, 'automatic retry is skipped after exhaustion');
});

test('BYOK successful manual probe clears an exhausted family', () => {
  const a = loadUserscript();
  a.updateByokQuotaState({
    providerKey: 'apifootball',
    familyKey: 'Football',
    label: 'Football',
    headers: { 'x-ratelimit-requests-remaining': '0' },
    status: 429,
    errorText: 'quota exhausted',
    outcome: 'error'
  });
  assert.equal(a.isByokQuotaExhausted('apifootball', 'Football'), true);

  a.updateByokQuotaState({
    providerKey: 'apifootball',
    familyKey: 'Football',
    label: 'Football',
    headers: { 'x-ratelimit-requests-remaining': '99' },
    status: 200,
    outcome: 'ok'
  });
  assert.equal(a.isByokQuotaExhausted('apifootball', 'Football'), false);
});
