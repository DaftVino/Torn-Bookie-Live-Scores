'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { bookieData, NOW } = require('./fixtures');

const a = loadUserscript();

test('hasUsableBookieData: true only with a populated your-bets box', () => {
  assert.equal(a.hasUsableBookieData(null), false);
  assert.equal(a.hasUsableBookieData({}), false);
  assert.equal(a.hasUsableBookieData({ gameBoxesList: [] }), false);
  assert.equal(a.hasUsableBookieData({ gameBoxesList: [{ alias: 'your-bets', matches: [] }] }), false);
  assert.equal(a.hasUsableBookieData(bookieData()), true);
});

test('getYourBetsMatches: safe on malformed shapes', () => {
  assert.equal(a.getYourBetsMatches(null).length, 0);
  assert.equal(a.getYourBetsMatches({ gameBoxesList: 'nope' }).length, 0);
  assert.equal(a.getYourBetsMatches({ gameBoxesList: [{ alias: 'your-bets' }] }).length, 0); // matches missing
  assert.equal(a.getYourBetsMatches(bookieData()).length, 4);
});

test('extractLiveBets: only inprogress, non-excluded, enabled sports', () => {
  a.__control.setNow(NOW);
  const live = a.extractLiveBets(bookieData());
  const names = live.map(m => m.name);
  assert.ok(names.includes('Red Sox vs Yankees'));   // baseball inprogress, enabled
  assert.ok(!names.includes('NaVi vs FaZe'));         // esports inprogress but CS disabled by default
  assert.ok(!names.includes('Race 5'));               // horse racing excluded sport
  assert.ok(!names.includes('Alcaraz vs Djokovic'));  // tennis is notstarted -> not live
});

test('extractLiveBets: respects per-sport enable toggle', () => {
  a.__control.setNow(NOW);
  // Counter-Strike is disabled by default; ensure it is filtered out of live display
  const live = a.extractLiveBets(bookieData());
  const cs = live.find(m => m.name === 'NaVi vs FaZe');
  // default enabledSports['counter-strike'] === false -> excluded
  assert.equal(cs, undefined);
});

test('extractUpcomingBets: only notstarted, sorted by start time', () => {
  a.__control.setNow(NOW);
  const up = a.extractUpcomingBets(bookieData());
  assert.equal(up.length, 1);
  assert.equal(up[0].name, 'Alcaraz vs Djokovic');
  assert.equal(up[0].sourceKey, 'espn'); // tennis -> espn (dedicated tennis parser)
});

test('normalizeBetMatch: maps fields, sums bet amounts, derives source/sport', () => {
  const raw = bookieData().gameBoxesList[1].matches[0];
  const m = a.normalizeBetMatch(raw, 'live');
  assert.equal(m.team1, 'Boston Red Sox');
  assert.equal(m.team2, 'New York Yankees');
  assert.equal(m.amount, 3500); // 1000 + 2500
  assert.equal(m.sourceKey, 'espn'); // baseball MLB
  assert.equal(m.sportKey, 'baseball');
  assert.equal(m.sectionType, 'live');
});

test('normalizeBetMatch: tolerates missing ep / bets / fields', () => {
  const m = a.normalizeBetMatch({ ID: 7, sport: 'Hockey', status: 'inprogress' }, 'live');
  assert.equal(m.team1, '');
  assert.equal(m.team2, '');
  assert.equal(m.amount, 0);
  assert.equal(m.name, 'Unknown match');
});

test('normalizeBetMatch: bad bet amounts coerce to 0, not NaN', () => {
  const m = a.normalizeBetMatch({ ID: 8, sport: 'Baseball', stage: 'MLB', status: 'inprogress', ep: [{ name: 'A' }, { name: 'B' }], bets: [{ amount: 'x' }, { amount: null }, { amount: 50 }] }, 'live');
  assert.equal(m.amount, 50);
  assert.ok(Number.isFinite(m.amount));
});

test('groupMatchesBySport: groups + sorts alphabetically by label', () => {
  a.__control.setNow(NOW);
  const data = bookieData();
  // make all four inprogress and enable CS so grouping has multiple sports
  a.uiSettings.enabledSports['counter-strike'] = true;
  const live = a.extractLiveBets(data);
  const groups = a.groupMatchesBySport(live);
  const labels = groups.map(g => g.sportLabel);
  const sorted = [...labels].sort((x, y) => x.localeCompare(y));
  assert.deepEqual(labels.join('|'), sorted.join('|'));
  a.uiSettings.enabledSports['counter-strike'] = false; // restore
});

test('extractLiveBets: empty/garbage data yields empty array (no throw)', () => {
  assert.equal(a.extractLiveBets({}).length, 0);
  assert.equal(a.extractLiveBets(null).length, 0);
  assert.equal(a.extractLiveBets({ gameBoxesList: [{ alias: 'your-bets', matches: [{ status: 'weird', sport: 'Baseball' }] }] }).length, 0);
});
