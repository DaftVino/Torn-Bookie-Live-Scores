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

test('@match is tightly scoped to the Torn bookie page (no broad host access)', () => {
  const matches = metaValues('match');
  assert.equal(matches.length, 1);
  assert.equal(matches[0], 'https://www.torn.com/page.php?sid=bookie*');
  assert.ok(!metaBlock.includes('<all_urls>'));
  assert.ok(!/@include/.test(metaBlock));
});

test('grants are limited to what the script uses', () => {
  const grants = metaValues('grant');
  const expected = ['GM_xmlhttpRequest', 'GM_setClipboard', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'unsafeWindow'];
  assert.deepEqual([...grants].sort(), [...expected].sort());
});

test('@connect lists exactly the expected external hosts (no wildcards)', () => {
  const connects = metaValues('connect');
  const expected = [
    'site.api.espn.com', 'api.sofascore.com', 'prod-public-api.livescore.com',
    'api.thescore.com', 'www.bbc.com', 'api-web.nhle.com', 'api.nhle.com',
    'api.the-odds-api.com', 'api.pandascore.co'
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
    'api.sofascore.com',          // sofascore api
    'prod-public-api.livescore.com',
    'api.thescore.com',
    'www.bbc.com',
    'api-web.nhle.com',
    'api.nhle.com',
    'api.the-odds-api.com',
    'api.pandascore.co'
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

// ---- Documented defect (Low): version constant out of sync with @version ----
test('DEFECT: SCRIPT_VERSION constant disagrees with @version header', () => {
  const headerVersion = metaValues('version')[0];
  const constMatch = SRC.match(/const SCRIPT_VERSION\s*=\s*'([^']+)'/);
  assert.ok(constMatch);
  assert.equal(headerVersion, '2.5.3');
  assert.equal(constMatch[1], '2.1.0');
  assert.notEqual(headerVersion, constMatch[1]); // debug reports show the wrong version
});

// ---- Documented defect (Low): malformed @homepage URL ----
test('DEFECT: @homepage has a "hhttps" typo (invalid URL)', () => {
  const homepage = metaValues('homepage')[0];
  assert.ok(homepage.startsWith('hhttps://'), homepage); // should be https://
});
