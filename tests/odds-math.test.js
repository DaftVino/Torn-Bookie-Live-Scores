'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { oddsEvent } = require('./fixtures');

const a = loadUserscript();
const approx = (x, y, eps = 1e-9) => assert.ok(Math.abs(x - y) <= eps, `${x} !~= ${y}`);
// vm-context objects carry the sandbox realm's prototypes, so deepStrictEqual
// (prototype-sensitive) is unreliable across the boundary. Compare by value.
const jsonEq = (x, y) => assert.equal(JSON.stringify(x), JSON.stringify(y));

test('americanToImpliedProb: positive and negative', () => {
  approx(a.americanToImpliedProb(100), 0.5);
  approx(a.americanToImpliedProb(-110), 110 / 210);
  approx(a.americanToImpliedProb(200), 100 / 300);
  assert.equal(a.americanToImpliedProb(0), null);
  assert.equal(a.americanToImpliedProb('x'), null);
});

test('decimalToImpliedProb: guards <= 1', () => {
  approx(a.decimalToImpliedProb(2.0), 0.5);
  approx(a.decimalToImpliedProb(1.91), 1 / 1.91);
  assert.equal(a.decimalToImpliedProb(1.0), null);
  assert.equal(a.decimalToImpliedProb(0.5), null);
});

test('oddsToImpliedProb dispatches on format', () => {
  approx(a.oddsToImpliedProb(-110, 'american'), 110 / 210);
  approx(a.oddsToImpliedProb(1.91, 'decimal'), 1 / 1.91);
});

test('prob round-trips through american/decimal', () => {
  approx(a.probToDecimal(0.5), 2.0);
  assert.equal(a.probToAmerican(0.5), 100);
  assert.equal(a.probToAmerican(0.6), -150);
  assert.equal(a.probToAmerican(0.4), 150);
  assert.equal(a.probToDecimal(0), null);
  assert.equal(a.probToDecimal(1), null);
  assert.equal(a.probToAmerican(1.2), null);
});

test('profitPer1 for both formats', () => {
  approx(a.americanProfitPer1(200), 2);
  approx(a.americanProfitPer1(-200), 0.5);
  approx(a.decimalProfitPer1(2.5), 1.5);
  assert.equal(a.decimalProfitPer1(1), null);
  assert.equal(a.profitPer1(2.5, 'decimal'), 1.5);
});

test('calcNoVigPair removes the vig and sums to 1', () => {
  const [p1, p2] = a.calcNoVigPair(0.55, 0.55);
  approx(p1, 0.5);
  approx(p2, 0.5);
  approx(p1 + p2, 1);
  jsonEq(a.calcNoVigPair(0, 0), [null, null]);
});

test('calcEvPct: positive when price beats fair', () => {
  // consensus 50%, decimal 2.10 -> EV = .5*1.1 - .5 = +0.05 -> 5%
  approx(a.calcEvPct(0.5, 2.10, 'decimal'), 5);
  // fair price -> ~0 EV
  approx(a.calcEvPct(0.5, 2.0, 'decimal'), 0);
  // worse than fair -> negative
  assert.ok(a.calcEvPct(0.5, 1.8, 'decimal') < 0);
});

test('pickBestPrice picks numerically largest, ignores non-finite', () => {
  const best = a.pickBestPrice([{ book: 'A', price: 1.9 }, { book: 'B', price: 2.05 }, { book: 'C', price: 'x' }], 'decimal');
  assert.equal(best.book, 'B');
  assert.equal(best.price, 2.05);
  assert.equal(a.pickBestPrice([], 'decimal'), null);
});

test('roundNumber rounds and guards non-finite', () => {
  assert.equal(a.roundNumber(1.23456, 2), 1.23);
  assert.equal(a.roundNumber(Infinity), null);
  assert.equal(a.roundNumber('x'), null);
});

test('abbreviateBook uses table then 3-letter fallback', () => {
  assert.equal(a.abbreviateBook('fanduel'), 'FD');
  assert.equal(a.abbreviateBook('draftkings'), 'DK');
  assert.equal(a.abbreviateBook('unibet_eu'), 'UNI');
  assert.equal(a.abbreviateBook(''), '?');
});

test('formatSpreadPoint signs the number', () => {
  assert.equal(a.formatSpreadPoint(1.5), '+1.5');
  assert.equal(a.formatSpreadPoint(-1.5), '-1.5');
  assert.equal(a.formatSpreadPoint('x'), '');
});

test('buildMoneylineRows requires two books with both sides', () => {
  const rows = a.buildMoneylineRows(oddsEvent(), 'decimal');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].market, 'ML');
  assert.equal(rows[0].bookCount, 2);
  assert.ok(rows[0].consensusProb > 0 && rows[0].consensusProb < 1);
  // hold should be positive (book takes a margin)
  assert.ok(rows[0].holdPct >= 0);
});

test('buildMoneylineRows skips 3-way (draw) markets', () => {
  const ev = { home_team: 'A', away_team: 'B', bookmakers: [
    { key: 'x', markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: 2 }, { name: 'Draw', price: 3 }, { name: 'B', price: 4 }] }] }
  ] };
  jsonEq(a.buildMoneylineRows(ev, 'decimal'), []);
});

test('buildTotalRows pairs only same total point', () => {
  const rows = a.buildTotalRows(oddsEvent(), 'decimal');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].market, 'TOT');
});

test('buildSpreadRows buckets by magnitude', () => {
  const rows = a.buildSpreadRows(oddsEvent(), 'decimal');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].market, 'RL');
});

test('buildBetRows ranks by EV and surfaces a positive best bet only', () => {
  const out = a.buildBetRows(oddsEvent(), 'decimal');
  assert.ok(Array.isArray(out.rows));
  assert.equal(out.oddsFormat, 'decimal');
  if (out.bestBet) assert.ok(out.bestBet.evPct > 0);
  // rows sorted descending by evPct (nulls last)
  for (let i = 1; i < out.rows.length; i++) {
    const prev = out.rows[i - 1].evPct ?? -Infinity;
    const cur = out.rows[i].evPct ?? -Infinity;
    assert.ok(prev >= cur);
  }
});

test('buildBetRows with no bookmakers returns empty', () => {
  const out = a.buildBetRows({ home_team: 'A', away_team: 'B', bookmakers: [] }, 'decimal');
  jsonEq(out.rows, []);
  assert.equal(out.bestBet, null);
});

test('buildBetCommentary fallback line when no best bet', () => {
  const lines = a.buildBetCommentary(null, []);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /No current line beats fair value/);
});

// ---- Documented defect (Low): abbreviateSelection filler-word fallback ----
// When every word is a filler (FC/SC/CF/the/of/and/&), the function falls back to
// the first three chars of the ORIGINAL string, re-introducing the filler and a
// trailing space instead of abbreviating the meaningful word. Characterization
test('abbreviateSelection filters filler words and uses filtered remainder', () => {
  assert.equal(a.abbreviateSelection('FC Barcelona'), 'BAR');
  assert.equal(a.abbreviateSelection('The Rock'), 'ROC');
  // Multi-word non-filler names use initials:
  assert.equal(a.abbreviateSelection('New York Yankees'), 'NYY');
  // Single non-filler word uses first three letters:
  assert.equal(a.abbreviateSelection('Liverpool'), 'LIV');
});
