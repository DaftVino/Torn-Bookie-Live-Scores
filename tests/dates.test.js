'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');

const a = loadUserscript();
const SEC = ms => Math.floor(ms / 1000);

test('normalizeTimestampMs: seconds -> ms, ms passthrough', () => {
  assert.equal(a.normalizeTimestampMs(1700000000), 1700000000000);
  assert.equal(a.normalizeTimestampMs(1700000000000), 1700000000000);
  assert.equal(a.normalizeTimestampMs('1700000000'), 1700000000000);
});

test('normalizeTimestampMs: rejects out-of-range / junk', () => {
  assert.equal(a.normalizeTimestampMs(null), null);
  assert.equal(a.normalizeTimestampMs(''), null);
  assert.equal(a.normalizeTimestampMs('abc'), null);
  assert.equal(a.normalizeTimestampMs(-5), null);
  assert.equal(a.normalizeTimestampMs(0), null);
  // 1e8 seconds is year 1973, below MIN_DATE; rejected
  assert.equal(a.normalizeTimestampMs(100000000), null);
});

test('normalizeTimestampMs: ISO requires explicit timezone', () => {
  assert.equal(a.normalizeTimestampMs('2026-06-20T19:30:00Z'), Date.UTC(2026, 5, 20, 19, 30, 0));
  assert.equal(a.normalizeTimestampMs('2026-06-20T19:30:00+00:00'), Date.UTC(2026, 5, 20, 19, 30, 0));
  // No timezone designator -> rejected (documented behavior)
  assert.equal(a.normalizeTimestampMs('2026-06-20T19:30:00'), null);
  assert.equal(a.normalizeTimestampMs('2026-06-20'), null);
});

test('isPlausibleTimestampMs bounds (2000..2100)', () => {
  assert.equal(a.isPlausibleTimestampMs(Date.UTC(2026, 0, 1)), true);
  assert.equal(a.isPlausibleTimestampMs(Date.UTC(1999, 0, 1)), false);
  assert.equal(a.isPlausibleTimestampMs(Date.UTC(2100, 0, 1)), false);
  assert.equal(a.isPlausibleTimestampMs(NaN), false);
});

test('formatProviderDate uses UTC for every format', () => {
  const t = Date.UTC(2026, 0, 5, 9, 0, 0);
  assert.equal(a.formatProviderDate(t, 'espn'), '20260105');
  assert.equal(a.formatProviderDate(t, 'iso'), '2026-01-05');
  assert.equal(a.formatProviderDate(t, 'livescore'), '05/01/2026');
});

test('date formatters near UTC midnight stay on the UTC calendar day', () => {
  // 23:30Z on the 20th must format as the 20th (not roll to 21st) in UTC
  const lateNight = Date.UTC(2026, 5, 20, 23, 30, 0);
  assert.equal(a.dateForEspn(SEC(lateNight)), '20260620');
  assert.equal(a.dateForIso(SEC(lateNight)), '2026-06-20');
  assert.equal(a.dateForLivescore(SEC(lateNight)), '20/06/2026');
  // 00:30Z on the 21st must format as the 21st
  const earlyMorning = Date.UTC(2026, 5, 21, 0, 30, 0);
  assert.equal(a.dateForEspn(SEC(earlyMorning)), '20260621');
});

test('startOfUtcDay / endOfUtcDay / addUtcDays', () => {
  const t = Date.UTC(2026, 5, 20, 18, 0, 0);
  assert.equal(a.startOfUtcDay(t), Date.UTC(2026, 5, 20, 0, 0, 0));
  assert.equal(a.endOfUtcDay(t), Date.UTC(2026, 5, 20, 23, 59, 59, 999));
  assert.equal(a.addUtcDays(t, 1), Date.UTC(2026, 5, 21, 18, 0, 0));
  assert.equal(a.addUtcDays(t, -1), Date.UTC(2026, 5, 19, 18, 0, 0));
});

test('addUtcDays crosses a month boundary correctly', () => {
  const t = Date.UTC(2026, 5, 30, 12, 0, 0); // June 30
  assert.equal(a.formatProviderDate(a.addUtcDays(t, 1), 'iso'), '2026-07-01');
  const m = Date.UTC(2026, 2, 1, 12, 0, 0); // March 1
  assert.equal(a.formatProviderDate(a.addUtcDays(m, -1), 'iso'), '2026-02-28');
});

test('buildLookupStep: null when anchor not plausible, offsets applied in UTC', () => {
  assert.equal(a.buildLookupStep('torn-start', NaN, 0, 'r', 'iso'), null);
  const step = a.buildLookupStep('torn-start', Date.UTC(2026, 5, 20, 23, 0, 0), 1, 'r', 'iso');
  assert.equal(step.providerDate, '2026-06-21');
  assert.equal(step.requestKey, '2026-06-21');
  assert.equal(step.offsetDays, 1);
});

test('dedupeLookupPlan removes duplicate requestKeys, keeps order', () => {
  const plan = [
    { requestKey: 'a' }, { requestKey: 'b' }, { requestKey: 'a' }, null, { requestKey: 'c' }
  ];
  const out = a.dedupeLookupPlan(plan);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(s => s.requestKey).join(','), 'a,b,c');
});

test('parseLivescoreStartMs parses YYYYMMDDhhmmss compact form (UTC)', () => {
  assert.equal(a.parseLivescoreStartMs({ Esd: '20260620183000' }), Date.UTC(2026, 5, 20, 18, 30, 0));
  assert.equal(a.parseLivescoreStartMs({ Esd: '20260620' }), Date.UTC(2026, 5, 20, 0, 0, 0));
  assert.equal(a.parseLivescoreStartMs({}), 0);
  assert.equal(a.parseLivescoreStartMs({ Esd: 'garbage' }), 0);
});

// ---- DOM "Due to start at ..." text parsing (TZ forced to UTC in harness) ----
test('parseSelectedGameStartTimestamp: numeric epoch passthrough', () => {
  assert.equal(a.parseSelectedGameStartTimestamp('1700000000'), 1700000000000);
});

test('parseSelectedGameStartTimestamp: time - date form', () => {
  const ms = a.parseSelectedGameStartTimestamp('19:30 - 20/06/2026');
  assert.equal(new Date(ms).toISOString(), '2026-06-20T19:30:00.000Z');
});

test('parseSelectedGameStartTimestamp: date time form with am/pm', () => {
  const ms = a.parseSelectedGameStartTimestamp('20/06/2026 7:30 pm');
  assert.equal(new Date(ms).toISOString(), '2026-06-20T19:30:00.000Z');
  const am = a.parseSelectedGameStartTimestamp('20/06/2026 12:15 am');
  assert.equal(new Date(am).toISOString(), '2026-06-20T00:15:00.000Z');
});

test('inferSelectedDateParts: disambiguates by >12 rule, else day-first', () => {
  assert.deepEqual({ ...a.inferSelectedDateParts(25, 6) }, { day: 25, month: 6 });
  assert.deepEqual({ ...a.inferSelectedDateParts(6, 25) }, { day: 25, month: 6 });
  // Ambiguous (both <= 12) -> day-first (documented behavior; DD/MM assumed)
  assert.deepEqual({ ...a.inferSelectedDateParts(1, 2) }, { day: 1, month: 2 });
  assert.equal(a.inferSelectedDateParts('x', 2), null);
});

test('buildSelectedStartTimestamp: 2-digit year and pm coercion', () => {
  const ms = a.buildSelectedStartTimestamp(20, 6, 26, 7, 30, 0, 'pm');
  assert.equal(new Date(ms).toISOString(), '2026-06-20T19:30:00.000Z');
  // implausible year -> '' (rejected)
  assert.equal(a.buildSelectedStartTimestamp(20, 6, 1850, 7, 30, 0, ''), '');
});

test('formatStartTime returns a friendly string and guards invalid input', () => {
  assert.equal(a.formatStartTime('not-a-date'), 'Start time unknown');
  assert.equal(typeof a.formatStartTime(1700000000), 'string');
});
