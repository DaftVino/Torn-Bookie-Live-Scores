'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

function footballMatch(overrides = {}) {
  return {
    sport: 'Football',
    sportKey: 'football',
    team1: 'New Zealand',
    team2: 'Egypt',
    competition: 'FIFA World Cup',
    startTimestamp: String(Date.UTC(2026, 5, 22, 2, 0, 0)),
    sectionType: 'upcoming',
    ...overrides
  };
}

test('_findBbc parses current static BBC fixture text shape', async () => {
  const html = `
    <main role="main">
      <h2>FIFA World Cup</h2>
      <h3>Group G</h3>
      <ul>
        <li>
          <a href="https://www.bbc.com/sport/football/live/cjrg7wz1er7t">
            New Zealand versus Egypt kick off 02:00 New Zealand 02:00 plays Egypt
          </a>
        </li>
      </ul>
    </main>
  `;
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: html, responseHeaders: '' }
    })
  });

  a.__resetCaches();
  const result = await a._findBbc(footballMatch());

  assert.equal(result.found, true);
  assert.equal(result.sourceKey, 'bbcsport');
  assert.equal(result.providerEventId, 'cjrg7wz1er7t');
  assert.equal(result.rawEvent.homeTeam.name, 'New Zealand');
  assert.equal(result.rawEvent.awayTeam.name, 'Egypt');
  assert.equal(result.rawEvent.status.description, 'scheduled');
});

test('_findBbc parses the current BBC DOM-attribute fixture shape', async () => {
  // No __NEXT_DATA__; fixtures live in <li data-tipo-topic-id> rows with team names in
  // [class*="TeamNameWrapper"], the BBC event id on a[data-tipo-id]/href, and <time>.
  const html = `
    <main role="main">
      <h2><a href="/sport/football/scores-fixtures">FIFA World Cup</a></h2>
      <h3>Group G</h3>
      <ul class="ssrcss-1w89ukb-StackLayout">
        <li data-tipo-topic-id="cjrg7wz1er7t">
          <a href="/sport/football/live/cjrg7wz1er7t" data-tipo-id="cjrg7wz1er7t">
            <div data-event-id="s-ds4dbpzuq9s8a87zc84b58w7o">
              <div data-participant-id="bhu61cgwm07e2pik1jqmnztgl">
                <span class="ssrcss-1-TeamNameWrapper"><span>New Zealand</span><span class="visually-hidden">New Zealand</span></span>
              </div>
              <time datetime="2026-06-22T02:00:00Z">02:00</time>
              <div data-participant-id="abc123def456">
                <span class="ssrcss-2-TeamNameWrapper"><span>Egypt</span></span>
              </div>
            </div>
            <span class="visually-hidden">New Zealand versus Egypt kick off 02:00</span>
          </a>
        </li>
      </ul>
    </main>
  `;
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: html, responseHeaders: '' }
    })
  });

  a.__resetCaches();
  const result = await a._findBbc(footballMatch());

  assert.equal(result.found, true);
  assert.equal(result.sourceKey, 'bbcsport');
  assert.equal(result.providerEventId, 'cjrg7wz1er7t');
  assert.equal(result.rawEvent.homeTeam.name, 'New Zealand');
  assert.equal(result.rawEvent.awayTeam.name, 'Egypt');
  assert.equal(result.rawEvent.startTime, '2026-06-22T02:00:00Z');
});

test('_findBbc records parser failure for garbage HTML without throwing', async () => {
  const a = loadUserscript({
    gmXmlhttpRequest: () => ({
      type: 'load',
      response: { status: 200, responseText: '<html><body>not fixture data</body></html>', responseHeaders: '' }
    })
  });

  a.__resetCaches();
  const result = await a._findBbc(footballMatch());

  assert.equal(result.found, false);
  assert.equal(result.unmatched, true);
  assert.match(result.detail, /BBC Sport: parser failed for 2026-06-22/);
});
