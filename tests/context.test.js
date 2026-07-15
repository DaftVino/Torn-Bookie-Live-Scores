'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

const a = loadUserscript();

const TORN = { origin: 'https://www.torn.com', hostname: 'www.torn.com', pathname: '/gym.php', href: 'https://www.torn.com/gym.php', search: '', hash: '' };

test('isBookiePageContext accepts the Bookie page and its hash sub-tabs', () => {
  assert.equal(a.isBookiePageContext('?sid=bookie'), true);
  // PDA and desktop both report the sub-tabs as hash routes under the same search string.
  assert.equal(a.isBookiePageContext('?sid=bookie&foo=bar'), true);
  // Argument omitted reads location.search, which the default stub sets to '?sid=bookie'.
  assert.equal(a.isBookiePageContext(), true);
});

test('isBookiePageContext rejects the bookie API, other sections, and junk', () => {
  // The critical one: a naive includes('bookie') would match this and re-break the fix.
  assert.equal(a.isBookiePageContext('?sid=bookieApi'), false);
  assert.equal(a.isBookiePageContext('?sid=gym'), false);
  // city.php / gym.php / item.php carry no query string at all.
  assert.equal(a.isBookiePageContext(''), false);
  assert.equal(a.isBookiePageContext('?foo=bar'), false);
});

test('isBookiePageContext returns false for malformed input instead of throwing', () => {
  // Note: none of these actually throw from URLSearchParams in Node. The try/catch is
  // defence-in-depth for engines that differ; this asserts the return value, not the throw.
  assert.equal(a.isBookiePageContext('?'), false);
  assert.equal(a.isBookiePageContext('?sid='), false);
  assert.equal(a.isBookiePageContext('?sid=BOOKIE'), false); // case-sensitive by design
  assert.equal(a.isBookiePageContext('???&&&'), false);
  assert.equal(a.isBookiePageContext('%'), false);
  assert.equal(a.isBookiePageContext(null), false);
});

test('isBookiePageContext accepts torn.com without the www prefix', () => {
  // The default stub is www.torn.com, so the bare-host accept branch needs its own load.
  const bare = loadUserscript({
    location: { origin: 'https://torn.com', hostname: 'torn.com', pathname: '/page.php', href: 'https://torn.com/page.php?sid=bookie', search: '?sid=bookie', hash: '' },
  });
  assert.equal(bare.isBookiePageContext(), true);
});

test('isBookiePageContext requires the /page.php path', () => {
  // The @match this gate replaces pinned the path. Without it, torn.com/city.php?sid=bookie
  // — a link anyone can hand a PDA user — would remount the panel on a non-Bookie page.
  assert.throws(
    () => loadUserscript({
      location: { pathname: '/city.php', href: 'https://www.torn.com/city.php?sid=bookie', search: '?sid=bookie' },
    }),
    /__TBLS__ not present/,
    'a crafted ?sid=bookie on a non-page.php path must not activate the script',
  );
});

test('isBookiePageContext requires a Torn hostname', () => {
  // This predicate gates whether fetch/XHR interception installs, so a stray ?sid=bookie
  // on a foreign origin must not qualify. Verified by loading against a non-Torn location.
  assert.throws(
    () => loadUserscript({
      location: { origin: 'https://evil.example', hostname: 'evil.example', pathname: '/page.php', href: 'https://evil.example/page.php?sid=bookie', search: '?sid=bookie', hash: '' },
    }),
    /__TBLS__ not present/,
    'a foreign origin carrying ?sid=bookie must not qualify',
  );
});

test('script returns early on a non-Bookie Torn page', () => {
  // The export injection is spliced in immediately before the IIFE close, so an early
  // return skips it and __TBLS__ is never assigned. That absence is the signal.
  // This is necessary-not-sufficient: it proves the tail never ran, not why. The real
  // correctness guard is the default-stub test below.
  assert.throws(
    () => loadUserscript({ location: TORN }),
    /__TBLS__ not present/,
    'gym.php should exit before the export injection at the IIFE close',
  );
});

test('default Bookie stub still loads the full script', () => {
  // Regression guard for the `search` property on the default location stub. If this
  // fails, every other suite fails too — the script would exit before defining anything.
  const api = loadUserscript();
  assert.equal(typeof api.isBookiePageContext, 'function');
  assert.equal(typeof api.escapeHtml, 'function');
  assert.equal(api.PANEL_WIDTH, 360);
});
