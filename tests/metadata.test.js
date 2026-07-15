'use strict';

// Validates the userscript metadata block and cross-checks @connect scope against
// the hosts the code actually contacts. Reads the production file as text only;
// it never executes or modifies it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'Torn_Bookie_Live_Scores.js'), 'utf8');
const metaBlock = SRC.slice(SRC.indexOf('==UserScript=='), SRC.indexOf('==/UserScript=='));

function metaValues(key) {
  const re = new RegExp(`^//\\s*@${key}\\s+(.+)$`, 'gm');
  const out = [];
  let m;
  while ((m = re.exec(metaBlock)) !== null) out.push(m[1].trim());
  return out;
}

test('required metadata directives are present', () => {
  assert.equal(metaValues('name')[0], 'Torn Bookie Live Scores');
  assert.equal(metaValues('version').length, 1);
  assert.ok(metaValues('license')[0].includes('MIT'));
  assert.equal(metaValues('run-at')[0], 'document-start'); // needed to intercept early
});

test('@description fits the store listing and does not disclaim PDA support', () => {
  const description = metaValues('description')[0];
  // Greasyfork renders the whole description; keep it scannable.
  assert.ok(description.length <= 500, `@description is ${description.length} chars, max 500`);
  // The script is runtime-scoped for PDA as of 3.1.0; the old disclaimer must not survive.
  assert.ok(!/NOT COMPATIBLE WITH TORN PDA/i.test(description));
  // The debug-report ask is the only inbound support funnel; do not let it get trimmed away.
  assert.ok(/debug mode/i.test(description));
});

test('CHANGELOG documents the current @version', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const headerVersion = metaValues('version')[0];
  const topHeading = changelog.match(/^## Torn Bookie Live Scores v(\S+) - (\S+)$/m);
  assert.ok(topHeading, 'CHANGELOG needs a "## Torn Bookie Live Scores vX.Y.Z - YYYY-MM-DD" heading');
  assert.equal(topHeading[1], headerVersion, '@version and the newest CHANGELOG entry must agree');
  assert.match(topHeading[2], /^\d{4}-\d{2}-\d{2}$/, 'CHANGELOG date must be YYYY-MM-DD, not a placeholder');
});

test('README documents the Torn PDA install steps', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.match(readme, /Installing on Torn PDA/i);
  // Injection time = Start is required: the script intercepts network calls at
  // document-start. On "End" it loads too late and the panel sits empty.
  assert.match(readme, /Injection time/i);
  assert.match(readme, /\bStart\b/);
  assert.match(readme, /custom user scripts/i);
});

test('no shipped file claims Torn PDA is unsupported', () => {
  for (const file of ['CHANGELOG.md', 'README.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(!/Torn PDA is not supported/i.test(text), `${file} still claims PDA is unsupported`);
  }
});

test('@match is tightly scoped to Torn bookie plus SofaScore token refresh (no broad host access)', () => {
  const matches = metaValues('match');
  assert.deepEqual([...matches].sort(), [
    'https://www.sofascore.com/*',
    'https://www.torn.com/page.php?sid=bookie*'
  ].sort());
  assert.ok(!metaBlock.includes('<all_urls>'));
  assert.ok(!/@include/.test(metaBlock));
});

test('grants are limited to what the script uses', () => {
  const grants = metaValues('grant');
  const expected = ['GM_xmlhttpRequest', 'GM_setClipboard', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_openInTab', 'unsafeWindow'];
  assert.deepEqual([...grants].sort(), [...expected].sort());
});

test('@connect lists exactly the expected external hosts (no wildcards)', () => {
  const connects = metaValues('connect');
  const expected = [
    'site.api.espn.com', 'api.sofascore.com', 'www.sofascore.com', 'prod-public-api.livescore.com',
    'api.thescore.com', 'www.bbc.com', 'api-web.nhle.com', 'api.nhle.com',
    'api.the-odds-api.com', 'api.pandascore.co', 'v3.football.api-sports.io',
    'v1.rugby.api-sports.io', 'v1.afl.api-sports.io', 'hs-consumer-api.espncricinfo.com'
  ];
  assert.deepEqual([...connects].sort(), [...expected].sort());
  // no wildcard / overly-broad connect
  assert.ok(!connects.some(c => c.includes('*')));
});

test('every API host the code fetches from is covered by @connect', () => {
  const connects = new Set(metaValues('connect'));
  // Hosts that appear in fetch endpoint constants / request builders in the body.
  const fetchedHosts = [
    'site.api.espn.com',          // ESPN_ENDPOINTS
    'www.sofascore.com',          // sofascore api
    'prod-public-api.livescore.com',
    'api.thescore.com',
    'www.bbc.com',
    'api-web.nhle.com',
    'api.nhle.com',
    'api.the-odds-api.com',
    'api.pandascore.co',
    'v3.football.api-sports.io',  // API-Football BYOK soccer provider
    'v1.rugby.api-sports.io',     // API-Sports Rugby BYOK provider
    'v1.afl.api-sports.io',       // API-Sports AFL BYOK provider
    'hs-consumer-api.espncricinfo.com' // ESPNcricinfo cricket provider
  ];
  for (const host of fetchedHosts) {
    assert.ok(connects.has(host), `missing @connect for fetched host ${host}`);
    assert.ok(SRC.includes(host), `host ${host} declared in @connect but not referenced in code`);
  }
});

test('interception is restricted to the Torn bookie API marker only', () => {
  // The fetch/XHR hooks must gate on sid=bookieApi so unrelated traffic is ignored.
  assert.ok(SRC.includes("includes('sid=bookieApi')"));
});

// ---- Metadata sync: SCRIPT_VERSION fallback and GM_info override ----
test('SCRIPT_VERSION defaults to @version when GM_info is absent', () => {
  const { loadUserscript } = require('./load-userscript.js');
  const api = loadUserscript();
  const headerVersion = metaValues('version')[0];
  // Assert the invariant, not a literal. This previously pinned '2.5.8' and silently
  // rotted as the header moved on; the point of the test is that the two agree.
  assert.match(headerVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(api.SCRIPT_VERSION, headerVersion);
});

test('SCRIPT_VERSION is overridden by injected GM_info.script.version', () => {
  const { loadUserscript } = require('./load-userscript.js');
  const injectedVersion = '2.5.8';
  const api = loadUserscript({
    gmInfo: {
      script: {
        version: injectedVersion
      }
    }
  });
  assert.equal(api.SCRIPT_VERSION, injectedVersion);
});

// ---- Metadata validation: @homepage URL is correct ----
test('@homepage is a valid https URL (no hhttps typo)', () => {
  const homepage = metaValues('homepage')[0];
  assert.ok(homepage.startsWith('https://'), `homepage should start with https://, got: ${homepage}`);
  assert.ok(!homepage.startsWith('hhttps://'), 'homepage contains typo hhttps://');
  assert.equal(homepage, 'https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores');
});
