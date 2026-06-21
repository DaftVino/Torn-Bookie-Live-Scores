'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

const a = loadUserscript();

test('detectEsportsGameKey matches by sport/stage/competition aliases', () => {
  assert.equal(a.detectEsportsGameKey({ sport: 'Counter-Strike' }), 'counter-strike');
  assert.equal(a.detectEsportsGameKey({ competition: 'CSGO Major' }), 'counter-strike');
  // Note: the 'cs2' alias is <=3 chars so it only matches as an exact token; a
  // competition string like 'CS2 Major' is NOT detected (see audit, Informational).
  assert.equal(a.detectEsportsGameKey({ competition: 'CS2 Major' }), '');
  // 'LoL Worlds' is NOT detected: 'lol' is exact-only and 'league of legends'
  // is not a substring of 'lol worlds' (see audit, Informational).
  assert.equal(a.detectEsportsGameKey({ stage: 'LoL Worlds' }), '');
  assert.equal(a.detectEsportsGameKey({ sport: 'League of Legends' }), 'league-of-legends');
  assert.equal(a.detectEsportsGameKey({ name: 'Dota 2 The International' }), 'dota-2');
  assert.equal(a.detectEsportsGameKey({ sport: 'Valorant' }), 'valorant');
  assert.equal(a.detectEsportsGameKey({ sport: 'Baseball' }), '');
});

test('detectEsportsGameKey short-alias requires exact token (no substring on <=3 chars)', () => {
  // "lol" is <=3 chars so it must equal a token, not be a substring of e.g. "Holloway"
  assert.equal(a.detectEsportsGameKey({ name: 'Max Holloway' }), '');
  assert.equal(a.detectEsportsGameKey({ name: 'lol' }), 'league-of-legends');
});

test('isExcludedSport excludes horse racing but never esports', () => {
  assert.equal(a.isExcludedSport({ sport: 'Horse Racing' }), true);
  assert.equal(a.isExcludedSport({ alias: 'horse-racing' }), true);
  assert.equal(a.isExcludedSport({ sport: 'Counter-Strike' }), false);
  assert.equal(a.isExcludedSport({ sport: 'Baseball' }), false);
});

test('getSportKey / getSportLabel for esports and traditional', () => {
  assert.equal(a.getSportKey({ sport: 'Counter-Strike' }), 'counter-strike');
  assert.equal(a.getSportLabel({ sport: 'Counter-Strike' }), 'Counter-Strike');
  assert.equal(a.getSportKey({ sport: 'Baseball' }), 'baseball');
  assert.equal(a.getSportLabel({ sport: 'Motorsports' }), 'Formula 1');
  assert.equal(a.getSportLabel({ sport: 'Mixed Martial arts' }), 'MMA / UFC');
});

test('chooseScoreSource routes leagues to the right provider', () => {
  assert.equal(a.chooseScoreSource({ sport: 'Baseball', stage: 'MLB' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Hockey', stage: 'NHL' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Basketball', competition: 'NBA' }), 'espn');
  assert.equal(a.chooseScoreSource({ sport: 'Tennis' }), 'sofascore');
  assert.equal(a.chooseScoreSource({ sport: 'Cricket' }), 'sofascore');
  assert.equal(a.chooseScoreSource({ sport: 'Counter-Strike' }), 'pandascore');
  assert.equal(a.chooseScoreSource({ sport: 'Football' }), 'torn'); // generic soccer -> default
});

test('getEspnKey maps recognised leagues, null otherwise', () => {
  assert.equal(a.getEspnKey({ sport: 'Baseball', stage: 'MLB' }), 'baseball_mlb');
  assert.equal(a.getEspnKey({ sport: 'American Football', competition: 'NFL' }), 'football_nfl');
  assert.equal(a.getEspnKey({ sport: 'Football', competition: 'World Cup' }), 'soccer_world');
  assert.equal(a.getEspnKey({ sport: 'Tennis' }), null);
});

test('isProviderSupportedForSport keys off sportKey maps', () => {
  assert.equal(a.isProviderSupportedForSport('espn', { sport: 'Baseball', stage: 'MLB' }), true);
  assert.equal(a.isProviderSupportedForSport('sofascore', { sportKey: 'tennis' }), true);
  assert.equal(a.isProviderSupportedForSport('livescore', { sportKey: 'football' }), false); // soccer excluded
  assert.equal(a.isProviderSupportedForSport('thescore', { sportKey: 'basketball' }), false);
  assert.equal(a.isProviderSupportedForSport('pandascore', { sportKey: 'counter-strike' }), true);
});

test('getProviderPriority filters by enabled + supported and de-dupes primary', () => {
  // Baseball/MLB: primary espn. thescore/bbcsport disabled by default; livescore/sofascore
  // support depends on sportKey map. Expect espn first.
  const order = a.getProviderPriority({ sport: 'Baseball', stage: 'MLB', sportKey: 'baseball', sourceKey: 'espn' });
  assert.equal(order[0], 'espn');
  assert.ok(!order.includes('thescore')); // disabled by default

  // Tennis -> sofascore primary; livescore/thescore support tennis but are gated by enable flags
  const tennis = a.getProviderPriority({ sport: 'Tennis', sportKey: 'tennis', sourceKey: 'sofascore' });
  assert.equal(tennis[0], 'sofascore');
});

test('getProviderPriority reflects runtime provider toggles (shared uiSettings)', () => {
  // thescore is disabled by default; enabling it should make it appear for a supported sport
  assert.ok(!a.getProviderPriority({ sportKey: 'tennis', sourceKey: 'sofascore' }).includes('thescore'));
  a.uiSettings.enabledProviders.thescore = true;
  assert.ok(a.getProviderPriority({ sportKey: 'tennis', sourceKey: 'sofascore' }).includes('thescore'));
  a.uiSettings.enabledProviders.thescore = false; // restore
});

test('isNhlMatch detects NHL via stage/competition', () => {
  assert.equal(a.isNhlMatch({ sport: 'Hockey', stage: 'NHL' }), true);
  assert.equal(a.isNhlMatch({ sport: 'Hockey', competition: 'AHL' }), false);
  assert.equal(a.isNhlMatch({ sport: 'Baseball' }), false);
});

test('getStatsProviderPriority picks NHL/football/default ladders', () => {
  assert.equal(a.getStatsProviderPriority({ sport: 'Hockey', stage: 'NHL' })[0], 'nhl');
  assert.equal(a.getStatsProviderPriority({ sportKey: 'american-football' })[0], 'espn-reuse');
  assert.equal(a.getStatsProviderPriority({ sportKey: 'baseball' })[0], 'espn-reuse');
});
