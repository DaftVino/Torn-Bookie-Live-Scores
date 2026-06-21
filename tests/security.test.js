'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

const a = loadUserscript();

test('escapeHtml neutralises all HTML metacharacters', () => {
  assert.equal(a.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(a.escapeHtml(`a'"&<>`), 'a&#039;&quot;&amp;&lt;&gt;');
  assert.equal(a.escapeHtml(null), '');
  // ampersand escaped first so existing entities are not double-mangled into XSS
  assert.equal(a.escapeHtml('&lt;'), '&amp;lt;');
});

test('deepMergeSettings does not pollute Object.prototype via __proto__', () => {
  const before = Object.prototype.polluted;
  const malicious = JSON.parse('{"__proto__":{"polluted":"yes"},"theme":"dark"}');
  const merged = a.deepMergeSettings(a.DEFAULT_UI_SETTINGS, malicious);
  assert.equal(Object.prototype.polluted, before); // still undefined
  assert.equal(({}).polluted, undefined);
  assert.equal(merged.theme, 'dark'); // legit override still applied
});

test('deepMergeSettings keeps nested enabled maps merged, not replaced', () => {
  const merged = a.deepMergeSettings(a.DEFAULT_UI_SETTINGS, { enabledProviders: { thescore: true } });
  assert.equal(merged.enabledProviders.thescore, true);
  assert.equal(merged.enabledProviders.espn, true); // default preserved
  assert.equal(merged.enabledSports.baseball, true); // untouched map preserved
});

test('isSensitiveDebugKey flags account/secret-bearing keys', () => {
  for (const k of ['amount', 'bet', 'bets', 'tornId', 'authorization', 'apikey', 'token', 'cookie']) {
    assert.equal(a.isSensitiveDebugKey(k), true, k);
  }
  for (const k of ['name', 'sport', 'team1', 'status']) {
    assert.equal(a.isSensitiveDebugKey(k), false, k);
  }
});

test('sanitizeDebugText redacts api keys, tokens and bearer auth', () => {
  const out = a.sanitizeDebugText('url?apiKey=SECRETKEY123 token=abc12345 Authorization: Bearer zzzzzzzz9999');
  assert.ok(!out.includes('SECRETKEY123'));
  assert.ok(!out.includes('abc12345'));
  assert.ok(!out.includes('zzzzzzzz9999'));
  assert.match(out, /\[redacted\]/);
});

test('sanitizeDebugText redacts known stored secrets verbatim', () => {
  a.__control.gmStore.set('tmBookieOddsApiKey', 'ODDS-KEY-ABCDEFG');
  a.__control.gmStore.set('tmBookiePandaScoreToken', 'PANDA-TOKEN-1234');
  const out = a.sanitizeDebugText('odds=ODDS-KEY-ABCDEFG panda=PANDA-TOKEN-1234');
  assert.ok(!out.includes('ODDS-KEY-ABCDEFG'));
  assert.ok(!out.includes('PANDA-TOKEN-1234'));
  assert.match(out, /redacted-secret/);
});

test('sanitizeDebugText scrubs Windows user paths', () => {
  const input = String.raw`error at C:\Users\jm3aker\AppData\file.js`;
  const out = a.sanitizeDebugText(input);
  assert.ok(!out.includes('jm3aker'), out);
  assert.match(out, /C:\\Users\\\[user\]/);
});

test('sanitizeDebugValue redacts sensitive keys at any depth and truncates', () => {
  const obj = { name: 'ok', amount: 5000, bets: [{ x: 1 }], nested: { token: 'abc123def', deep: { apikey: 'zzz' } } };
  const out = JSON.parse(JSON.stringify(a.sanitizeDebugValue(obj)));
  assert.equal(out.name, 'ok');
  assert.equal(out.amount, '[redacted]');
  assert.equal(out.bets, '[redacted]');
  assert.equal(out.nested.token, '[redacted]');
  assert.equal(out.nested.deep.apikey, '[redacted]');
});

test('sanitizeDebugValue caps recursion depth', () => {
  let deep = { token: 'safe-because-key' };
  let node = { a: { b: { c: { d: { e: 'too-deep' } } } } };
  const out = JSON.parse(JSON.stringify(a.sanitizeDebugValue(node)));
  // at depth 4 the value is replaced with a truncation marker
  assert.equal(out.a.b.c.d, '[truncated-depth]');
});

test('safeExternalSourceUrl allows only https on known hosts', () => {
  assert.equal(a.safeExternalSourceUrl('https://www.espn.com/x'), 'https://www.espn.com/x');
  assert.equal(a.safeExternalSourceUrl('https://www.bbc.com/sport'), 'https://www.bbc.com/sport');
  assert.equal(a.safeExternalSourceUrl('http://www.espn.com/x'), '');   // not https
  assert.equal(a.safeExternalSourceUrl('https://evil.example/x'), '');  // unknown host
  assert.equal(a.safeExternalSourceUrl('javascript:alert(1)'), '');     // dangerous scheme
  assert.equal(a.safeExternalSourceUrl('not a url'), '');
});

test('firstSafeSourceUrl returns the first allowed candidate', () => {
  assert.equal(
    a.firstSafeSourceUrl(['garbage', 'http://insecure', 'https://www.sofascore.com/x']),
    'https://www.sofascore.com/x'
  );
  assert.equal(a.firstSafeSourceUrl([]), '');
});

test('buildEspnSourceUrl only emits whitelisted https deep links', () => {
  const url = a.buildEspnSourceUrl({ providerEventId: '401' }, 'baseball_mlb');
  assert.match(url, /^https:\/\/www\.espn\.com\/mlb\/game\/_\/gameId\/401$/);
  // soccer uses /match/ segment
  const soccer = a.buildEspnSourceUrl({ providerEventId: '99' }, 'soccer_world');
  assert.match(soccer, /^https:\/\/www\.espn\.com\/soccer\/match\/_\/gameId\/99$/);
});
