'use strict';

// Headless substitute for the (absent) preview HTML harness. The userscript's
// row/scoreboard renderers are pure string builders, so we can exercise every UI
// state the panel can show — loading/empty, upcoming, live, completed, delayed,
// error, unmatched (partial-provider) — and assert correctness + XSS-safety
// without a browser DOM. Re-rendering must be idempotent (no duplicated markup).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUserscript } = require('./load-userscript');
const { liveMatch, NOW } = require('./fixtures');

const a = loadUserscript();

function withScore(extra) {
  return liveMatch({ score: Object.assign({ found: true, sourceKey: 'espn', sourceLabel: 'ESPN', team1Score: 3, team2Score: 1, detail: 'Top 5th' }, extra) });
}

test('live state: matched scoreboard shows both teams and scores', () => {
  a.__control.setNow(NOW);
  const html = a.renderLiveMatch(withScore());
  assert.match(html, /Boston Red Sox/);
  assert.match(html, /New York Yankees/);
  assert.match(html, /tm-bookie-live-row/);
});

test('completed state: final detail surfaces in the status line', () => {
  a.__control.setNow(NOW);
  const html = a.renderLiveMatch(withScore({ detail: 'Final', team1Score: 5, team2Score: 2 }));
  assert.match(html, /Final/);
});

test('delayed/unmatched (partial-provider) state: shows "Score not matched"', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({ score: { found: false, detail: 'ESPN: no events for 2026-06-20' } });
  const html = a.renderScoreboard(m);
  assert.match(html, /Score not matched/);
  assert.match(html, /no events/);
});

test('unmatched score with diagnostics uses concise user guidance', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({
    score: {
      found: false,
      unmatched: true,
      detail: 'SofaScore: events found for live, 2026-06-25; no confident team match; top candidate Example A v Example B (team-confidence, confidence 0)'
    }
  });
  const html = a.renderScoreboard(m);
  assert.match(html, /Score not matched/);
  assert.match(html, /unusual game format or a Torn team alias\/title mismatch/i);
  assert.doesNotMatch(html, /top candidate/i);
});

test('live unmatched rows do not duplicate the unmatched guidance text', () => {
  a.__control.setNow(NOW);
  const m = liveMatch({
    status: 'Not started',
    score: {
      found: false,
      unmatched: true,
      userDetail: 'Score unavailable. This may be an unusual game format or a Torn team alias/title mismatch. Send your debug report and the game title to the developer for help.',
      detail: 'ESPN: events found for 20260625; no confident team match; top candidate Quentin Halys v Toby Samuel (team-confidence, confidence 0)'
    }
  });
  const html = a.renderLiveMatch(m);
  const matches = html.match(/unusual game format or a Torn team alias\/title mismatch/gi) || [];
  assert.equal(matches.length, 1);
});

test('upcoming state: shows match name and start-time prefix', () => {
  a.__control.setNow(NOW);
  const html = a.renderUpcomingMatch(liveMatch({ name: 'Red Sox vs Yankees', sectionType: 'upcoming', status: 'notstarted' }));
  assert.match(html, /Starts/);
  assert.match(html, /Red Sox vs Yankees/);     // upcoming rows show the match name
  assert.match(html, /tm-bookie-upcoming-row-card/);
});

test('empty state: renderSportGroups returns empty string for no matches', () => {
  assert.equal(a.renderSportGroups('live', 'Live', [], a.renderLiveMatch), '');
});

test('error state: dynamic text is HTML-escaped, known capture message is friendly', () => {
  assert.equal(
    a.renderErrorBody({ message: '<script>alert(1)</script>' }),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
  assert.match(a.renderErrorBody({ message: 'Be sure you have selected YOUR BETS.' }), /<strong>Be sure you have selected YOUR BETS\.<\/strong>/);
});

test('XSS-safety: malicious team name / detail are escaped in every scoreboard style', () => {
  a.__control.setNow(NOW);
  const evil = '<img src=x onerror=alert(1)>';
  for (const style of ['compact', 'classic', 'minimal']) {
    a.uiSettings.scoreboardStyle = style;
    const html = a.renderScoreboard(withScore({ })) // safe baseline
      + a.renderLiveMatch(liveMatch({ team1: evil, score: { found: true, team1Score: '1', team2Score: '0', detail: evil } }));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'), `style ${style} leaked raw HTML`);
    assert.ok(html.includes('&lt;img'), `style ${style} did not escape`);
  }
  a.uiSettings.scoreboardStyle = 'compact'; // restore
});

test('scoreboard styles all render the matched score', () => {
  a.__control.setNow(NOW);
  for (const style of ['compact', 'classic', 'minimal']) {
    a.uiSettings.scoreboardStyle = style;
    const html = a.renderScoreboard(withScore());
    assert.match(html, /3/);
    assert.match(html, /1/);
  }
  a.uiSettings.scoreboardStyle = 'compact';
});

test('re-rendering the same match is idempotent (no markup drift / duplication)', () => {
  a.__control.setNow(NOW);
  const m = withScore();
  const once = a.renderLiveMatch(m);
  for (let i = 0; i < 20; i++) {
    assert.equal(a.renderLiveMatch(m), once);
  }
  // exactly one details button and one row per render
  assert.equal((once.match(/tm-bookie-details-btn/g) || []).length, 1);
  assert.equal((once.match(/tm-bookie-live-row/g) || []).length, 1);
});

test('renderSportGroups groups multiple sports and renders one header each', () => {
  a.__control.setNow(NOW);
  const matches = [
    liveMatch({ sport: 'Baseball', sportKey: 'baseball', sportLabel: 'Baseball', score: { found: true, team1Score: 1, team2Score: 0, detail: 'live' } }),
    liveMatch({ sport: 'Hockey', sportKey: 'hockey', sportLabel: 'Hockey', team1: 'Bruins', team2: 'Rangers', score: { found: true, team1Score: 2, team2Score: 2, detail: 'P2' } })
  ];
  const html = a.renderSportGroups('live', 'Live', matches, a.renderLiveMatch);
  assert.equal((html.match(/tm-bookie-sport-header/g) || []).length, 2);
  assert.match(html, /Baseball/);
  assert.match(html, /Hockey/);
});

test('powered-by sources use real provider icons and never fall back to Torn', () => {
  assert.equal(a.SOURCE_ICONS.espncricinfo, a.SOURCE_ICONS.espn);
  assert.match(a.SOURCE_ICONS.apisports, /ANd9GcS3ctH13s5tLNx9ie7nSukNeA5UdxCK8ttBRPVKFgT1aQ/);
  assert.equal(a.SOURCE_ICONS.apifootball, a.SOURCE_ICONS.apisports);

  assert.equal(a.renderPoweredBySources(['torn']), '');
  assert.equal(a.getActiveSources([], []).length, 0);

  const html = a.renderPoweredBySources(['espncricinfo', 'apisports', 'apifootball']);
  assert.match(html, /tm-bookie-source-espncricinfo/);
  assert.match(html, /tm-bookie-source-apisports/);
  assert.match(html, /tm-bookie-source-apifootball/);
  assert.doesNotMatch(html, />API-Sports</);
  assert.doesNotMatch(html, />API-Football</);
});

test('debug report includes panel scroll metrics', () => {
  const b = loadUserscript();
  const settings = {
    offsetTop: 860,
    getBoundingClientRect: () => ({ top: 940, bottom: 1280, width: 340, height: 340 })
  };
  const content = {
    scrollTop: 120,
    scrollHeight: 1400,
    clientHeight: 720,
    querySelector: selector => selector === '.tm-bookie-settings-group' ? settings : null,
    getBoundingClientRect: () => ({ top: 200, bottom: 920, width: 340, height: 720 })
  };
  const panel = {
    scrollHeight: 780,
    clientHeight: 780,
    querySelector: selector => selector === '.tm-bookie-content' ? content : content.querySelector(selector),
    getBoundingClientRect: () => ({ top: 120, bottom: 900, width: 360, height: 780 })
  };
  b.__control.document.getElementById = id => id === 'tm-bookie-live-panel' ? panel : null;

  const report = b.buildDebugReport();
  assert.equal(report.panelState.scrollMetrics.panel.present, true);
  assert.equal(report.panelState.scrollMetrics.content.scrollTop, 120);
  assert.equal(report.panelState.scrollMetrics.content.scrollHeight, 1400);
  assert.equal(report.panelState.scrollMetrics.content.clientHeight, 720);
  assert.equal(report.panelState.scrollMetrics.settings.offsetTop, 860);
  assert.equal(report.panelState.scrollMetrics.settings.offsetFromContentTop, 860);
});

function makePanelRect(rect, hidden = false) {
  return {
    classList: { contains: cls => hidden && cls === 'tm-bookie-panel-hidden' },
    getBoundingClientRect: () => rect
  };
}

test('action notice placement mirrors right-side panel and aligns panel bottom', () => {
  const b = loadUserscript();
  b.uiSettings.layoutSide = 'right';
  b.__control.window.innerWidth = 1920;
  b.__control.window.innerHeight = 1080;
  b.__control.document.getElementById = id => id === 'tm-bookie-live-panel'
    ? makePanelRect({ left: 1548, right: 1908, bottom: 900, width: 360, height: 780 })
    : null;

  const placement = b.getActionNoticePlacement();
  assert.equal(placement.mode, 'adjacent');
  assert.equal(placement.width, `${b.DETAILS_WIDTH}px`);
  assert.equal(placement.right, '384px');
  assert.equal(placement.left, 'auto');
  assert.equal(placement.bottom, '180px');
});

test('action notice placement mirrors left-side panel', () => {
  const b = loadUserscript();
  b.uiSettings.layoutSide = 'left';
  b.__control.window.innerWidth = 1920;
  b.__control.window.innerHeight = 1080;
  b.__control.document.getElementById = id => id === 'tm-bookie-live-panel'
    ? makePanelRect({ left: 12, right: 372, bottom: 900, width: 360, height: 780 })
    : null;

  const placement = b.getActionNoticePlacement();
  assert.equal(placement.mode, 'adjacent');
  assert.equal(placement.width, `${b.DETAILS_WIDTH}px`);
  assert.equal(placement.left, '384px');
  assert.equal(placement.right, 'auto');
  assert.equal(placement.bottom, '180px');
});

test('action notice bottom placement clamps to edge gap', () => {
  const b = loadUserscript();
  b.uiSettings.layoutSide = 'right';
  b.__control.window.innerWidth = 1920;
  b.__control.window.innerHeight = 1080;
  b.__control.document.getElementById = id => id === 'tm-bookie-live-panel'
    ? makePanelRect({ left: 1548, right: 1908, bottom: 1090, width: 360, height: 780 })
    : null;

  assert.equal(b.getActionNoticePlacement().bottom, `${b.EDGE_GAP}px`);
});

test('action notice compact placement leaves mobile media query in control', () => {
  const b = loadUserscript();
  b.uiSettings.layoutSide = 'right';
  b.__control.window.innerWidth = b.TOAST_MOBILE_MAX_WIDTH;
  b.__control.window.innerHeight = 800;
  b.__control.document.getElementById = id => id === 'tm-bookie-live-panel'
    ? makePanelRect({ left: 48, right: 408, bottom: 700, width: 360, height: 610 })
    : null;

  const placement = b.getActionNoticePlacement();
  assert.equal(placement.mode, 'compact');
  assert.equal(placement.width, undefined);
  assert.equal(placement.left, undefined);
  assert.equal(placement.right, undefined);
});

test('action notice placement falls back when panel is missing or hidden', () => {
  const missing = loadUserscript();
  missing.uiSettings.layoutSide = 'right';
  missing.__control.window.innerWidth = 1920;
  missing.__control.document.getElementById = () => null;

  const missingPlacement = missing.getActionNoticePlacement();
  assert.equal(missingPlacement.mode, 'fallback');
  assert.equal(missingPlacement.layoutSide, 'right');
  assert.equal(missingPlacement.width, `${missing.DETAILS_WIDTH}px`);
  assert.equal(missingPlacement.bottom, `${missing.EDGE_GAP}px`);
  assert.equal(missingPlacement.left, 'auto');
  assert.equal(missingPlacement.right, `${missing.EDGE_GAP}px`);

  const hidden = loadUserscript();
  hidden.uiSettings.layoutSide = 'left';
  hidden.__control.window.innerWidth = 1920;
  hidden.__control.document.getElementById = id => id === 'tm-bookie-live-panel'
    ? makePanelRect({ left: 12, right: 36, bottom: 130, width: 24, height: 40 }, true)
    : null;

  const hiddenPlacement = hidden.getActionNoticePlacement();
  assert.equal(hiddenPlacement.mode, 'fallback');
  assert.equal(hiddenPlacement.layoutSide, 'left');
  assert.equal(hiddenPlacement.width, `${hidden.DETAILS_WIDTH}px`);
  assert.equal(hiddenPlacement.bottom, `${hidden.EDGE_GAP}px`);
  assert.equal(hiddenPlacement.left, `${hidden.EDGE_GAP}px`);
  assert.equal(hiddenPlacement.right, 'auto');
});

test('formatGame renders a deterministic copy-tool block', () => {
  const game = { sport: 'Baseball', matchName: 'Red Sox vs Yankees', competition: 'MLB', startTime: '18:00', markets: [{ name: 'Moneyline', bets: [{ desc: 'Red Sox', odds: '2/1', mult: 'x3.0', suspended: false }, { desc: 'Yankees', odds: '1/2', mult: 'x1.5', suspended: true }] }] };
  const out = a.formatGame(game, false);
  assert.match(out, /Sport:\s+Baseball/);
  assert.match(out, /Market: Moneyline/);
  assert.match(out, /\[SUSPENDED\]/);
});

test('copy tools remain clickable when no Torn game was selected at render time', () => {
  const html = a.renderCopyTools();
  assert.match(html, /Copy Full Game/);
  assert.match(html, /Show Game Details/);
  assert.doesNotMatch(html, /class="tm-bookie-copy-btn"[^>]*\sdisabled\b/);
  assert.doesNotMatch(html, /aria-disabled="true"/);
});
