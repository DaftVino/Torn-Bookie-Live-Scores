'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { liveMatch, NOW } = require('./fixtures');

const a = loadUserscript();
const SEC = ms => Math.floor(ms / 1000);

test('buildSofascoreLookupPlan: upcoming match -> single primary anchor date', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({ sectionType: 'upcoming', status: 'notstarted', isLive: false, startTimestamp: SEC(Date.UTC(2026, 5, 21, 13, 0, 0)) });
  const plan = a.buildSofascoreLookupPlan(m);
  assert.equal(plan[0].providerDate, '2026-06-21');
  assert.ok(plan.length <= 3);
});

test('buildSofascoreLookupPlan: live non-cricket adds adjacent +/-1 day fallback', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({ startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)) });
  const plan = a.buildSofascoreLookupPlan(m);
  const dates = plan.map(s => s.providerDate);
  assert.ok(dates.includes('2026-06-20'));
  assert.ok(dates.includes('2026-06-19') || dates.includes('2026-06-21'));
  assert.ok(plan.length <= 3);
});

test('buildSofascoreLookupPlan: live cricket spans multiple prior days (<=7 steps)', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({
    team1: 'India', team2: 'Australia', sport: 'Cricket', sportKey: 'cricket',
    startTimestamp: SEC(Date.UTC(2026, 5, 18, 5, 0, 0)) // started 2 days ago (multi-day test match)
  });
  const plan = a.buildSofascoreLookupPlan(m);
  const dates = plan.map(s => s.providerDate);
  assert.ok(plan.length <= 7);
  assert.ok(dates.includes('2026-06-18')); // anchor day
  assert.ok(dates.includes('2026-06-20')); // current/live day reachable
  // looks back several days from "now"
  assert.ok(dates.includes('2026-06-16') || dates.includes('2026-06-15'));
});

test('buildSofascoreLookupPlan: invalid anchor + not live -> empty plan', () => {
  const m = liveMatch({ startTimestamp: 'garbage', sectionType: 'upcoming', status: 'notstarted', isLive: false });
  assert.equal(a.buildSofascoreLookupPlan(m).length, 0);
});

test('buildSofascoreLookupPlan: invalid anchor but live -> current-live recovery step', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({ startTimestamp: 'garbage' });
  const plan = a.buildSofascoreLookupPlan(m);
  assert.ok(plan.length >= 1);
  assert.equal(plan[0].anchorKind, 'current-live');
  assert.match(plan[0].diagnostic || '', /current live recovery/);
});

test('buildDateBucketPlan: global upcoming sport widens by +/-1 day', () => {
  a.__control.setNow(NOW);
  const tennis = liveMatch({ sport: 'Tennis', sportKey: 'tennis', sectionType: 'upcoming', status: 'notstarted', isLive: false, startTimestamp: SEC(Date.UTC(2026, 5, 21, 13, 0, 0)) });
  const widened = a.buildDateBucketPlan(tennis, 'iso', { globalUpcoming: true });
  assert.ok(widened.length >= 2);
  const narrow = a.buildDateBucketPlan(liveMatch({ sport: 'Baseball', sportKey: 'baseball', sectionType: 'upcoming', status: 'notstarted', isLive: false }), 'iso', { globalUpcoming: true });
  assert.equal(narrow.length, 1); // baseball isn't a global-date sport
});

test('buildTheScorePlan: builds a +/-1 day ISO window around anchor', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({ startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)) });
  const plan = a.buildTheScorePlan(m);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].startIso, new Date(Date.UTC(2026, 5, 19, 0, 0, 0)).toISOString());
  assert.equal(plan[0].endIso, new Date(Date.UTC(2026, 5, 21, 23, 59, 59, 999)).toISOString());
});

test('buildTheScorePlan: no base -> empty', () => {
  const m = liveMatch({ startTimestamp: 'x', sectionType: 'upcoming', status: 'notstarted', isLive: false });
  assert.equal(a.buildTheScorePlan(m).length, 0);
});

test('buildPandaScorePlan: upcoming -> primary window first; live -> day-before first', () => {
  a.__control.setNow(NOW);
  const upcoming = liveMatch({ sport: 'Counter-Strike', sportKey: 'counter-strike', sectionType: 'upcoming', status: 'notstarted', isLive: false, startTimestamp: SEC(Date.UTC(2026, 5, 21, 16, 0, 0)) });
  const up = a.buildPandaScorePlan(upcoming);
  assert.ok(up.length <= 3 && up.length >= 1);
  assert.equal(up[0].reason, 'primary-window'); // offsets [0,-1,1]

  const live = liveMatch({ sport: 'Counter-Strike', sportKey: 'counter-strike', startTimestamp: SEC(Date.UTC(2026, 5, 20, 16, 0, 0)) });
  const lv = a.buildPandaScorePlan(live);
  // Live order is [-1,0,1] so the day-before is queried first (catches late-night spillover)
  assert.equal(lv[0].reason, 'adjacent-fallback');
  assert.ok(lv.some(s => s.reason === 'primary-window'));
});

test('buildNhlScorePlan: live includes an "nhl-now" step', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({ sport: 'Hockey', sportKey: 'hockey', stage: 'NHL', startTimestamp: SEC(Date.UTC(2026, 5, 20, 23, 0, 0)) });
  const plan = a.buildNhlScorePlan(m);
  assert.ok(plan.some(s => s.requestKey === 'now'));
  assert.ok(plan.length <= 4);
});

test('lookup steps carry deduped requestKeys', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({ startTimestamp: SEC(Date.UTC(2026, 5, 20, 18, 0, 0)) });
  const plan = a.buildSofascoreLookupPlan(m);
  const keys = plan.map(s => s.requestKey);
  assert.equal(new Set(keys).size, keys.length);
});
