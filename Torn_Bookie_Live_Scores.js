// ==UserScript==
// @name         Torn Bookie Live Scores
// @namespace    https://github.com/DaftVino/Torn-Bookie-Live-Scores
// @version      2.5.8
// @description  Shows a configurable right/left-side panel with live/upcoming Torn Bookie bets grouped by sport, with live scores from ESPN, ESPNcricinfo, API-Football/API-Sports (BYOK), SofaScore, LiveScore, TheScore, BBC Sport, and optional BYOK PandaScore esports support via staged per-match fallback with confidence matching, TTL caching, and request coalescing. Includes a progressive enrichment details pane (NHL stats, BYOK odds, expected outcome, commentary), copy tools for pasting full betting details in external applications, five themes, provider toggles, and debug mode while in testing. Please enable debug mode in settings, copy report and paste output from script in any error feedback to help resolve issues faster. NOT COMPATIBLE WITH TORN PDA.
// @author       DaftVino
// @license      MIT
// @match        https://www.torn.com/page.php?sid=bookie*
// @match        https://www.sofascore.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      site.api.espn.com
// @connect      api.sofascore.com
// @connect      www.sofascore.com
// @connect      prod-public-api.livescore.com
// @connect      api.thescore.com
// @connect      www.bbc.com
// @connect      api-web.nhle.com
// @connect      api.nhle.com
// @connect      api.the-odds-api.com
// @connect      api.pandascore.co
// @connect      v3.football.api-sports.io
// @connect      v1.rugby.api-sports.io
// @connect      v1.afl.api-sports.io
// @connect      hs-consumer-api.espncricinfo.com
// @homepage     https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores
// @supportURL   https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores/feedback
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /*
   * PRIVACY DISCLOSURE
   * ------------------
   * This script fetches live sports scores from external providers to display
   * alongside your Torn Bookie bets. The following applies to network requests:
   *
   *  - Only sport identifiers, dates, public API paths, provider event/team IDs,
   *    and user-supplied BYOK tokens for BYOK providers are sent to providers.
   *  - No Torn account data, usernames, bet amounts, bet selections, or any
   *    personally identifiable information is ever sent to any score provider.
   *  - XHR/fetch interception is limited to Torn's own bookie API responses
   *    (URLs containing "sid=bookieApi"). Captured data stays in local memory only.
   *  - Score provider requests are made only when the panel is active and matching
   *    bets are present. Requests are cached locally (45 s on success, 15 s on
   *    error) to minimise outbound traffic.
   *  - Disabled providers (TheScore, BBC Sport, PandaScore off by default) are
   *    never contacted. PandaScore also requires a user-supplied token.
   *
   * External domains contacted (configurable in Settings → Score Sources):
   *   ESPN        → site.api.espn.com       (enabled by default)
   *   SofaScore   → www.sofascore.com       (enabled by default; may briefly
   *                  open an inactive SofaScore tab to refresh its public API token)
   *   LiveScore   → prod-public-api.livescore.com (enabled by default)
   *   TheScore    → api.thescore.com        (disabled by default)
   *   BBC Sport   → www.bbc.com             (disabled by default)
   *   PandaScore  → api.pandascore.co       (disabled by default, BYOK)
   *   NHL APIs    → api-web.nhle.com/api.nhle.com (details enrichment only)
   *   The Odds API → api.the-odds-api.com   (disabled by default, BYOK)
   */

  // -- Panel identity ------------------------------------------------------------

  const PANEL_ID    = 'tm-bookie-live-panel';
  const TOAST_ID    = 'tm-bookie-toast';
  const DETAILS_ID  = 'tm-bookie-details-popout';
  const DEBUG_REPORT_NOTICE_ID = 'tm-bookie-debug-report-notice';
  const SETTINGS_KEY = 'tmBookieScoresUiSettings';
  const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '2.5.8';
  const SCRIPT_NAMESPACE = 'https://greasyfork.org/users/daftvino';

  const PANEL_WIDTH   = 360;  // must match #PANEL_ID width in CSS
  const DETAILS_WIDTH = 288;  // must match .tm-bookie-details width in CSS
  const EDGE_GAP      = 12;   // must match panel right/left offset in CSS
  const PANEL_TOP     = 90;   // must match panel/details fixed top alignment

  const COPY_SEP    = '-'.repeat(60);
  const COMPACT_RANGE = 3;

  // -- Refresh options -----------------------------------------------------------

  const REFRESH_OPTIONS = {
    '10s': 10000,
    '30s': 30000,
    '3m':  180000,
    'MAN': 0
  };

  // -- Score-fetch tuning --------------------------------------------------------

  const CONFIDENCE_THRESHOLD = 60;  // minimum matchTeamPair score to accept a result
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS   = 60 * MINUTE_MS;
  const DAY_MS    = 24 * HOUR_MS;
  const TTL_SUCCESS = 45000;        // cache lifetime for a successful provider response
  const TTL_ERROR   = 15000;        // cache lifetime after a provider error/miss
  const TTL_STATS        = 30 * 60 * 1000;      // team season stats: 30 min
  const TTL_FORM         = 20 * 60 * 1000;      // recent form: 20 min
  const TTL_ODDS_UPCOMING = 3 * 60 * 1000;      // upcoming odds: 3 min
  const TTL_ODDS_LIVE    = 45 * 1000;           // live odds: 45 s
  const TTL_ODDS_ERROR   = 30 * 1000;           // odds failure: 30 s
  const TTL_NEWS         = 10 * 60 * 1000;      // injuries/news: 10 min
  const TTL_H2H          = 6 * 60 * 60 * 1000;  // head-to-head: 6 h
  const TTL_RESOLVED_EVENT_ACTIVE = 5 * MINUTE_MS;
  const TTL_RESOLVED_EVENT_FINAL  = 2 * MINUTE_MS;
  const MIN_DATE_MS = Date.UTC(2000, 0, 1);
  const MAX_DATE_MS = Date.UTC(2100, 0, 1);

  // -- External odds configuration -----------------------------------------------

  const ODDS_KEY_STORE = 'tmBookieOddsApiKey';
  const ODDS_DEFAULT_REGION  = 'us';
  const ODDS_AVAILABLE_REGIONS = Object.freeze(['us', 'us2', 'uk', 'eu', 'au']);
  const ODDS_DEFAULT_MARKETS = Object.freeze(['h2h']);
  const ODDS_FULL_MARKETS    = Object.freeze(['h2h', 'spreads', 'totals']);
  const ODDS_DEFAULT_MARKETS_MODE = 'full';
  const ODDS_ODDS_FORMAT     = 'decimal';
  const ODDS_ANALYSIS_CACHE_KEY = 'tmBookieOddsAnalysisCache';
  const ODDS_ANALYSIS_CACHE_LIMIT = 50;

  function getOddsApiKey() {
    try { return GM_getValue(ODDS_KEY_STORE, '') || ''; }
    catch (_) { return ''; }
  }

  function setOddsApiKey(k) {
    try { GM_setValue(ODDS_KEY_STORE, String(k || '')); }
    catch (_) {}
  }

  function removeOddsApiKey() {
    try { GM_deleteValue(ODDS_KEY_STORE); }
    catch (_) {}
  }

  function maskOddsApiKey(k) {
    const key = String(k || '');
    if (!key) return '';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-2)}`;
  }

  function hasOddsApiKey() {
    return getOddsApiKey().length > 0;
  }

  function clearOddsAnalysisCache() {
    try { localStorage.removeItem(ODDS_ANALYSIS_CACHE_KEY); }
    catch (_) {}
  }

  // -- PandaScore BYOK configuration --------------------------------------------

  const PANDASCORE_TOKEN_STORE = 'tmBookiePandaScoreToken';

  function getPandaScoreToken() {
    try { return GM_getValue(PANDASCORE_TOKEN_STORE, '') || ''; }
    catch (_) { return ''; }
  }

  function setPandaScoreToken(token) {
    try { GM_setValue(PANDASCORE_TOKEN_STORE, String(token || '')); }
    catch (_) {}
  }

  function removePandaScoreToken() {
    try { GM_deleteValue(PANDASCORE_TOKEN_STORE); }
    catch (_) {}
  }

  function maskPandaScoreToken(token) {
    const key = String(token || '');
    if (!key) return '';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-2)}`;
  }

  function hasPandaScoreToken() {
    return getPandaScoreToken().length > 0;
  }

  // -- API-Sports (api-sports.io) BYOK configuration ----------------------------

  const APISPORTS_KEY_STORE = 'tmBookieApiSportsKey';
  const BYOK_USAGE_LEDGER_STORE = 'tmBookieByokUsageLedger';

  function getApiSportsKey() {
    try { return GM_getValue(APISPORTS_KEY_STORE, '') || ''; }
    catch (_) { return ''; }
  }

  function setApiSportsKey(k) {
    try { GM_setValue(APISPORTS_KEY_STORE, String(k || '')); }
    catch (_) {}
  }

  function removeApiSportsKey() {
    try { GM_deleteValue(APISPORTS_KEY_STORE); }
    catch (_) {}
  }

  function maskApiSportsKey(k) {
    const key = String(k || '');
    if (!key) return '';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}...${key.slice(-2)}`;
  }

  function hasApiSportsKey() {
    return getApiSportsKey().length > 0;
  }

  // -- SofaScore self-healing x-requested-with token ----------------------------

  const SOFASCORE_XRW_STORE = 'sofascore_xrw';
  const SOFASCORE_XRW_TS_STORE = 'sofascore_xrw_ts';
  const SOFASCORE_XRW_REFRESH_TS_STORE = 'sofascore_xrw_refresh_ts';
  const SOFASCORE_XRW_FALLBACK = 'e06c91';
  const SOFASCORE_XRW_REFRESH_COOLDOWN_MS = 6 * HOUR_MS;
  const SOFASCORE_REFRESH_URL = 'https://www.sofascore.com/#tbls-token-refresh';

  function getSofascoreToken() {
    try { return GM_getValue(SOFASCORE_XRW_STORE, SOFASCORE_XRW_FALLBACK) || SOFASCORE_XRW_FALLBACK; }
    catch (_) { return SOFASCORE_XRW_FALLBACK; }
  }

  function getSofascoreTokenTimestamp() {
    try { return Number(GM_getValue(SOFASCORE_XRW_TS_STORE, 0)) || 0; }
    catch (_) { return 0; }
  }

  function setSofascoreToken(value, now = Date.now()) {
    const token = String(value || '').trim();
    if (!token) return false;
    try {
      GM_setValue(SOFASCORE_XRW_STORE, token);
      GM_setValue(SOFASCORE_XRW_TS_STORE, Number(now) || Date.now());
      return true;
    } catch (_) {
      return false;
    }
  }

  function captureSofascoreRequestedWith(requestUrl, headerName, headerValue, now = Date.now()) {
    const url = String(requestUrl || '');
    const name = String(headerName || '').toLowerCase();
    if (!url.includes('/api/v1/') || name !== 'x-requested-with') return false;
    return setSofascoreToken(headerValue, now);
  }

  function isSofascoreContext() {
    try { return location.hostname === 'www.sofascore.com' || location.hostname === 'sofascore.com'; }
    catch (_) { return false; }
  }

  function isSofascoreTokenRefreshContext() {
    try { return String(location.hash || '') === '#tbls-token-refresh'; }
    catch (_) { return false; }
  }

  function refreshSofascoreToken(now = Date.now()) {
    let last = 0;
    try { last = Number(GM_getValue(SOFASCORE_XRW_REFRESH_TS_STORE, 0)) || 0; }
    catch (_) {}
    if (last && now - last < SOFASCORE_XRW_REFRESH_COOLDOWN_MS) {
      recordDebugEvent('provider-fetch-meta', {
        provider: 'sofascore',
        tokenRefreshQueued: false,
        cooldownRemainingMs: SOFASCORE_XRW_REFRESH_COOLDOWN_MS - (now - last)
      });
      return false;
    }
    try {
      GM_setValue(SOFASCORE_XRW_REFRESH_TS_STORE, now);
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(SOFASCORE_REFRESH_URL, { active: false });
        recordDebugEvent('provider-fetch-meta', { provider: 'sofascore', tokenRefreshQueued: true });
        return true;
      }
    } catch (error) {
      recordDebugEvent('provider-fetch-meta', { provider: 'sofascore', tokenRefreshQueued: false, error: error?.message || error });
    }
    return false;
  }

  function isSofascoreTokenRejection(board) {
    if (!board) return true;
    const err = String(board.error || '').toLowerCase();
    return !!err && (/\b(?:401|403)\b/.test(err) || err.includes('forbidden') || err.includes('challenge'));
  }

  function installSofascoreTokenCapture() {
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    if (!win) return;

    let capturedFreshToken = false;
    const closeAfterCapture = () => {
      if (!isSofascoreTokenRefreshContext()) return;
      try { window.close(); } catch (_) {}
    };
    const captureAndMaybeClose = (url, name, value) => {
      if (captureSofascoreRequestedWith(url, name, value)) {
        capturedFreshToken = true;
        closeAfterCapture();
      }
      return capturedFreshToken;
    };

    const originalOpen = win.XMLHttpRequest?.prototype?.open;
    const originalSetRequestHeader = win.XMLHttpRequest?.prototype?.setRequestHeader;
    if (originalOpen && originalSetRequestHeader) {
      win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__tmBookieSofascoreUrl = String(url || '');
        return originalOpen.call(this, method, url, ...rest);
      };
      win.XMLHttpRequest.prototype.setRequestHeader = function (name, value, ...rest) {
        captureAndMaybeClose(this.__tmBookieSofascoreUrl, name, value);
        return originalSetRequestHeader.call(this, name, value, ...rest);
      };
    }

    const originalFetch = win.fetch;
    if (typeof originalFetch === 'function') {
      win.fetch = function (input, init = {}) {
        try {
          const url = String(input?.url || input || '');
          const headers = init?.headers;
          if (headers instanceof Headers) {
            captureAndMaybeClose(url, 'x-requested-with', headers.get('x-requested-with'));
          } else if (Array.isArray(headers)) {
            for (const [name, value] of headers) captureAndMaybeClose(url, name, value);
          } else if (headers && typeof headers === 'object') {
            for (const [name, value] of Object.entries(headers)) captureAndMaybeClose(url, name, value);
          }
          if (typeof Request !== 'undefined' && input instanceof Request) {
            captureAndMaybeClose(input.url, 'x-requested-with', input.headers.get('x-requested-with'));
          }
        } catch (_) {}
        return originalFetch.apply(this, arguments);
      };
    }
  }

  // -- Sports excluded from score lookup -----------------------------------------

  const EXCLUDED_SPORT_KEYS = new Set([
    'volleyball', 'starcraft 2', 'snooker', 'overwatch',
    'handball', 'horse racing',
    'boxing', 'mixed martial arts', 'mma ufc', 'motorsports',
    'formula 1'
  ]);

  const EXCLUDED_ALIASES = new Set([
    'volleyball', 'starcraft-2', 'snooker', 'overwatch',
    'handball', 'horse-racing',
    'boxing', 'mmaufc', 'formula-1', 'motor'
  ]);

  // -- Provider metadata ---------------------------------------------------------

  const SOURCE_LABELS = {
    espn:      'ESPN',
    espncricinfo:'ESPNcricinfo',
    sofascore: 'SofaScore',
    livescore: 'LiveScore',
    thescore:  'TheScore',
    bbcsport:  'BBC Sport',
    apisports: 'API-Sports',
    apifootball:'API-Football',
    pandascore:'PandaScore',
    torn:      'Torn'
  };

  const SOURCE_ICONS = {
    espn: 'data:image/png;base64,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',
    sofascore: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOEAAADhCAMAAAAJbSJIAAAANlBMVEU3TfX///8xSPVqePczSvVPYvYoQvWutPphcPZKXvYsRfVfbvaQmvlEWPUwR/VOYfaepvmZovnq+Oq+AAABXklEQVR4nO3d2XGDQBBFUZnFBrTnn6wTMFilnpnG+JwAVO8K/oCa0wkAAAAAAAAAAAAAANiFrrXWgcPUtzUNbQO76aO1qe1V7Prmhb1ChQoVKlSoUKFChQoVKlSoUKFChQoVKlR4kMLzngov81jctfHDp+3C+TaU1zbwl8Kx9ZwKFGbvi1OYvS9OYfa+OIXZ++IUZu+LU5i9L05h9r44hdn74hRm74tTmL0vTmH2vjiF2fvitgvv7xYun6uWovtf8fha9Xx3zfJc/9FH0fUvrSn/dw/3rRuj8dO1KoZR4V+nMHtfnMLsfXEKs/fFKczeF6cwe1+cwux9cQqz98UpzN4XpzB7X5zC7H1xCrP3xe2ssMLb+Ld5T4XdtfwnFfNlR4XdeWtMFcf/KkihQoUKFSpUqFChQoUKFSpUqFChQoUKFSqsU3j48y2Of0bJPzhnBgAAAAAAAAAAAAAA+Nk3X90yH8zl2zIAAAAASUVORK5CYII=',
    livescore: 'data:image/jpeg;base64,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',
    thescore: 'data:image/jpeg;base64,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',
    bbcsport: 'data:image/png;base64,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'
  };

  SOURCE_ICONS.espncricinfo = SOURCE_ICONS.espn;
  SOURCE_ICONS.apisports = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS3ctH13s5tLNx9ie7nSukNeA5UdxCK8ttBRPVKFgT1aQ&s';
  SOURCE_ICONS.apifootball = SOURCE_ICONS.apisports;
  SOURCE_ICONS.pandascore = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT_iL8WcXyEf9Bdqj89D1mcNZoP5VqjqrF-4j0EDQiy3A&s=10';

  const SOURCE_HOME_URLS = {
    espn:      'https://www.espn.com/',
    espncricinfo:'https://www.espncricinfo.com/',
    sofascore: 'https://www.sofascore.com/',
    livescore: 'https://www.livescore.com/',
    thescore:  'https://www.thescore.com/',
    bbcsport:  'https://www.bbc.com/sport',
    apisports: 'https://www.api-sports.io/',
    apifootball:'https://www.api-football.com/',
    pandascore:'https://pandascore.co/'
  };

  // Derived from SOURCE_HOME_URLS so the link host allowlist can't drift from the
  // provider list: each provider's hostname plus its apex (www-stripped) variant.
  const SAFE_SOURCE_HOSTS = new Set(
    Object.values(SOURCE_HOME_URLS).flatMap(url => {
      const host = new URL(url).hostname.toLowerCase();
      return [host, host.replace(/^www\./, '')];
    })
  );

  // Maps an ESPN endpoint key to the espn.com web section used for game deep-links.
  // hockey_ahl is intentionally omitted: ESPN has no /ahl/ web pages, and AHL
  // game ids do not resolve under /nhl/, so AHL falls back to a real linked URL
  // (if the event provides one) or the ESPN home page rather than a broken link.
  const ESPN_WEB_SPORT_SLUGS = {
    baseball_mlb:   'mlb',
    soccer_world:   'soccer',
    soccer_fifa_cwc:'soccer',
    soccer_aus_aleague:'soccer',
    soccer_nor_elite:'soccer',
    soccer_uefa_champions:'soccer',
    soccer_eng_pl:  'soccer',
    soccer_esp_laliga:'soccer',
    soccer_ita_seriea:'soccer',
    soccer_bra_seriea:'soccer',
    soccer_ger_bundesliga:'soccer',
    soccer_fra_ligue1:'soccer',
    soccer_usa_mls: 'soccer',
    soccer_mex_ligamx:'soccer',
    hockey_nhl:     'nhl',
    basketball_nba: 'nba',
    basketball_wnba:'wnba',
    football_nfl:   'nfl',
    football_cfl:   'cfl',
    tennis_all:     'tennis'
  };

  function safeExternalSourceUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol !== 'https:') return '';
      if (!SAFE_SOURCE_HOSTS.has(parsed.hostname.toLowerCase())) return '';
      return parsed.href;
    } catch (_) {
      return '';
    }
  }

  function firstSafeSourceUrl(values) {
    for (const value of values || []) {
      const safe = safeExternalSourceUrl(value);
      if (safe) return safe;
    }
    return '';
  }

  function candidateUrlFields(candidate) {
    const raw = candidate?.raw || {};
    const links = Array.isArray(raw.links) ? raw.links.map(link => link?.href) : [];
    return [
      raw.url,
      raw.href,
      raw.link,
      raw.permalink,
      raw.webUrl,
      raw.websiteUrl,
      raw.matchUrl,
      raw.shareUrl,
      ...links
    ];
  }

  // Shared resolution ladder for a provider's source link: prefer a safe link the
  // provider already returned, then a provider-specific constructed deep link,
  // then the provider home page.
  function resolveSourceUrl(sourceKey, candidate, constructUrl) {
    const linkedUrl = firstSafeSourceUrl(candidateUrlFields(candidate));
    if (linkedUrl) return linkedUrl;
    if (constructUrl) {
      const built = safeExternalSourceUrl(constructUrl());
      if (built) return built;
    }
    return SOURCE_HOME_URLS[sourceKey] || '';
  }

  function buildEspnSourceUrl(candidate, espnKey) {
    return resolveSourceUrl('espn', candidate, () => {
      const webSport = ESPN_WEB_SPORT_SLUGS[espnKey];
      const eventId = String(candidate?.providerEventId || '').trim();
      if (!webSport || !eventId) return '';
      // ESPN soccer game pages live under /soccer/match/, every other sport uses /game/.
      const segment = webSport === 'soccer' ? 'match' : 'game';
      return `https://www.espn.com/${webSport}/${segment}/_/gameId/${encodeURIComponent(eventId)}`;
    });
  }

  function buildBbcSourceUrl(sportPath, candidate) {
    return resolveSourceUrl('bbcsport', candidate, () => {
      const date = String(candidate?.queriedDate || '').trim();
      if (!sportPath || !date) return '';
      return `https://www.bbc.com/sport/${encodeURIComponent(sportPath)}/scores-fixtures/${encodeURIComponent(date)}`;
    });
  }

  function buildScoreSourceUrl(sourceKey, candidate, mapped) {
    const mappedUrl = safeExternalSourceUrl(mapped?.sourceUrl);
    if (mappedUrl) return mappedUrl;
    return resolveSourceUrl(sourceKey, candidate, null);
  }

  const SUPPORTED_PROVIDER_SETTINGS = [
    ['espn',      'ESPN'],
    ['espncricinfo', 'ESPNcricinfo'],
    ['sofascore', 'SofaScore'],
    ['apisports', 'API-Sports'],
    ['livescore', 'LiveScore'],
    ['thescore',  'TheScore'],
    ['bbcsport',  'BBC Sport'],
    ['pandascore','PandaScore']
  ];

  // -- ESPN endpoints ------------------------------------------------------------

  const ESPN_ENDPOINTS = {
    baseball_mlb:      'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
    soccer_world:      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard',
    soccer_fifa_cwc:   'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.cwc/scoreboard',
    soccer_aus_aleague:'https://site.api.espn.com/apis/site/v2/sports/soccer/aus.1/scoreboard',
    soccer_nor_elite:  'https://site.api.espn.com/apis/site/v2/sports/soccer/nor.1/scoreboard',
    // C2-FIX: a handful of high-value, reliably-free ESPN soccer leagues (free-first
    // optimization). api-football (Phase A) covers the long tail of leagues by date, so a
    // league not mapped here still resolves there. A wrong slug just yields no team match
    // and falls through, never a false positive.
    soccer_uefa_champions:'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard',
    soccer_eng_pl:     'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
    soccer_esp_laliga: 'https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard',
    soccer_ita_seriea: 'https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/scoreboard',
    soccer_bra_seriea: 'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard',
    soccer_ger_bundesliga:'https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard',
    soccer_fra_ligue1: 'https://site.api.espn.com/apis/site/v2/sports/soccer/fra.1/scoreboard',
    soccer_usa_mls:    'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard',
    soccer_mex_ligamx: 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard',
    hockey_ahl:        'https://site.api.espn.com/apis/site/v2/sports/hockey/ahl/scoreboard',
    hockey_nhl:        'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
    basketball_nba:    'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
    basketball_wnba:   'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard',
    football_nfl:      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
    football_cfl:      'https://site.api.espn.com/apis/site/v2/sports/football/cfl/scoreboard',
    tennis_all:        'https://site.api.espn.com/apis/site/v2/sports/tennis/all/scoreboard',
    rugby_league_nrl:  'https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard',
    australian_football_afl: 'https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard'
  };

  // Verified leagueIds for the per-tournament tennis/all/scoreboard endpoint.
  // eventId is always ${id}-${currentYear}. A 2026-06-24 probe returned Wimbledon
  // qualifying, Eastbourne, Mallorca, and Bad Homburg. Plovdiv Challenger was not
  // present in ESPN's board for that date, so SofaScore remains first for tennis.
  const TENNIS_LEAGUE_IDS = [
    188, // Wimbledon
    444, // Eastbourne
    637, // Mallorca
    636, // Bad Homburg
    635  // Berlin
  ];

  // -- SofaScore sport slugs -----------------------------------------------------

  const SOFASCORE_SPORT_SLUGS = {
    football:             'football',
    tennis:               'tennis',
    badminton:            'badminton',
    rugby:                'rugby',
    'rugby-league':       'rugby-league',
    'australian-football':'australian-football',
    hockey:               'ice-hockey',
    basketball:           'basketball',
    'american-football':  'american-football',
    baseball:             'baseball'
  };

  // -- LiveScore.com sport slugs -------------------------------------------------
  // API: prod-public-api.livescore.com — date format DD/MM/YYYY
  // Fields: T1[0].Nm, T2[0].Nm, Tr1, Tr2, Eps, Esid

  const LIVESCORE_SPORT_SLUGS = {
    // football/soccer excluded: prod-public-api.livescore.com/v1/api/app/date/soccer/... returns HTTP 404 as of 2026-06-20
    hockey:               'hockey',
    // basketball excluded: prod-public-api.livescore.com/v1/api/app/date/basketball/... returns HTTP 404 as of 2026-06-20
    // tennis excluded: prod-public-api.livescore.com/v1/api/app/date/tennis/... returns HTTP 404 as of 2026-06-24
    cricket:              'cricket',
    rugby:                'rugby',
    'rugby-league':       'rugby',
    'australian-football':'aussie-rules',
    badminton:            'badminton'
    // american-football excluded: LiveScore API returns 404 for this slug
    // baseball excluded: LiveScore API currently returns 404 for MLB date feeds
  };

  // -- TheScore.com sport slugs --------------------------------------------------
  // API: api.thescore.com — response array of events
  // Fields: home_team.name, away_team.name, score.home, score.away, status

  const THESCORE_SPORT_SLUGS = {
    // football/soccer excluded: api.thescore.com/soccer/events returns HTTP 404 as of 2026-06-20
    hockey:              'hockey',
    // basketball excluded: api.thescore.com/basketball/events returns HTTP 404 as of 2026-06-20
    // tennis excluded: api.thescore.com/tennis/events returns HTTP 404 as of 2026-06-24
    cricket:             'cricket',
    rugby:               'rugby',
    'american-football': 'football'
    // baseball excluded: api.thescore.com/baseball/events currently returns 404 for MLB
  };

  // -- BBC Sport paths -----------------------------------------------------------

  const BBC_SPORT_PATHS = {
    football:      'football',
    soccer:        'football',
    cricket:       'cricket',
    rugby:         'rugby-union',
    'rugby-league':'rugby-league'
    // tennis excluded: BBC tennis score pages return HTTP 404 as of 2026-06-24
  };

  // -- PandaScore esports mapping (provider integration follows in later phase) --

  const PANDASCORE_GAME_SLUGS = {
    'counter-strike':    'csgo',
    'league-of-legends': 'lol',
    'dota-2':            'dota2',
    valorant:            'valorant'
  };

  const ESPORTS_GAME_LABELS = {
    'counter-strike':    'Counter-Strike',
    'league-of-legends': 'League of Legends',
    'dota-2':            'Dota 2',
    valorant:            'Valorant'
  };

  const ESPORTS_GAME_PATTERNS = [
    ['counter-strike',    ['counter strike', 'counter-strike', 'csgo', 'cs go', 'cs2', 'cs 2']],
    ['league-of-legends', ['league of legends', 'league-of-legends', 'lol']],
    ['dota-2',            ['dota 2', 'dota-2', 'dota2']],
    ['valorant',          ['valorant']]
  ];

  // -- Supported sports (for Settings UI) ---------------------------------------

  const SUPPORTED_SPORT_SETTINGS = [
    ['american-football',  'American Football'],
    ['australian-football','Australian Football'],
    ['badminton',          'Badminton'],
    ['baseball',           'Baseball'],
    ['basketball',         'Basketball'],
    ['counter-strike',     'Counter-Strike'],
    ['cricket',            'Cricket'],
    ['dota-2',             'Dota 2'],
    ['football',           'Football'],
    ['hockey',             'Hockey'],
    ['league-of-legends',  'League of Legends'],
    ['rugby',              'Rugby'],
    ['rugby-league',       'Rugby League'],
    ['tennis',             'Tennis'],
    ['valorant',           'Valorant']
  ];

  // -- Default UI settings -------------------------------------------------------

  const DEFAULT_UI_SETTINGS = {
    theme:                  'default',
    layoutSide:             'right',
    detailsPosition:        'adjacent',
    scoreboardStyle:        'compact',
    showLive:               true,
    showUpcoming:           true,
    showCopyTools:          true,
    showPoweredBy:          true,
    showSourceInRows:       true,
    showBetAmount:          true,
    hideUnmatchedGames:     false,
    autoCollapseUpcoming:   true,
    rememberCollapsedGroups:true,
    showDetailsButtons:     true,
    showTeamStats:          true,
    showMarketConsensus:    true,
    showExpectedOutcome:    true,
    showBettingCommentary:  true,
    showSourceList:         true,
    enableExternalOdds:     false,
    oddsRegion:             ODDS_DEFAULT_REGION,
    oddsMarketsMode:        ODDS_DEFAULT_MARKETS_MODE,
    enableDebugMode:        false,
    enabledSports: {
      'american-football':   true,
      'australian-football': true,
      badminton:             true,
      baseball:              true,
      basketball:            true,
      'counter-strike':       false,
      cricket:               true,
      'dota-2':               false,
      football:              true,
      hockey:                true,
      'league-of-legends':    false,
      rugby:                 true,
      'rugby-league':        true,
      tennis:                true,
      valorant:              false
    },
    apiSportsRefreshMode: 'manual',
    enabledProviders: {
      espn:      true,
      sofascore: true,
      apisports: true,
      espncricinfo: true,
      livescore: true,
      thescore:  false,
      bbcsport:  false,
      pandascore:false,
      theoddsapi:false
    }
  };

  // -- Runtime state -------------------------------------------------------------

  let refreshMode       = '30s';
  let refreshIntervalId = null;

  let capturedBookieData  = null;
  let lastRenderTimer     = null;
  let lastUpdatedText     = '';
  let isRefreshingPanel   = false;
  let lastRefreshErrorMessage = '';
  let isPanelHidden       = false;
  let copyToolsCollapsed  = false;
  let settingsCollapsed   = true;
  let latestOddsQuota     = null;
  let latestPandaQuota    = null;
  let latestApiSportsQuota = {};
  const latestByokQuota = {};

  let activeDetailsMatchKey  = null;
  let activeDetailsFallbackMatch = null;
  let lastCopyReceipt = null;
  let pinnedLiveMatchKeys = [];
  let lastCopyToolsSelectionSignature = '';
  let copyToolsSelectionWatcherBound = false;
  let latestRenderableMatches = [];
  let detailsResizeListenerBound = false;
  let detailsResizeTimer = null;

  // Provider response cache — key → { data, expiry }
  const providerCache     = new Map();
  const enrichmentCache   = new Map();
  const resolvedEventCache = new Map();
  // In-flight request coalescing — key → Promise
  const inFlightRequests  = new Map();
  const debugEventBuffer  = [];
  const DEBUG_EVENT_LIMIT = 200;
  const networkStats   = new Map(); // host → { lastStatus, lastKind, lastMs, lastOkAt, lastErrAt, okCount, errCount }
  const networkSamples = new Map(); // host → shape descriptor

  const collapsedSportGroups = { live: {}, upcoming: {} };

  let uiSettings = loadUiSettings();

  // -- Debug report sanitization -------------------------------------------------

  function limitDebugString(value, maxLength = 1000) {
    const text = String(value ?? '');
    return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sanitizeDebugText(value) {
    let text = limitDebugString(value, 3000);
    const knownSecrets = [getOddsApiKey(), getPandaScoreToken(), getApiSportsKey()].filter(secret => String(secret || '').length >= 4);
    for (const secret of knownSecrets) {
      text = text.replace(new RegExp(escapeRegExp(secret), 'g'), '[redacted-secret]');
    }
    return text
      .replace(/(apiKey=)[^&\s"']+/gi, '$1[redacted]')
      .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
      .replace(/(Authorization["']?\s*[:=]\s*["']?\s*Bearer\s+)[^"',\s}]+/gi, '$1[redacted]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
      .replace(/(token["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
      .replace(/(password["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
      .replace(/(cookie["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[redacted]')
      .replace(/C:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[user]');
  }

  function isSensitiveDebugKey(key) {
    return [
      'amount', 'bet', 'bets', 'tornid', 'torn_id',
      'raw', 'rawevent', 'capturedbookiedata',
      'authorization', 'apikey', 'api_key', 'token', 'password',
      'secret', 'cookie', 'cookies', 'localstorage', 'sessionstorage'
    ].includes(String(key || '').toLowerCase());
  }

  function sanitizeDebugValue(value, depth = 0, key = '') {
    if (isSensitiveDebugKey(key)) return '[redacted]';
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return sanitizeDebugText(value);
    if (value instanceof Error) {
      return {
        name: sanitizeDebugText(value.name || 'Error'),
        message: sanitizeDebugText(value.message || ''),
        stack: sanitizeDebugText(String(value.stack || '').split('\n').slice(0, 5).join('\n'))
      };
    }
    if (depth >= 4) return '[truncated-depth]';
    if (Array.isArray(value)) {
      return value.slice(0, 30).map(item => sanitizeDebugValue(item, depth + 1));
    }
    if (typeof value === 'object') {
      const out = {};
      Object.entries(value).slice(0, 50).forEach(([childKey, childValue]) => {
        out[childKey] = sanitizeDebugValue(childValue, depth + 1, childKey);
      });
      return out;
    }
    return sanitizeDebugText(value);
  }

  function byokQuotaKey(providerKey, familyKey = 'default') {
    return `${String(providerKey || '').toLowerCase()}:${String(familyKey || 'default').toLowerCase()}`;
  }

  function normalizeByokUsageEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const at = Number(entry.at);
    const requestCost = Math.max(0, Number(entry.requestCost ?? 1) || 0);
    const providerKey = String(entry.providerKey || '').toLowerCase();
    const familyKey = String(entry.familyKey || 'default');
    if (!Number.isFinite(at) || at <= 0 || !providerKey || !familyKey) return null;
    return {
      at,
      providerKey,
      familyKey,
      label: sanitizeDebugText(entry.label || familyKey),
      requestCost,
      outcome: sanitizeDebugText(entry.outcome || 'unknown')
    };
  }

  function loadByokUsageLedger(now = Date.now()) {
    try {
      const raw = GM_getValue(BYOK_USAGE_LEDGER_STORE, []);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const cutoff = now - DAY_MS;
      return (Array.isArray(parsed) ? parsed : [])
        .map(normalizeByokUsageEntry)
        .filter(entry => entry && entry.at >= cutoff);
    } catch (_) {
      return [];
    }
  }

  function saveByokUsageLedger(entries) {
    try {
      GM_setValue(BYOK_USAGE_LEDGER_STORE, entries.slice(-500));
    } catch (_) {}
  }

  function clearByokUsageLedger() {
    try { GM_deleteValue(BYOK_USAGE_LEDGER_STORE); }
    catch (_) {}
  }

  function recordByokUsage({ providerKey, familyKey = 'default', label = '', requestCost = 1, outcome = 'unknown' } = {}) {
    const entry = normalizeByokUsageEntry({
      at: Date.now(),
      providerKey,
      familyKey,
      label: label || familyKey,
      requestCost,
      outcome
    });
    if (!entry) return null;
    const ledger = loadByokUsageLedger(entry.at);
    ledger.push(entry);
    saveByokUsageLedger(ledger);
    return entry;
  }

  function getByokUsageSummary(providerKeys = [], now = Date.now()) {
    const wanted = new Set((Array.isArray(providerKeys) ? providerKeys : [providerKeys]).map(key => String(key || '').toLowerCase()).filter(Boolean));
    const summaries = {};
    for (const entry of loadByokUsageLedger(now)) {
      if (wanted.size && !wanted.has(entry.providerKey)) continue;
      const key = byokQuotaKey(entry.providerKey, entry.familyKey);
      const prev = summaries[key] || {
        providerKey: entry.providerKey,
        familyKey: entry.familyKey,
        label: entry.label || entry.familyKey,
        requests: 0,
        cost: 0,
        ok: 0,
        error: 0,
        lastAt: 0
      };
      prev.requests += 1;
      prev.cost += entry.requestCost;
      if (entry.outcome === 'ok') prev.ok += 1;
      else prev.error += 1;
      prev.lastAt = Math.max(prev.lastAt, entry.at);
      summaries[key] = prev;
    }
    return summaries;
  }

  function isQuotaExhaustionText(value) {
    const text = String(value || '').toLowerCase();
    if (!text) return false;
    return /(?:out of|exceed|exceeded|exhaust|quota|rate.?limit|too many requests|payment required|subscription)/i.test(text)
      && /(?:quota|rate.?limit|token|request|credit|limit|too many requests|exceed|exhaust)/i.test(text);
  }

  function isZeroQuotaValue(value) {
    if (value == null || value === '') return false;
    const n = Number(value);
    return Number.isFinite(n) && n <= 0;
  }

  function syncProviderQuotaCompat(state) {
    const local = getByokUsageSummary([state.providerKey])[byokQuotaKey(state.providerKey, state.familyKey)] || { requests: 0, cost: 0 };
    if (state.providerKey === 'apisports' || state.providerKey === 'apifootball') {
      latestApiSportsQuota[state.label] = {
        dayRemaining: state.dayRemaining ?? null,
        minRemaining: state.minRemaining ?? null,
        localRequests24h: local.requests,
        headersAbsent: !!state.headersAbsent,
        exhausted: !!state.exhausted,
        outOfTokensAt: state.outOfTokensAt || null,
        updatedAt: state.updatedAt || null
      };
    } else if (state.providerKey === 'pandascore') {
      latestPandaQuota = {
        remaining: state.hourlyRemaining ?? '',
        hourlyRemaining: state.hourlyRemaining ?? null,
        localRequests24h: local.requests,
        headersAbsent: !!state.headersAbsent,
        exhausted: !!state.exhausted,
        outOfTokensAt: state.outOfTokensAt || null,
        updatedAt: state.updatedAt || null
      };
    } else if (state.providerKey === 'theoddsapi') {
      latestOddsQuota = {
        remaining: state.remaining ?? '',
        used: state.used ?? '',
        last: state.last ?? '',
        localCredits24h: local.cost,
        headersAbsent: !!state.headersAbsent,
        exhausted: !!state.exhausted,
        outOfTokensAt: state.outOfTokensAt || null,
        updatedAt: state.updatedAt || null
      };
    }
  }

  function updateByokQuotaState({ providerKey, familyKey = 'default', label = '', headers = {}, status = null, errorText = '', requestCost = 1, outcome = 'unknown' } = {}) {
    const normalizedProvider = String(providerKey || '').toLowerCase();
    const normalizedFamily = String(familyKey || 'default');
    if (!normalizedProvider) return null;
    const key = byokQuotaKey(normalizedProvider, normalizedFamily);
    const previous = latestByokQuota[key] || {};
    const state = {
      ...previous,
      providerKey: normalizedProvider,
      familyKey: normalizedFamily,
      label: label || previous.label || normalizedFamily,
      updatedAt: Date.now(),
      lastStatus: status,
      lastOutcome: outcome,
      requestCost
    };
    const lowerHeaders = {};
    Object.entries(headers || {}).forEach(([hKey, hValue]) => { lowerHeaders[String(hKey).toLowerCase()] = hValue; });

    if (normalizedProvider === 'apisports' || normalizedProvider === 'apifootball') {
      if (lowerHeaders['x-ratelimit-requests-remaining'] != null) state.dayRemaining = String(lowerHeaders['x-ratelimit-requests-remaining']);
      if (lowerHeaders['x-ratelimit-remaining'] != null) state.minRemaining = String(lowerHeaders['x-ratelimit-remaining']);
      state.headersAbsent = lowerHeaders['x-ratelimit-requests-remaining'] == null && lowerHeaders['x-ratelimit-remaining'] == null;
    } else if (normalizedProvider === 'pandascore') {
      if (lowerHeaders['x-rate-limit-remaining'] != null) state.hourlyRemaining = String(lowerHeaders['x-rate-limit-remaining']);
      state.headersAbsent = lowerHeaders['x-rate-limit-remaining'] == null;
    } else if (normalizedProvider === 'theoddsapi') {
      if (lowerHeaders['x-requests-remaining'] != null) state.remaining = String(lowerHeaders['x-requests-remaining']);
      if (lowerHeaders['x-requests-used'] != null) state.used = String(lowerHeaders['x-requests-used']);
      if (lowerHeaders['x-requests-last'] != null) state.last = String(lowerHeaders['x-requests-last']);
      state.headersAbsent = lowerHeaders['x-requests-remaining'] == null && lowerHeaders['x-requests-used'] == null && lowerHeaders['x-requests-last'] == null;
    }

    const zeroRemaining = isZeroQuotaValue(state.dayRemaining) || isZeroQuotaValue(state.hourlyRemaining) || isZeroQuotaValue(state.remaining);
    const exhausted = Number(status) === 429 || zeroRemaining || isQuotaExhaustionText(errorText);
    if (exhausted) {
      state.exhausted = true;
      state.outOfTokensAt = Date.now();
    } else if (state.exhausted && outcome === 'ok') {
      state.exhausted = false;
      state.outOfTokensAt = null;
    }
    latestByokQuota[key] = state;
    syncProviderQuotaCompat(state);
    return state;
  }

  function isByokQuotaExhausted(providerKey, familyKey = 'default') {
    return !!latestByokQuota[byokQuotaKey(providerKey, familyKey)]?.exhausted;
  }

  function trackByokRequest(providerKey, familyKey, label, requestCost, fetchFn) {
    return () => fetchFn()
      .then(response => {
        recordByokUsage({ providerKey, familyKey, label, requestCost, outcome: 'ok' });
        updateByokQuotaState({
          providerKey,
          familyKey,
          label,
          headers: response?.headers || {},
          status: response?.status || 200,
          requestCost,
          outcome: 'ok'
        });
        return response;
      })
      .catch(error => {
        recordByokUsage({ providerKey, familyKey, label, requestCost, outcome: 'error' });
        updateByokQuotaState({
          providerKey,
          familyKey,
          label,
          headers: error?.headers || {},
          status: error?.status || null,
          errorText: `${error?.message || ''} ${error?.responseText || ''} ${JSON.stringify(error?.body || '')}`,
          requestCost,
          outcome: 'error'
        });
        throw error;
      });
  }

  function getByokQuotaDisplayRows(providerKeys = []) {
    const keys = (Array.isArray(providerKeys) ? providerKeys : [providerKeys]).map(key => String(key || '').toLowerCase()).filter(Boolean);
    const wanted = new Set(keys);
    const usage = getByokUsageSummary(keys);
    const rowsByKey = {};
    for (const [key, summary] of Object.entries(usage)) {
      rowsByKey[key] = { ...summary, state: latestByokQuota[key] || null };
    }
    for (const [key, state] of Object.entries(latestByokQuota)) {
      if (wanted.size && !wanted.has(state.providerKey)) continue;
      rowsByKey[key] = { ...(rowsByKey[key] || {}), state, label: state.label, providerKey: state.providerKey, familyKey: state.familyKey };
    }
    return Object.values(rowsByKey).sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
  }

  function formatByokLocalUsage(row, unitLabel) {
    const usage = row?.requests != null ? row : (getByokUsageSummary([row?.state?.providerKey || ''])[byokQuotaKey(row?.state?.providerKey, row?.state?.familyKey)] || {});
    const value = unitLabel === 'credit' ? (usage.cost || 0) : (usage.requests || 0);
    const unit = `${unitLabel}${value === 1 ? '' : 's'}`;
    return `Local 24h: ${value} ${unit}`;
  }

  function formatByokQuotaRow(row) {
    const state = row.state || {};
    const providerKey = state.providerKey || row.providerKey || '';
    const label = state.label || row.label || row.familyKey || 'Provider';
    const unit = providerKey === 'theoddsapi' ? 'credit' : 'request';
    if (state.exhausted) {
      return `${label}: Out of Tokens; ${formatByokLocalUsage(row, unit)}`;
    }
    const parts = [];
    if (state.dayRemaining != null) parts.push(`Day remaining: ${state.dayRemaining}`);
    if (state.minRemaining != null) parts.push(`Per-min remaining: ${state.minRemaining}`);
    if (state.hourlyRemaining != null) parts.push(`Hourly remaining: ${state.hourlyRemaining}`);
    if (state.remaining != null && state.remaining !== '') parts.push(`Remaining: ${state.remaining}`);
    if (state.used != null && state.used !== '') parts.push(`Used: ${state.used}`);
    if (state.last != null && state.last !== '') parts.push(`Last cost: ${state.last}`);
    if (!parts.length) parts.push(state.updatedAt ? 'Provider quota not reported' : 'Not pulled yet');
    parts.push(formatByokLocalUsage(row, unit));
    return `${label}: ${parts.join('; ')}`;
  }

  function renderByokQuotaBlock(providerKeys, emptyLabel = 'Not pulled yet') {
    const rows = getByokQuotaDisplayRows(providerKeys);
    if (!rows.length) return `<div class="tm-bookie-odds-quota">${escapeHtml(emptyLabel)}</div>`;
    return `<div class="tm-bookie-odds-quota">${rows.map(row => `<div>${escapeHtml(formatByokQuotaRow(row))}</div>`).join('')}</div>`;
  }

  function getByokUsageDebugSummary() {
    return sanitizeDebugValue(Object.fromEntries(Object.entries(getByokUsageSummary(['apisports', 'apifootball', 'pandascore', 'theoddsapi']))
      .map(([key, value]) => [key, value])));
  }

  function getByokQuotaDebugState() {
    return sanitizeDebugValue(Object.fromEntries(Object.entries(latestByokQuota)));
  }

  function getUrlHostPath(url) {
    try {
      const u = new URL(url);
      return { host: u.hostname, path: u.pathname };
    } catch (_) {
      return { host: 'unknown', path: '' };
    }
  }

  function updateNetworkStats(host, { status, kind, ms, ok }) {
    const now = Date.now();
    const prev = networkStats.get(host) || { okCount: 0, errCount: 0, lastOkAt: null, lastErrAt: null };
    networkStats.set(host, {
      lastStatus: status,
      lastKind: kind,
      lastMs: ms,
      lastOkAt: ok ? now : prev.lastOkAt,
      lastErrAt: ok ? prev.lastErrAt : now,
      okCount: prev.okCount + (ok ? 1 : 0),
      errCount: prev.errCount + (ok ? 0 : 1)
    });
  }

  function captureResponseShape(host, data) {
    try {
      let shape;
      if (Array.isArray(data)) {
        shape = { type: 'array', length: data.length,
          firstKeys: data.length > 0 && data[0] && typeof data[0] === 'object' ? Object.keys(data[0]).slice(0, 15) : [] };
      } else if (data && typeof data === 'object') {
        const topKeys = Object.keys(data).slice(0, 10);
        const nested = {};
        for (const k of topKeys) {
          const v = data[k];
          if (Array.isArray(v)) {
            nested[k] = `array:${v.length}` + (v.length > 0 && v[0] && typeof v[0] === 'object'
              ? `[${Object.keys(v[0]).slice(0, 8).join(',')}]` : '');
          } else if (v && typeof v === 'object') {
            nested[k] = Object.keys(v).slice(0, 8);
          } else {
            nested[k] = typeof v;
          }
        }
        shape = { type: 'object', keys: topKeys, nested };
      } else {
        shape = { type: typeof data };
      }
      if (uiSettings.enableDebugMode) {
        shape.valueSample = sanitizeDebugValue(Array.isArray(data) ? data[0] : data);
      }
      networkSamples.set(host, shape);
    } catch (_) {}
  }

  function recordDebugEvent(type, details = {}) {
    debugEventBuffer.push({
      at: new Date().toISOString(),
      type: sanitizeDebugText(type),
      details: sanitizeDebugValue(details)
    });
    while (debugEventBuffer.length > DEBUG_EVENT_LIMIT) debugEventBuffer.shift();
  }

  function safePageLocation() {
    try {
      return `${location.origin}${location.pathname}`;
    } catch (_) {
      return 'unknown';
    }
  }

  function cacheEntrySummary([key, entry]) {
    const data = entry?.data || {};
    return {
      key: sanitizeDebugText(key),
      expiresInMs: Math.max(0, Number(entry?.expiry || 0) - Date.now()),
      hasError: !!data.error,
      error: data.error ? sanitizeDebugText(data.error) : '',
      shape: Array.isArray(data) ? `array:${data.length}` : (data && typeof data === 'object' ? Object.keys(data).slice(0, 10) : typeof data)
    };
  }

  function debugMatchSummary(match) {
    const score = match?.score || {};
    return sanitizeDebugValue({
      name: match?.name || '',
      team1: match?.team1 || '',
      team2: match?.team2 || '',
      sport: match?.sport || '',
      sportKey: match?.sportKey || '',
      sportLabel: match?.sportLabel || '',
      league: match?.league || '',
      stage: match?.stage || '',
      competition: match?.competition || '',
      sectionType: match?.sectionType || '',
      status: match?.status || '',
      rawStatus: match?.rawStatus || '',
      startTimestamp: match?.startTimestamp || '',
      normalizedStartMs: normalizeTimestampMs(match?.startTimestamp) || 0,
      sourceKey: match?.sourceKey || '',
      sourceLabel: match?.sourceLabel || '',
      providerPriority: getProviderPriority(match || {}),
      score: {
        found: !!score.found,
        sourceKey: score.sourceKey || '',
        sourceLabel: score.sourceLabel || '',
        team1Score: score.team1Score ?? '',
        team2Score: score.team2Score ?? '',
        detail: score.detail || '',
        unmatched: !!score.unmatched,
        providersTried: score.providersTried || [],
        providerErrors: score.providerErrors || [],
        providerDiagnostics: score.providerDiagnostics || score.candidateDiagnostics || [],
        parserDiagnostics: score.parserDiagnostics || [],
        statusDiagnostics: score.statusDiagnostics || []
      }
    });
  }

  function elementRectMetrics(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
      return { top: null, bottom: null, width: null, height: null };
    }
    const rect = element.getBoundingClientRect();
    return {
      top: Number.isFinite(rect.top) ? Math.round(rect.top) : null,
      bottom: Number.isFinite(rect.bottom) ? Math.round(rect.bottom) : null,
      width: Number.isFinite(rect.width) ? Math.round(rect.width) : null,
      height: Number.isFinite(rect.height) ? Math.round(rect.height) : null
    };
  }

  function elementNumberMetric(element, key) {
    const value = Number(element?.[key]);
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  function getPanelScrollMetrics() {
    const panel = document.getElementById(PANEL_ID);
    const content = panel?.querySelector?.('.tm-bookie-content') || null;
    const settings = panel?.querySelector?.('.tm-bookie-settings-group') || panel?.querySelector?.('.tm-bookie-settings-body') || null;
    const contentRect = elementRectMetrics(content);
    const settingsRect = elementRectMetrics(settings);
    const settingsOffsetFromContentTop = content && settings && settingsRect.top != null && contentRect.top != null
      ? Math.round(settingsRect.top - contentRect.top + (Number(content.scrollTop) || 0))
      : elementNumberMetric(settings, 'offsetTop');
    return sanitizeDebugValue({
      panel: {
        present: !!panel,
        hidden: !!isPanelHidden,
        rect: elementRectMetrics(panel),
        clientHeight: elementNumberMetric(panel, 'clientHeight'),
        scrollHeight: elementNumberMetric(panel, 'scrollHeight')
      },
      content: {
        present: !!content,
        rect: contentRect,
        scrollTop: elementNumberMetric(content, 'scrollTop'),
        scrollHeight: elementNumberMetric(content, 'scrollHeight'),
        clientHeight: elementNumberMetric(content, 'clientHeight')
      },
      settings: {
        present: !!settings,
        rect: settingsRect,
        offsetTop: elementNumberMetric(settings, 'offsetTop'),
        offsetFromContentTop: settingsOffsetFromContentTop
      }
    });
  }

  function buildDebugReport() {
    const activeMatch = getActiveDetailsMatch();
    const report = sanitizeDebugValue({
      reportType: 'Live Scores Panel Debug Report',
      generatedAt: new Date().toISOString(),
      privacyNotice: 'Share only with the Live Scores Panel script developer. This report excludes passwords, Torn API keys, provider keys/tokens, cookies, Torn account data, bet amounts, bet selections, and raw Torn/provider responses.',
      script: {
        name: 'Torn Bookie Live Scores Panel',
        version: SCRIPT_VERSION,
        namespace: SCRIPT_NAMESPACE
      },
      browser: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: navigator.languages,
        platform: navigator.platform,
        cookieEnabled: navigator.cookieEnabled,
        onLine: navigator.onLine,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        devicePixelRatio: window.devicePixelRatio,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        page: safePageLocation()
      },
      settings: {
        theme: uiSettings.theme,
        layoutSide: uiSettings.layoutSide,
        detailsPosition: uiSettings.detailsPosition,
        scoreboardStyle: uiSettings.scoreboardStyle,
        refreshMode,
        showLive: uiSettings.showLive,
        showUpcoming: uiSettings.showUpcoming,
        showPoweredBy: uiSettings.showPoweredBy,
        showSourceInRows: uiSettings.showSourceInRows,
        showBetAmount: uiSettings.showBetAmount,
        hideUnmatchedGames: uiSettings.hideUnmatchedGames,
        showDetailsButtons: uiSettings.showDetailsButtons,
        showTeamStats: uiSettings.showTeamStats,
        showMarketConsensus: uiSettings.showMarketConsensus,
        showBettingCommentary: uiSettings.showBettingCommentary,
        showSourceList: uiSettings.showSourceList,
        enableDebugMode: uiSettings.enableDebugMode,
        enableExternalOdds: uiSettings.enableExternalOdds,
        enabledProviders: uiSettings.enabledProviders,
        enabledSports: uiSettings.enabledSports,
        oddsRegion: getOddsRegion(),
        oddsMarketsMode: getOddsMarketsMode(),
        hasOddsApiKey: hasOddsApiKey(),
        hasPandaScoreToken: hasPandaScoreToken(),
        hasApiSportsKey: hasApiSportsKey(),
        apiSportsQuota: latestApiSportsQuota,
        byokQuota: getByokQuotaDebugState(),
        byokLocalUsage24h: getByokUsageDebugSummary(),
        sofascoreTokenAgeMs: getSofascoreTokenTimestamp() ? Date.now() - getSofascoreTokenTimestamp() : null,
        sofascoreLastRefreshMs: (() => {
          try { return Number(GM_getValue(SOFASCORE_XRW_REFRESH_TS_STORE, 0)) || 0; }
          catch (_) { return 0; }
        })()
      },
      panelState: {
        lastUpdatedText,
        isPanelHidden,
        settingsCollapsed,
        copyToolsCollapsed,
        activeDetailsOpen: !!activeDetailsMatchKey,
        activeDetailsMatch: activeMatch ? debugMatchSummary(activeMatch) : null,
        liveCount: latestRenderableMatches.filter(match => match.sectionType === 'live').length,
        upcomingCount: latestRenderableMatches.filter(match => match.sectionType === 'upcoming').length,
        scrollMetrics: getPanelScrollMetrics()
      },
      matches: latestRenderableMatches.slice(0, 50).map(debugMatchSummary),
      caches: {
        provider: Array.from(providerCache.entries()).slice(-80).map(cacheEntrySummary),
        inFlight: Array.from(inFlightRequests.keys()).slice(-50).map(sanitizeDebugText),
        resolvedEvents: Array.from(resolvedEventCache.keys()).slice(-50).map(sanitizeDebugText),
        enrichment: Array.from(enrichmentCache.entries()).slice(-50).map(([key, enrichment]) => ({
          key: sanitizeDebugText(key),
          sections: {
            scoreFound: !!enrichment?.score?.found,
            teamStatsFound: !!enrichment?.teamStats?.found,
            commentaryGenerated: !!enrichment?.commentary?.generatedAt
          },
          providersTried: sanitizeDebugValue(enrichment?.providersTried || []),
          providerErrors: sanitizeDebugValue(enrichment?.providerErrors || [])
        }))
      },
      debugEvents: debugEventBuffer.slice()
    });
    // Network section gets its own depth-0 sanitization to avoid depth-4 truncation
    report.network = sanitizeDebugValue({
      byHost: Array.from(networkStats.entries()).map(([h, s]) => ({ host: h, ...s })),
      recent: debugEventBuffer.filter(e => e.type === 'network').slice(-60)
        .map(e => ({ at: e.at, type: e.type, ...(typeof e.details === 'object' && e.details !== null ? e.details : {}) })),
      samples: Object.fromEntries(Array.from(networkSamples.entries()))
    });
    return report;
  }

  // -- Settings persistence ------------------------------------------------------

  function deepMergeSettings(base, override) {
    const out = {
      ...base,
      ...(override && typeof override === 'object' ? override : {})
    };

    out.enabledSports = {
      ...base.enabledSports,
      ...(override?.enabledSports && typeof override.enabledSports === 'object'
        ? override.enabledSports : {})
    };

    out.enabledProviders = {
      ...base.enabledProviders,
      ...(override?.enabledProviders && typeof override.enabledProviders === 'object'
        ? override.enabledProviders : {})
    };

    return out;
  }

  function loadUiSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return deepMergeSettings(DEFAULT_UI_SETTINGS, {});
      return deepMergeSettings(DEFAULT_UI_SETTINGS, JSON.parse(raw));
    } catch (_) {
      return deepMergeSettings(DEFAULT_UI_SETTINGS, {});
    }
  }

  function saveUiSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(uiSettings));
    } catch (_) {}
  }

  function isRenderOnlySetting(key) {
    return [
      'theme',
      'layoutSide',
      'detailsPosition',
      'scoreboardStyle',
      'showSourceInRows',
      'showBetAmount',
      'showPoweredBy',
      'showCopyTools',
      'showDetailsButtons',
      'showTeamStats',
      'showMarketConsensus',
      'showExpectedOutcome',
      'showBettingCommentary',
      'showSourceList'
    ].includes(key);
  }

  function updateUiSetting(key, value) {
    if (key === 'enableExternalOdds') {
      uiSettings = {
        ...uiSettings,
        enableExternalOdds: !!value,
        enabledProviders: { ...uiSettings.enabledProviders, theoddsapi: !!value }
      };
    } else {
      uiSettings = { ...uiSettings, [key]: value };
    }

    if ((key === 'showDetailsButtons' && !value) || (key === 'detailsPosition' && value === 'off')) {
      clearActiveDetails();
      const det = document.getElementById(DETAILS_ID);
      if (det) det.remove();
    }

    saveUiSettings();
    if (isRenderOnlySetting(key)) rerenderPanel();
    else refreshPanel();
  }

  function updateSportEnabled(sportKey, enabled) {
    uiSettings = {
      ...uiSettings,
      enabledSports: { ...uiSettings.enabledSports, [sportKey]: !!enabled }
    };
    saveUiSettings();
    refreshPanel();
  }

  function updateProviderEnabled(providerKey, enabled) {
    uiSettings = {
      ...uiSettings,
      enabledProviders: { ...uiSettings.enabledProviders, [providerKey]: !!enabled }
    };
    saveUiSettings();
    refreshPanel();
  }

  function resetUiSettings() {
    uiSettings = deepMergeSettings(DEFAULT_UI_SETTINGS, {});
    collapsedSportGroups.live     = {};
    collapsedSportGroups.upcoming = {};
    copyToolsCollapsed  = false;
    settingsCollapsed   = false;
    clearActiveDetails();
    removePandaScoreToken();
    clearOddsAnalysisCache();
    saveUiSettings();
    refreshPanel();
  }

  // -- Debug logging -------------------------------------------------------------

  function debugLog(...args) {
    if (uiSettings.enableDebugMode) {
      recordDebugEvent('debug-log', { args });
      console.log('[Torn Bookie v2]', ...args);
    }
  }

  // -- Torn bookie data capture --------------------------------------------------

  function hasUsableBookieData(data) {
    const boxes = Array.isArray(data?.gameBoxesList) ? data.gameBoxesList : [];
    const yourBetsBox = boxes.find(box => box.alias === 'your-bets');
    return Array.isArray(yourBetsBox?.matches) && yourBetsBox.matches.length > 0;
  }

  function saveCapturedBookieData(data, source) {
    if (!hasUsableBookieData(data)) return;
    capturedBookieData = data;
    const yourBetsBox = data.gameBoxesList.find(box => box.alias === 'your-bets');
    console.log('[Torn Bookie Live Scores Panel] Captured bookie data from:', source);
    console.log('[Torn Bookie Live Scores Panel] Match count:', yourBetsBox.matches.length);
    clearTimeout(lastRenderTimer);
    lastRenderTimer = setTimeout(() => refreshPanel(), 250);
  }

  function tryParseBookieResponse(text, source) {
    if (!text || typeof text !== 'string') return;
    try {
      const data = JSON.parse(text);
      saveCapturedBookieData(data, source);
    } catch (_) {}
  }

  // -- XHR / fetch interception --------------------------------------------------

  if (isSofascoreContext()) {
    installSofascoreTokenCapture();
    return;
  }

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const originalFetch = pageWindow.fetch;
  pageWindow.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const rawUrl = args[0]?.url || args[0] || '';
      const url = String(rawUrl);
      if (url.includes('sid=bookieApi')) {
        response.clone().text().then(text => {
          tryParseBookieResponse(text, `page fetch: ${url}`);
        }).catch(() => {});
      }
    } catch (error) {
      recordDebugEvent('page-fetch-capture-failed', { message: error?.message || error });
      console.warn('[Torn Bookie Live Scores Panel] Page fetch capture failed:', error);
    }
    return response;
  };

  window.addEventListener('error', event => {
    recordDebugEvent('window-error', {
      message: event.message || '',
      source: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0,
      error: event.error || ''
    });
  });

  window.addEventListener('unhandledrejection', event => {
    recordDebugEvent('unhandled-rejection', {
      reason: event.reason || ''
    });
  });

  const originalOpen = pageWindow.XMLHttpRequest.prototype.open;
  const originalSend = pageWindow.XMLHttpRequest.prototype.send;

  pageWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__tmBookieUrl = String(url || '');
    return originalOpen.call(this, method, url, ...rest);
  };

  pageWindow.XMLHttpRequest.prototype.send = function (...args) {
    if (this.__tmBookieUrl && this.__tmBookieUrl.includes('sid=bookieApi')) {
      this.addEventListener('load', function () {
        try {
          tryParseBookieResponse(this.responseText, `page xhr: ${this.__tmBookieUrl}`);
        } catch (error) {
          recordDebugEvent('page-xhr-capture-failed', { message: error?.message || error });
        }
      });
    }
    return originalSend.apply(this, args);
  };

  // -- DOM ready helper ----------------------------------------------------------

  function whenBodyReady(callback) {
    if (document.body) { callback(); return; }
    const timer = setInterval(() => {
      if (document.body) { clearInterval(timer); callback(); }
    }, 50);
  }

  // -- GM fetch wrapper ----------------------------------------------------------

  function gmFetchJson(url, extraHeaders = {}) {
    const { host, path: urlPath } = getUrlHostPath(url);
    const startMs = Date.now();
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json, text/plain, */*', ...extraHeaders },
        timeout: 12000,
        onload: response => {
          const ms = Date.now() - startMs;
          const ok = response.status >= 200 && response.status < 300;
          const hdrs = parseResponseHeaders(response.responseHeaders);
          recordDebugEvent('network', { host, path: urlPath, status: response.status, ok, kind: 'http', ms, bytes: (response.responseText || '').length, contentType: hdrs['content-type'] || '' });
          updateNetworkStats(host, { status: response.status, kind: 'http', ms, ok });
          if (!ok) {
            reject(new Error(`Request failed ${response.status}: ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText));
          } catch (_) {
            resolve(response.responseText);
          }
        },
        onerror: () => {
          const ms = Date.now() - startMs;
          recordDebugEvent('network', { host, path: urlPath, status: 0, ok: false, kind: 'network', ms, bytes: 0, contentType: '' });
          updateNetworkStats(host, { status: 0, kind: 'network', ms, ok: false });
          reject(new Error(`Network error: ${url}`));
        },
        ontimeout: () => {
          const ms = Date.now() - startMs;
          recordDebugEvent('network', { host, path: urlPath, status: 0, ok: false, kind: 'timeout', ms, bytes: 0, contentType: '' });
          updateNetworkStats(host, { status: 0, kind: 'timeout', ms, ok: false });
          reject(new Error(`Timeout: ${url}`));
        }
      });
    });
  }

  function parseResponseHeaders(rawHeaders) {
    const headers = {};
    String(rawHeaders || '').split(/\r?\n/).forEach(line => {
      const idx = line.indexOf(':');
      if (idx <= 0) return;
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    return headers;
  }

  function gmFetchJsonWithMeta(url, extraHeaders = {}, safeLabel = 'request') {
    const { host, path: urlPath } = getUrlHostPath(url);
    const startMs = Date.now();
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: { Accept: 'application/json, text/plain, */*', ...extraHeaders },
        timeout: 12000,
        onload: response => {
          const headers = parseResponseHeaders(response.responseHeaders);
          const ms = Date.now() - startMs;
          const ok = response.status >= 200 && response.status < 300;
          recordDebugEvent('network', { host, path: urlPath, status: response.status, ok, kind: 'http', ms, bytes: (response.responseText || '').length, contentType: headers['content-type'] || '' });
          updateNetworkStats(host, { status: response.status, kind: 'http', ms, ok });
          if (!ok) {
            let errorBody = response.responseText || '';
            try { errorBody = JSON.parse(response.responseText); } catch (_) {}
            const error = new Error(`${safeLabel} failed with status ${response.status}`);
            error.status = response.status;
            error.headers = headers;
            error.body = errorBody;
            error.responseText = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody);
            reject(error);
            return;
          }
          let data;
          try {
            data = JSON.parse(response.responseText);
          } catch (_) {
            data = response.responseText;
          }
          captureResponseShape(host, data);
          resolve({ data, headers, status: response.status });
        },
        onerror: () => {
          const ms = Date.now() - startMs;
          recordDebugEvent('network', { host, path: urlPath, status: 0, ok: false, kind: 'network', ms, bytes: 0, contentType: '' });
          updateNetworkStats(host, { status: 0, kind: 'network', ms, ok: false });
          reject(new Error(`${safeLabel} network error`));
        },
        ontimeout: () => {
          const ms = Date.now() - startMs;
          recordDebugEvent('network', { host, path: urlPath, status: 0, ok: false, kind: 'timeout', ms, bytes: 0, contentType: '' });
          updateNetworkStats(host, { status: 0, kind: 'timeout', ms, ok: false });
          reject(new Error(`${safeLabel} timeout`));
        }
      });
    });
  }

  async function fetchBookieData() {
    if (capturedBookieData && hasUsableBookieData(capturedBookieData)) {
      return capturedBookieData;
    }
    throw new Error('Waiting for Torn Bookie data capture. Be sure you have selected YOUR BETS. Refresh the Bookie page if this persists.');
  }

  function getYourBetsMatches(data) {
    const boxes = Array.isArray(data?.gameBoxesList) ? data.gameBoxesList : [];
    const yourBetsBox = boxes.find(box => box.alias === 'your-bets');
    if (!yourBetsBox || !Array.isArray(yourBetsBox.matches)) return [];
    return yourBetsBox.matches;
  }

  // -- String utilities ----------------------------------------------------------

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseMult(value) {
    const m = String(value || '').match(/x([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/\./g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugify(value) {
    return normalizeName(value).replace(/\s+/g, '-');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return '$0';
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}b`;
    if (value >= 1_000_000)     return `$${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000)         return `$${(value / 1_000).toFixed(1)}k`;
    return `$${value.toLocaleString()}`;
  }

  function formatStartTime(timestamp) {
    const ms = normalizeTimestampMs(timestamp);
    const d = new Date(ms || NaN);
    if (Number.isNaN(d.getTime())) return 'Start time unknown';
    return d.toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  // -- Match key -----------------------------------------------------------------

  function makeMatchKey(match) {
    return [
      match.team1 || '',
      match.team2 || '',
      match.sport || '',
      match.competition || match.league || '',
      normalizeTimestampMs(match.startTimestamp) || match.startTimestamp || ''
    ].join('|').toLowerCase();
  }

  function findMatchByKey(key) {
    return latestRenderableMatches.find(m => makeMatchKey(m) === key) || null;
  }

  function getPinnedLiveMatchIndex(matchKey) {
    return pinnedLiveMatchKeys.indexOf(matchKey);
  }

  function isLiveMatchPinned(match) {
    if (!match || match.sectionType !== 'live') return false;
    const matchKey = makeMatchKey(match);
    return !!matchKey && getPinnedLiveMatchIndex(matchKey) !== -1;
  }

  function toggleLiveMatchPin(matchKey) {
    if (!matchKey) return null;
    const index = getPinnedLiveMatchIndex(matchKey);
    const match = findMatchByKey(matchKey);
    if (index === -1) {
      pinnedLiveMatchKeys.push(matchKey);
      return { pinned: true, match };
    }
    pinnedLiveMatchKeys.splice(index, 1);
    return { pinned: false, match };
  }

  function clearPinnedLiveMatches() {
    const count = pinnedLiveMatchKeys.length;
    pinnedLiveMatchKeys = [];
    return count;
  }

  function sortLiveMatchesForPins(matches) {
    return [...matches].sort((a, b) => {
      const aPin = getPinnedLiveMatchIndex(makeMatchKey(a));
      const bPin = getPinnedLiveMatchIndex(makeMatchKey(b));
      const aPinned = aPin !== -1;
      const bPinned = bPin !== -1;
      if (aPinned && bPinned) return aPin - bPin;
      if (aPinned) return -1;
      if (bPinned) return 1;
      return 0;
    });
  }

  function getActiveDetailsMatch() {
    if (!activeDetailsMatchKey) return null;
    if (activeDetailsFallbackMatch && makeMatchKey(activeDetailsFallbackMatch) === activeDetailsMatchKey) {
      return activeDetailsFallbackMatch;
    }
    return findMatchByKey(activeDetailsMatchKey);
  }

  function clearActiveDetails() {
    activeDetailsMatchKey = null;
    activeDetailsFallbackMatch = null;
  }

  function makeEnrichment(match) {
    const now = Date.now();
    const matchKey = makeMatchKey(match);
    const score = match?.score || {};
    return {
      matchKey,
      identity: {
        tornId: match?.tornId || '',
        name: match?.name || '',
        team1: match?.team1 || '',
        team2: match?.team2 || '',
        sport: match?.sport || '',
        sportKey: match?.sportKey || '',
        sportLabel: match?.sportLabel || '',
        league: match?.league || '',
        competition: match?.competition || match?.league || '',
        stage: match?.stage || '',
        sectionType: match?.sectionType || '',
        status: match?.status || '',
        rawStatus: match?.rawStatus || '',
        startTime: match?.startTime || '',
        startTimestamp: match?.startTimestamp || '',
        updatedAt: now
      },
      score: {
        found: !!score.found,
        sourceKey: score.sourceKey || '',
        sourceLabel: score.sourceLabel || '',
        team1Score: score.team1Score ?? '',
        team2Score: score.team2Score ?? '',
        detail: score.detail || '',
        venue: score.venue || '',
        sourceUrl: score.sourceUrl || '',
        updatedAt: score.found ? now : 0
      },
      teamStats: {
        found: false,
        teams: [],
        recentForm: [],
        standings: [],
        sourceKey: '',
        sourceLabel: '',
        updatedAt: 0
      },
      headToHead: {
        found: false,
        events: [],
        summary: '',
        sourceKey: '',
        sourceLabel: '',
        updatedAt: 0
      },
      expectation: {
        found: false,
        outcomes: [],
        method: '',
        generatedAt: 0,
        updatedAt: 0
      },
      commentary: {
        summary: [],
        supportingFactors: [],
        riskFactors: [],
        generatedAt: 0,
        updatedAt: 0
      },
      loadingSections: {},
      providersTried: [],
      providerErrors: []
    };
  }

  function syncEnrichmentFromMatch(enrichment, match) {
    if (!enrichment || !match) return enrichment;
    const latest = makeEnrichment(match);
    enrichment.matchKey = latest.matchKey;
    enrichment.identity = latest.identity;
    enrichment.score = latest.score;
    return enrichment;
  }

  function getEnrichment(match) {
    const matchKey = makeMatchKey(match);
    if (!enrichmentCache.has(matchKey)) {
      if (enrichmentCache.size >= 50) {
        enrichmentCache.delete(enrichmentCache.keys().next().value);
      }
      enrichmentCache.set(matchKey, makeEnrichment(match));
    }
    return syncEnrichmentFromMatch(enrichmentCache.get(matchKey), match);
  }

  function isFresh(section, ttl) {
    return !!(section && section.updatedAt && (Date.now() - section.updatedAt) < ttl);
  }

  // -- Date formatters -----------------------------------------------------------

  function dateForEspn(timestamp) {
    return formatProviderDate(getDateFormatterMs(timestamp), 'espn');
  }

  function dateForSofascore(timestamp) {
    return formatProviderDate(getDateFormatterMs(timestamp), 'iso');
  }

  function dateForLivescore(timestamp) {
    return formatProviderDate(getDateFormatterMs(timestamp), 'livescore');
  }

  function dateForIso(timestamp) {
    return formatProviderDate(getDateFormatterMs(timestamp), 'iso');
  }

  // -- Team name alias table -----------------------------------------------------

  const TEAM_ALIASES = {
    'athletics':                    ['oakland athletics', 'as'],
    'bosnia':                       ['bosnia and herzegovina', 'bosnia-herzegovina'],
    'korea republic':               ['south korea', 'korea'],
    'south korea':                  ['korea republic', 'korea'],
    'bc lions':                     ['british columbia lions'],
    'st george illawarra dragons':  ['st george dragons'],
    'new york red bulls':           ['red bulls'],
    'new england revolution':       ['revolution'],
    'los angeles galaxy':           ['la galaxy'],
    'cf montreal':                  ['montreal impact'],
    'inter miami':                  ['inter miami cf'],
    'ivory coast':                  ['cote d ivoire'],
    'cote d ivoire':                ['ivory coast'],
    'cloud9':                       ['c9'],
    'c9':                           ['cloud9'],
    'evil geniuses':                ['eg'],
    'eg':                           ['evil geniuses'],
    'faze clan':                    ['faze'],
    'faze':                         ['faze clan'],
    'fnatic':                       ['fnc'],
    'fnc':                          ['fnatic'],
    'g2 esports':                   ['g2'],
    'g2':                           ['g2 esports'],
    'gen g':                        ['geng', 'gen.g'],
    'geng':                         ['gen g', 'gen.g'],
    'natus vincere':                ['navi', 'na vi'],
    'navi':                         ['natus vincere'],
    'ninjas in pyjamas':            ['nip'],
    'nip':                          ['ninjas in pyjamas'],
    'team liquid':                  ['liquid'],
    'liquid':                       ['team liquid']
  };

  // -- Confidence-based team matching --------------------------------------------

  function calcTeamMatchScore(a, b) {
    if (!a || !b) return 0;
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb) return 0;
    if (na === nb) return 100;

    // Alias lookup
    const aliasesA = TEAM_ALIASES[na] || [];
    if (aliasesA.some(al => normalizeName(al) === nb)) return 95;
    const aliasesB = TEAM_ALIASES[nb] || [];
    if (aliasesB.some(al => normalizeName(al) === na)) return 95;

    // Conservative token-sequence containment. Raw character containment used to grant
    // 80 whenever a >=5-char name was a substring of a longer one ("mexico" in
    // "new mexico", "united" in "manchester united", "arsenal" in "arsenal reserves").
    // Now 80 is granted only when the shorter name's full token sequence appears
    // contiguously in the longer name AND every leftover token is a neutral club affix
    // (fc/cf/sc/club). A disqualifying qualifier ("new"/"reserves"/"b"/"ii"/"w"/...), a
    // substantive extra token ("manchester"), or a generic single-token name
    // ("united"/"city") falls through to the Jaccard path below, which scores these
    // under CONFIDENCE_THRESHOLD.
    const NEUTRAL_AFFIX_TOKENS = new Set(['fc', 'cf', 'sc', 'club']);
    const GENERIC_SINGLE_TOKENS = new Set(['united', 'city', 'town', 'athletic', 'sporting', 'racing', 'real']);
    const tokensA = na.split(' ').filter(Boolean);
    const tokensB = nb.split(' ').filter(Boolean);
    const [shortToks, longToks] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
    if (shortToks.length && !(shortToks.length === 1 && GENERIC_SINGLE_TOKENS.has(shortToks[0]))) {
      for (let start = 0; start + shortToks.length <= longToks.length; start++) {
        let contiguous = true;
        for (let j = 0; j < shortToks.length; j++) {
          if (longToks[start + j] !== shortToks[j]) { contiguous = false; break; }
        }
        if (!contiguous) continue;
        const leftover = longToks.filter((_, idx) => idx < start || idx >= start + shortToks.length);
        if (leftover.every(tok => NEUTRAL_AFFIX_TOKENS.has(tok))) return 80;
      }
    }

    // Word-overlap Jaccard score
    const jaccardQualifierTokens = new Set(['2', 'b', 'ii', 'w', 'new', 'reserve', 'reserves', 'women', 'u19', 'u21', 'u23', 'youth']);
    const jaccardToken = w => w.length > 2 || jaccardQualifierTokens.has(w);
    const wa = na.split(' ').filter(jaccardToken);
    const wb = nb.split(' ').filter(jaccardToken);
    if (!wa.length || !wb.length) return 0;
    const setA = new Set(wa);
    const setB = new Set(wb);
    const inter = [...setA].filter(w => setB.has(w)).length;
    const union = new Set([...wa, ...wb]).size;
    return union > 0 && inter > 0 ? Math.round((inter / union) * 70) : 0;
  }

  function calcIndividualNameMatchScore(a, b, sportKey = '') {
    if (sportKey !== 'tennis') return 0;
    const na = normalizeName(a);
    const nb = normalizeName(b);
    if (!na || !nb || na === nb) return 0;
    const tokensA = na.split(' ').filter(Boolean);
    const tokensB = nb.split(' ').filter(Boolean);
    const [shortToks, longToks] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
    if (shortToks.length < 2) return 0;

    const sameMultiset = (left, right) => {
      if (left.length !== right.length || left.length < 2) return false;
      const aSorted = [...left].sort();
      const bSorted = [...right].sort();
      return aSorted.every((token, idx) => token === bSorted[idx]);
    };
    const adjacentMergeVariants = tokens => {
      const variants = [tokens];
      for (let idx = 0; idx < tokens.length - 1; idx++) {
        variants.push([
          ...tokens.slice(0, idx),
          `${tokens[idx]}${tokens[idx + 1]}`,
          ...tokens.slice(idx + 2)
        ]);
      }
      return variants;
    };

    // Tennis providers often disagree on personal-name order or hyphen spacing:
    // Torn: "Soon-Woo Kwon"; provider: "Kwon Soonwoo" / "Kwon Soon-woo".
    // Keep this individual-sport-only so club/team containment stays conservative.
    for (const variantA of adjacentMergeVariants(tokensA)) {
      for (const variantB of adjacentMergeVariants(tokensB)) {
        if (sameMultiset(variantA, variantB)) return 92;
      }
    }

    if (longToks.length <= shortToks.length) return 0;
    for (let idx = 0; idx < shortToks.length; idx++) {
      if (longToks[idx] !== shortToks[idx]) return 0;
    }
    return 92;
  }

  function calcContestantMatchScore(a, b, sportKey = '') {
    return Math.max(
      calcTeamMatchScore(a, b),
      calcIndividualNameMatchScore(a, b, sportKey)
    );
  }

  function matchTeamPair(match, home, away, homeShort = '', awayShort = '') {
    const sportKey = match?.sportKey || match?.sportAlias || slugify(match?.sport || '');
    const t1h = Math.max(
      calcContestantMatchScore(match.team1, home, sportKey),
      homeShort ? calcContestantMatchScore(match.team1, homeShort, sportKey) : 0
    );
    const t1a = Math.max(
      calcContestantMatchScore(match.team1, away, sportKey),
      awayShort ? calcContestantMatchScore(match.team1, awayShort, sportKey) : 0
    );
    const t2h = Math.max(
      calcContestantMatchScore(match.team2, home, sportKey),
      homeShort ? calcContestantMatchScore(match.team2, homeShort, sportKey) : 0
    );
    const t2a = Math.max(
      calcContestantMatchScore(match.team2, away, sportKey),
      awayShort ? calcContestantMatchScore(match.team2, awayShort, sportKey) : 0
    );

    const scoreAsHome = Math.min(t1h, t2a); // team1=home, team2=away
    const scoreAsAway = Math.min(t1a, t2h); // team1=away, team2=home

    if (scoreAsHome >= scoreAsAway && scoreAsHome >= CONFIDENCE_THRESHOLD) {
      return { confidence: scoreAsHome, team1IsHome: true };
    }
    if (scoreAsAway > scoreAsHome && scoreAsAway >= CONFIDENCE_THRESHOLD) {
      return { confidence: scoreAsAway, team1IsHome: false };
    }
    return { confidence: 0, team1IsHome: true };
  }

  // DATE_MATCHING_CORE_START
  // -- Date matching core --------------------------------------------------------

  const LIVE_STATUS_VALUES = new Set(['live', 'inplay', 'inprogress', 'matchisinprogress', 'startsmatchisinprogress', 'running', 'started', 'playing', 'halftime', 'intermission']);
  const NON_LIVE_STATUS_VALUES = new Set(['scheduled', 'upcoming', 'notstarted', 'postponed', 'cancelled', 'canceled', 'finished', 'complete', 'completed', 'final']);
  const FINAL_STATUS_VALUES = new Set(['finished', 'complete', 'completed', 'final', 'ft', 'fulltime']);

  function isPlausibleTimestampMs(ms) {
    return Number.isFinite(ms) && ms >= MIN_DATE_MS && ms < MAX_DATE_MS;
  }

  function normalizeTimestampMs(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
        const explicitIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i;
        if (!explicitIso.test(trimmed)) return null;
        const parsed = Date.parse(trimmed);
        return isPlausibleTimestampMs(parsed) ? parsed : null;
      }
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (numeric >= 1e14 || numeric < 1e9) return null;

    const ms = numeric >= 1e9 && numeric < 1e11 ? numeric * 1000 : numeric;
    return isPlausibleTimestampMs(ms) ? ms : null;
  }

  function normalizeStatusToken(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  function getStatusTokens(match) {
    return [
      match?.status,
      match?.rawStatus,
      match?.statusText,
      match?.status_desc
    ].map(normalizeStatusToken).filter(Boolean);
  }

  function isActuallyLive(match) {
    const tokens = getStatusTokens(match);
    const statusSaysLive = tokens.some(token => LIVE_STATUS_VALUES.has(token));
    const statusSaysNotLive = tokens.some(token => NON_LIVE_STATUS_VALUES.has(token));
    const structuralLive = match?.sectionType === 'live' || match?.isLive === true;
    if (structuralLive && statusSaysNotLive) debugLog('Live-state contradiction; section wins', match?.name || '', tokens.join(','));
    if (!structuralLive && statusSaysLive && match?.sectionType === 'upcoming') debugLog('Live-state contradiction; status ignored for upcoming section', match?.name || '', tokens.join(','));
    if (structuralLive) return true;
    if (match?.sectionType === 'upcoming' && statusSaysLive) return false;
    return statusSaysLive && !statusSaysNotLive;
  }

  function isFinalStatus(value) {
    return FINAL_STATUS_VALUES.has(normalizeStatusToken(value));
  }

  function getMatchAnchorMs(match) {
    return normalizeTimestampMs(match?.startTimestamp);
  }

  function getLiveRecoveryMs(match) {
    return isActuallyLive(match) ? Date.now() : null;
  }

  function getDateFormatterMs(timestamp) {
    return normalizeTimestampMs(timestamp) || Number(timestamp) || Date.now();
  }

  function startOfUtcDay(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function endOfUtcDay(ms) {
    return startOfUtcDay(ms) + DAY_MS - 1;
  }

  function addUtcDays(ms, days) {
    return ms + (days * DAY_MS);
  }

  function formatProviderDate(ms, format) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    if (format === 'espn') return `${yyyy}${mm}${dd}`;
    if (format === 'livescore') return `${dd}/${mm}/${yyyy}`;
    if (format === 'cricinfo') return `${dd}-${mm}-${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  function buildLookupStep(anchorKind, anchorMs, offsetDays, reason, formatter = 'iso') {
    if (!isPlausibleTimestampMs(anchorMs)) return null;
    const lookupMs = addUtcDays(anchorMs, offsetDays || 0);
    return {
      anchorKind,
      anchorMs,
      offsetDays: offsetDays || 0,
      lookupMs,
      reason,
      providerDate: formatProviderDate(lookupMs, formatter),
      requestKey: formatProviderDate(lookupMs, formatter)
    };
  }

  function dedupeLookupPlan(plan, keyFn = step => step.requestKey) {
    const seen = new Set();
    return (plan || []).filter(step => {
      if (!step) return false;
      const key = keyFn(step);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function makeProviderResult() {
    return {
      candidates: [],
      queried: [],
      errors: [],
      parseFailures: [],
      eventCount: 0,
      resolution: null,
      candidateDiagnostics: [],
      statusDiagnostics: [],
      parserDiagnostics: [],
      diagnostics: []
    };
  }

  function mergeProviderResults(target, partial) {
    if (!partial) return target;
    target.candidates.push(...(partial.candidates || []));
    target.errors.push(...(partial.errors || []));
    target.parseFailures.push(...(partial.parseFailures || []));
    target.candidateDiagnostics.push(...(partial.candidateDiagnostics || []));
    target.statusDiagnostics.push(...(partial.statusDiagnostics || []));
    target.parserDiagnostics.push(...(partial.parserDiagnostics || []));
    target.eventCount += Number(partial.eventCount || 0);
    target.diagnostics.push(...(partial.diagnostics || []));
    return target;
  }

  function makeCandidateDedupKey(candidate) {
    if (candidate.providerEventId) return `${candidate.providerKey}:id:${candidate.providerEventId}`;
    const home = normalizeName(candidate.homeName);
    const away = normalizeName(candidate.awayName);
    const start = candidate.normalizedStartMs || '';
    return `${candidate.providerKey}:tuple:${home}:${away}:${start}`;
  }

  function dedupeCandidates(candidates) {
    const byKey = new Map();
    for (const candidate of candidates || []) {
      const key = makeCandidateDedupKey(candidate);
      const discovery = {
        queriedDate: candidate.queriedDate || '',
        offsetDays: candidate.offsetDays ?? 0,
        anchorKind: candidate.anchorKind || ''
      };
      if (!byKey.has(key)) {
        byKey.set(key, { ...candidate, discoveredBy: [discovery] });
      } else {
        byKey.get(key).discoveredBy.push(discovery);
      }
    }
    return [...byKey.values()];
  }

  function scoreTeamOrientation(match, candidate) {
    const homeShort = candidate.homeShortName || candidate.homeCode || '';
    const awayShort = candidate.awayShortName || candidate.awayCode || '';
    const sportKey = match?.sportKey || match?.sportAlias || slugify(match?.sport || '');
    const t1h = Math.max(calcContestantMatchScore(match.team1, candidate.homeName, sportKey), homeShort ? calcContestantMatchScore(match.team1, homeShort, sportKey) : 0);
    const t1a = Math.max(calcContestantMatchScore(match.team1, candidate.awayName, sportKey), awayShort ? calcContestantMatchScore(match.team1, awayShort, sportKey) : 0);
    const t2h = Math.max(calcContestantMatchScore(match.team2, candidate.homeName, sportKey), homeShort ? calcContestantMatchScore(match.team2, homeShort, sportKey) : 0);
    const t2a = Math.max(calcContestantMatchScore(match.team2, candidate.awayName, sportKey), awayShort ? calcContestantMatchScore(match.team2, awayShort, sportKey) : 0);
    const asHome = Math.min(t1h, t2a);
    const asAway = Math.min(t1a, t2h);
    return asHome >= asAway
      ? { confidence: asHome, team1IsHome: true, team1Score: t1h, team2Score: t2a }
      : { confidence: asAway, team1IsHome: false, team1Score: t1a, team2Score: t2h };
  }

  function isGlobalDateSport(match) {
    return ['cricket', 'tennis', 'rugby', 'rugby-league', 'badminton'].includes(match?.sportKey);
  }

  function isCricketMatch(match) {
    return match?.sportKey === 'cricket' || normalizeName(match?.sport) === 'cricket';
  }

  function hasCompetitionCompatibility(match, candidate) {
    const a = normalizeName(match?.competition || match?.league || match?.stage);
    const b = normalizeName(candidate?.competitionName || '');
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
  }

  function isCandidateTimeCompatible(match, candidate, anchorMs, live, nowMs) {
    const start = candidate.normalizedStartMs;
    if (!start) return !anchorMs && !live ? false : true;
    if (live && isCricketMatch(match)) {
      if (start > nowMs + HOUR_MS) return false;
      if (nowMs - start > 6 * DAY_MS) return false;
      if (anchorMs && start - anchorMs > 12 * HOUR_MS) return false;
      return true;
    }
    if (anchorMs) {
      const tolerance = live ? 36 * HOUR_MS : 12 * HOUR_MS;
      return Math.abs(start - anchorMs) <= tolerance;
    }
    if (live) return Math.abs(start - nowMs) <= 36 * HOUR_MS;
    return false;
  }

  function scoreCandidate(match, candidate, options = {}) {
    const anchorMs = getMatchAnchorMs(match);
    const live = isActuallyLive(match);
    const nowMs = options.nowMs || Date.now();
    const team = scoreTeamOrientation(match, candidate);
    if (team.team1Score < CONFIDENCE_THRESHOLD || team.team2Score < CONFIDENCE_THRESHOLD) {
      return { accepted: false, reason: 'team-confidence', score: team.confidence, team };
    }

    const competitionOk = hasCompetitionCompatibility(match, candidate);
    const timeOk = isCandidateTimeCompatible(match, candidate, anchorMs, live, nowMs);
    if (!timeOk) {
      const invalidUpcomingHighConfidence = !anchorMs && !live && team.confidence >= 95 && competitionOk;
      if (!invalidUpcomingHighConfidence) {
        return { accepted: false, reason: 'time-window', score: team.confidence, team };
      }
    }

    const candidateLive = LIVE_STATUS_VALUES.has(normalizeStatusToken(candidate.status));
    const candidateFinal = isFinalStatus(candidate.status);
    let statusScore = 0;
    if (live && candidateLive) statusScore += 6;
    if (!live && !candidateLive && !candidateFinal) statusScore += 4;
    if (live && candidateFinal) statusScore -= 12;
    if (!live && candidateFinal) statusScore -= 15;

    const primaryBonus = candidate.anchorKind === 'torn-start' && Math.abs(candidate.offsetDays || 0) === 0 ? 10 : 0;
    const fallbackPenalty = Math.min(12, Math.abs(candidate.offsetDays || 0) * 3);
    const timeBonus = timeOk && candidate.normalizedStartMs ? 10 : 0;
    const competitionBonus = competitionOk ? 6 : 0;
    const score = team.confidence + primaryBonus + timeBonus + competitionBonus + statusScore - fallbackPenalty;
    const accepted = score >= 75;
    return { accepted, reason: accepted ? 'accepted' : 'overall-score', score, team };
  }

  function selectBestCandidate(match, candidates, options = {}) {
    const scored = (candidates || []).map(candidate => ({
      candidate,
      scored: scoreCandidate(match, candidate, options)
    })).filter(item => item.scored.accepted);

    scored.sort((a, b) => b.scored.score - a.scored.score);
    if (!scored.length) return { resolution: null, ambiguous: false, scored };
    if (scored.length > 1 && scored[0].scored.score - scored[1].scored.score < 10) {
      return { resolution: null, ambiguous: true, scored };
    }
    return {
      resolution: {
        candidate: scored[0].candidate,
        pair: {
          confidence: scored[0].scored.team.confidence,
          team1IsHome: scored[0].scored.team.team1IsHome
        },
        score: scored[0].scored.score
      },
      ambiguous: false,
      scored
    };
  }

  function isCandidateScheduledStatus(status) {
    const token = normalizeStatusToken(status);
    return ['scheduled', 'upcoming', 'notstarted', 'pre', 'pregame', 'statusscheduled'].includes(token);
  }

  function candidateDiagnostic(match, candidate, scored) {
    const start = candidate?.normalizedStartMs ? new Date(candidate.normalizedStartMs).toISOString() : '';
    return sanitizeDebugValue({
      providerKey: candidate?.providerKey || '',
      providerEventId: candidate?.providerEventId || '',
      teams: `${candidate?.homeName || ''} v ${candidate?.awayName || ''}`,
      start,
      tournament: candidate?.competitionName || '',
      status: candidate?.status || '',
      confidence: scored?.team?.confidence || 0,
      team1Score: scored?.team?.team1Score || 0,
      team2Score: scored?.team?.team2Score || 0,
      overallScore: scored?.score || 0,
      reason: scored?.reason || 'unknown',
      target: `${match?.team1 || ''} v ${match?.team2 || ''}`
    });
  }

  function topCandidateDiagnostics(match, candidates, options = {}) {
    return (candidates || [])
      .map(candidate => ({
        candidate,
        scored: scoreCandidate(match, candidate, options)
      }))
      .sort((a, b) => (b.scored.score || 0) - (a.scored.score || 0))
      .slice(0, 5)
      .map(item => candidateDiagnostic(match, item.candidate, item.scored));
  }

  function recordStatusDiagnostics(match, providerKey, resolution, result) {
    const candidate = resolution?.candidate;
    if (!candidate || !isActuallyLive(match) || !isCandidateScheduledStatus(candidate.status)) return;
    const diagnostic = sanitizeDebugValue({
      match: match?.name || `${match?.team1 || ''} v ${match?.team2 || ''}`,
      providerKey,
      providerEventId: candidate.providerEventId || '',
      providerStatus: candidate.status || '',
      providerStart: candidate.normalizedStartMs ? new Date(candidate.normalizedStartMs).toISOString() : '',
      tornStatus: match?.status || '',
      tornRawStatus: match?.rawStatus || '',
      sectionType: match?.sectionType || ''
    });
    result.statusDiagnostics.push(diagnostic);
    recordDebugEvent('score-status-contradiction', diagnostic);
  }

  function resolvedEventCacheKey(providerKey, match) {
    return `resolved-event:${providerKey}:${makeMatchKey(match)}`;
  }

  function putResolvedEvent(providerKey, match, resolution) {
    const candidate = resolution?.candidate;
    if (!candidate?.providerEventId) return;
    resolvedEventCache.set(resolvedEventCacheKey(providerKey, match), {
      providerEventId: candidate.providerEventId,
      matchedAt: Date.now(),
      providerStartMs: candidate.normalizedStartMs || 0,
      homeName: candidate.homeName || '',
      awayName: candidate.awayName || '',
      queriedDate: candidate.queriedDate || '',
      anchorKind: candidate.anchorKind || '',
      confidence: resolution.pair?.confidence || 0,
      status: candidate.status || '',
      team1: normalizeName(match?.team1),
      team2: normalizeName(match?.team2),
      matchStartMs: getMatchAnchorMs(match) || 0
    });
  }

  function getResolvedEvent(providerKey, match) {
    const cached = resolvedEventCache.get(resolvedEventCacheKey(providerKey, match));
    if (!cached) return null;
    const ttl = isFinalStatus(cached.status) ? TTL_RESOLVED_EVENT_FINAL : TTL_RESOLVED_EVENT_ACTIVE;
    if (Date.now() - cached.matchedAt > ttl) {
      resolvedEventCache.delete(resolvedEventCacheKey(providerKey, match));
      return null;
    }
    if (cached.team1 !== normalizeName(match?.team1) || cached.team2 !== normalizeName(match?.team2)) return null;
    const anchor = getMatchAnchorMs(match) || 0;
    if (anchor && cached.matchStartMs && Math.abs(anchor - cached.matchStartMs) > HOUR_MS) return null;
    return cached;
  }

  async function resolveProviderMatch(match, providerKey, plan, fetchStep, options = {}) {
    const result = makeProviderResult();
    const limitedPlan = plan.slice(0, options.maxRequests || plan.length);
    if (!limitedPlan.length) {
      result.diagnostics.push('No valid lookup anchor');
      return result;
    }

    const cachedResolution = getResolvedEvent(providerKey, match);
    for (const step of limitedPlan) {
      result.queried.push(step);
      if (step.diagnostic) result.diagnostics.push(step.diagnostic);
      let partial = null;
      try {
        partial = await fetchStep(step, cachedResolution);
      } catch (error) {
        partial = { errors: [error?.message || String(error)], candidates: [], eventCount: 0 };
      }
      mergeProviderResults(result, partial);
      const stepCandidates = dedupeCandidates(partial?.candidates || []);
      if (cachedResolution?.providerEventId) {
        const cachedCandidate = stepCandidates.find(candidate => String(candidate.providerEventId) === String(cachedResolution.providerEventId));
        if (cachedCandidate) {
          const cachedScore = scoreCandidate(match, cachedCandidate, options);
          if (cachedScore.accepted) {
            result.resolution = {
              candidate: cachedCandidate,
              pair: {
                confidence: cachedScore.team.confidence,
                team1IsHome: cachedScore.team.team1IsHome
              },
              score: cachedScore.score
            };
            putResolvedEvent(providerKey, match, result.resolution);
            recordStatusDiagnostics(match, providerKey, result.resolution, result);
            return result;
          }
        }
      }
      const best = selectBestCandidate(match, stepCandidates, options);
      if (best.resolution) {
        result.resolution = best.resolution;
        putResolvedEvent(providerKey, match, best.resolution);
        recordStatusDiagnostics(match, providerKey, best.resolution, result);
        return result;
      }
      if (best.ambiguous) result.ambiguous = true;
      if (stepCandidates.length) {
        const diagnostics = topCandidateDiagnostics(match, stepCandidates, options);
        result.candidateDiagnostics.push(...diagnostics);
        recordDebugEvent('provider-candidate-diagnostics', {
          match: match?.name || '',
          providerKey,
          queriedDate: step.providerDate || '',
          candidates: diagnostics
        });
      }
    }
    return result;
  }

  function summarizeProviderResult(label, result) {
    if (result?.resolution) return `${label}: matched`;
    const isApiSportsLabel = /^API-(?:Football|Sports)/.test(label);
    const dates = [...new Set((result?.queried || []).map(q => q.providerDate || q.requestKey || q.reason).filter(Boolean))];
    const dateText = dates.length ? ` for ${dates.join(', ')}` : '';
    if ((result?.diagnostics || []).includes('No valid lookup anchor')) return `${label}: invalid Torn start timestamp`;
    if ((result?.diagnostics || []).some(d => d.includes('used current live recovery'))) {
      return `${label}: ${result.diagnostics.find(d => d.includes('used current live recovery'))}${dateText}`;
    }
    if (result?.ambiguous) return `${label}: ambiguous match`;
    if ((result?.errors || []).length && !(result?.eventCount || 0) && !(result?.parseFailures || []).length) {
      const firstErr = String(result.errors[0] || '');
      const statusMatch = firstErr.match(/failed (\d+)/);
      const statusHint = statusMatch ? ` [HTTP ${statusMatch[1]}]` : '';
      const hasProviderErrorDiagnostic = (result?.parserDiagnostics || [])
        .some(diagnostic => Array.isArray(diagnostic?.errorsKeys) && diagnostic.errorsKeys.length > 0);
      if (isApiSportsLabel && hasProviderErrorDiagnostic) return `${label}: provider API/quota error${dateText}`;
      return `${label}: fetch error${dateText}${statusHint}`;
    }
    if ((result?.parseFailures || []).length && !(result?.eventCount || 0)) {
      const failures = result.parseFailures.map(value => String(value || '').toLowerCase());
      if (isApiSportsLabel && failures.some(value => value.includes('manual mode') || value.includes('not requested'))) {
        return `${label}: manual mode cache-only; not requested${dateText}`;
      }
      if (isApiSportsLabel && failures.some(value => value.includes('no fixtures') || value.includes('no games') || value.includes('no matches in response'))) {
        return `${label}: empty provider response${dateText}`;
      }
      if (isApiSportsLabel && failures.some(value => value.includes('array missing') || value.includes('events missing') || value.includes('stages missing') || value.includes('expected'))) {
        return `${label}: parser shape failure${dateText}`;
      }
      return `${label}: parser failed${dateText}`;
    }
    if (!(result?.eventCount || 0)) return `${label}: no events${dateText}`;
    const top = (result?.candidateDiagnostics || [])[0];
    const topText = top ? `; top candidate ${top.teams} (${top.reason}, confidence ${top.confidence})` : '';
    return `${label}: events found${dateText}; no confident team match${topText}`;
  }

  // -- Provider response cache ---------------------------------------------------

  async function fetchWithCache(cacheKey, fetchFn, successTtl = TTL_SUCCESS, errorTtl = TTL_ERROR) {
    const now = Date.now();
    if (providerCache.size > 200) {
      for (const [key, value] of providerCache) {
        if (value.expiry < now) providerCache.delete(key);
      }
    }
    const cached = providerCache.get(cacheKey);
    if (cached && now < cached.expiry) {
      recordDebugEvent('provider-cache-hit', { cacheKey });
      debugLog(`Cache hit: ${cacheKey}`);
      return cached.data;
    }

    if (inFlightRequests.has(cacheKey)) {
      recordDebugEvent('provider-request-coalesced', { cacheKey });
      debugLog(`Coalescing in-flight: ${cacheKey}`);
      return inFlightRequests.get(cacheKey);
    }

    const promise = fetchFn()
      .then(data => {
        providerCache.set(cacheKey, { data, expiry: Date.now() + successTtl });
        inFlightRequests.delete(cacheKey);
        return data;
      })
      .catch(err => {
        recordDebugEvent('provider-fetch-error', { cacheKey, message: err?.message || err });
        debugLog(`fetch error [${cacheKey}]: ${err.message}`);
        const errData = { error: err.message, events: [], Stages: [] };
        providerCache.set(cacheKey, { data: errData, expiry: Date.now() + errorTtl });
        inFlightRequests.delete(cacheKey);
        return errData;
      });

    inFlightRequests.set(cacheKey, promise);
    return promise;
  }

  // Read-only peek at the provider cache — returns the cached payload if still
  // fresh, else null. Used by the api-sports manual-only refresh gate so a cached
  // board can keep rendering at 0 token cost without triggering a refetch.
  function peekProviderCache(cacheKey) {
    const c = providerCache.get(cacheKey);
    return c && Date.now() < c.expiry ? c.data : null;
  }

  // -- Sport helpers -------------------------------------------------------------

  function detectEsportsGameKey(match) {
    const fields = [
      match?.sport,
      match?.stage,
      match?.competition,
      match?.league,
      match?.name,
      match?.alias,
      match?.icon
    ];
    const normalizedValues = fields
      .map(value => normalizeName(value))
      .filter(Boolean);
    const slugValues = fields
      .map(value => slugify(value))
      .filter(Boolean);

    for (const [gameKey, aliases] of ESPORTS_GAME_PATTERNS) {
      for (const alias of aliases) {
        const normalizedAlias = normalizeName(alias);
        const slugAlias = slugify(alias);
        const canUseContains = normalizedAlias.length > 3 && slugAlias.length > 3;
        if (normalizedValues.some(value => value === normalizedAlias || (canUseContains && value.includes(normalizedAlias)))) return gameKey;
        if (slugValues.some(value => value === slugAlias || (canUseContains && value.includes(slugAlias)))) return gameKey;
      }
    }
    return '';
  }

  function isExcludedSport(match) {
    if (detectEsportsGameKey(match)) return false;
    const sportKey = normalizeName(match.sport);
    const aliasKey = String(match.alias || match.icon || '').toLowerCase().trim();
    return EXCLUDED_SPORT_KEYS.has(sportKey) || EXCLUDED_ALIASES.has(aliasKey);
  }

  function getSportLabel(match) {
    const esportsGameKey = detectEsportsGameKey(match);
    if (esportsGameKey) return ESPORTS_GAME_LABELS[esportsGameKey] || 'Esports';
    const sport = String(match.sport || '').trim();
    if (sport === 'Football') return 'Football';
    if (sport === 'Mixed Martial arts') return 'MMA / UFC';
    if (sport === 'Motorsports') return 'Formula 1';
    return sport || 'Other';
  }

  function getSportKey(match) {
    const esportsGameKey = detectEsportsGameKey(match);
    if (esportsGameKey) return esportsGameKey;
    return slugify(getSportLabel(match));
  }

  function isSportEnabledForDisplay(match) {
    return uiSettings.enabledSports?.[getSportKey(match)] !== false;
  }

  function chooseScoreSource(match) {
    const sport = normalizeName(match.sport);
    const stage = normalizeName(match.stage);
    const competition = normalizeName(match.competition);
    const alias = String(match.alias || '').toLowerCase().trim();

    if (detectEsportsGameKey(match)) return 'pandascore';

    if (sport === 'baseball' && stage.includes('mlb')) return 'espn';
    if (sport === 'football' && getEspnKey(match)) return 'espn';
    if (sport === 'hockey' && (stage.includes('ahl') || competition.includes('ahl'))) return 'espn';
    if (sport === 'hockey' && (stage.includes('nhl') || competition.includes('nhl'))) return 'espn';
    if (sport === 'basketball' && (stage.includes('wnba') || competition.includes('wnba'))) return 'espn';
    if (sport === 'basketball' && (stage.includes('nba') || competition.includes('nba'))) return 'espn';
    if (sport === 'american football' && (stage.includes('nfl') || competition.includes('nfl'))) return 'espn';
    if (sport === 'australian football' && getEspnKey(match)) return 'espn';
    if (sport === 'rugby league' && getEspnKey(match)) return 'espn';

    if (sport === 'tennis' || alias === 'tennis') return 'espn';
    if (sport === 'cricket' || alias === 'cricket') return 'espncricinfo';
    if (sport === 'rugby' || alias === 'rugby') return 'apisports';

    if (
      sport === 'badminton' ||
      alias === 'badminton'
    ) return 'sofascore';

    return 'torn';
  }

  function getEspnKey(match) {
    const sport = normalizeName(match.sport);
    const stage = normalizeName(match.stage);
    const competition = normalizeName(match.competition);
    const league = normalizeName(match.league);
    const soccerLeague = `${stage} ${competition} ${league}`.trim();
    const isEnglishPremierLeague =
      soccerLeague.includes('english premier') ||
      /\beng(?:land|lish)?\.?1\b/.test(soccerLeague) ||
      (soccerLeague.includes('premier league') && /\b(england|english|eng\.?1)\b/.test(soccerLeague));

    if (sport === 'baseball' && stage.includes('mlb')) return 'baseball_mlb';
    if (sport === 'football' && (soccerLeague.includes('club world cup') || soccerLeague.includes('club world championship'))) return 'soccer_fifa_cwc';
    if (sport === 'football' && (soccerLeague.includes('world cup') || soccerLeague.includes('world championship'))) return 'soccer_world';
    if (sport === 'football' && (soccerLeague.includes('a-league') || soccerLeague.includes('a league'))) return 'soccer_aus_aleague';
    if (sport === 'football' && soccerLeague.includes('eliteserien')) return 'soccer_nor_elite';
    // C2-FIX: a few high-value ESPN soccer leagues; everything else falls through to
    // api-football. Brazil's Série A is checked before the generic Italian "serie a".
    if (sport === 'football' && (soccerLeague.includes('uefa champions') || soccerLeague.includes('champions league'))) return 'soccer_uefa_champions';
    if (sport === 'football' && isEnglishPremierLeague) return 'soccer_eng_pl';
    if (sport === 'football' && (soccerLeague.includes('la liga') || soccerLeague.includes('laliga'))) return 'soccer_esp_laliga';
    if (sport === 'football' && soccerLeague.includes('bundesliga')) return 'soccer_ger_bundesliga';
    if (sport === 'football' && soccerLeague.includes('ligue 1')) return 'soccer_fra_ligue1';
    if (sport === 'football' && soccerLeague.includes('serie a') && (soccerLeague.includes('brazil') || soccerLeague.includes('brasil'))) return 'soccer_bra_seriea';
    if (sport === 'football' && soccerLeague.includes('serie a')) return 'soccer_ita_seriea';
    if (sport === 'football' && (soccerLeague.includes('major league soccer') || (/\bmls\b/.test(soccerLeague) && !soccerLeague.includes('next pro')))) return 'soccer_usa_mls';
    if (sport === 'football' && soccerLeague.includes('liga mx')) return 'soccer_mex_ligamx';
    if (sport === 'hockey' && (stage.includes('ahl') || competition.includes('ahl'))) return 'hockey_ahl';
    if (sport === 'hockey' && (stage.includes('nhl') || competition.includes('nhl'))) return 'hockey_nhl';
    if (sport === 'basketball' && (stage.includes('wnba') || competition.includes('wnba'))) return 'basketball_wnba';
    if (sport === 'basketball' && (stage.includes('nba') || competition.includes('nba'))) return 'basketball_nba';
    if (sport === 'american football' && (stage.includes('nfl') || competition.includes('nfl'))) return 'football_nfl';
    if (sport === 'australian football') return 'australian_football_afl';
    if (sport === 'rugby league') return 'rugby_league_nrl';
    if (sport === 'tennis') return 'tennis_all';
    return null;
  }

  function isProviderSupportedForSport(providerKey, match) {
    if (providerKey === 'espn')        return !!getEspnKey(match);
    if (providerKey === 'espncricinfo') return match.sportKey === 'cricket' || normalizeName(match.sport) === 'cricket';
    if (providerKey === 'apifootball')
      return match.sportKey === 'football' && hasApiSportsKey()
        && uiSettings.enabledProviders?.apisports !== false;
    if (providerKey === 'apisports')   return !!APISPORTS_ENDPOINTS[match.sportKey] && hasApiSportsKey();
    if (providerKey === 'sofascore')   return !!SOFASCORE_SPORT_SLUGS[match.sportKey];
    if (providerKey === 'livescore')   return !!LIVESCORE_SPORT_SLUGS[match.sportKey];
    if (providerKey === 'thescore')    return !!THESCORE_SPORT_SLUGS[match.sportKey];
    if (providerKey === 'bbcsport')   return !!BBC_SPORT_PATHS[match.sportKey];
    if (providerKey === 'pandascore')  return !!PANDASCORE_GAME_SLUGS[match.sportKey];
    return false;
  }

  function getProviderPriority(match) {
    const primary = match.sourceKey;
    const tennisFallbackFirst = match?.sportKey === 'tennis';
    const all = tennisFallbackFirst
      ? ['sofascore', 'espn', 'espncricinfo', 'apifootball', 'apisports', 'livescore', 'thescore', 'bbcsport', 'pandascore']
      : PROVIDER_PRIORITY.score;
    const ordered = [];
    if (!tennisFallbackFirst && primary !== 'torn' && all.includes(primary)) ordered.push(primary);
    for (const p of all) { if (!ordered.includes(p)) ordered.push(p); }
    return ordered.filter(p =>
      uiSettings.enabledProviders?.[p] !== false &&
      isProviderSupportedForSport(p, match)
    );
  }

  const PROVIDER_PRIORITY = {
    score: ['pandascore', 'espn', 'espncricinfo', 'sofascore', 'apifootball', 'apisports', 'livescore', 'thescore', 'bbcsport'],
    stats: {
      hockey_nhl: ['nhl', 'sofascore'],
      american_football: ['espn-reuse', 'thescore', 'sofascore'],
      default: ['espn-reuse', 'sofascore']
    },
    odds: ['theoddsapi'],
    injuries: []
  };

  function isNhlMatch(match) {
    const sport = normalizeName(match?.sport);
    const stage = normalizeName(match?.stage);
    const competition = normalizeName(match?.competition || match?.league);
    return sport === 'hockey' && (stage.includes('nhl') || competition.includes('nhl'));
  }

  function getStatsProviderPriority(match) {
    if (isNhlMatch(match)) return PROVIDER_PRIORITY.stats.hockey_nhl;
    if (match?.sportKey === 'american-football') return PROVIDER_PRIORITY.stats.american_football;
    return PROVIDER_PRIORITY.stats.default;
  }

  function markProviderTried(enrichment, providerKey) {
    if (!enrichment.providersTried.includes(providerKey)) {
      enrichment.providersTried.push(providerKey);
    }
  }

  function markProviderError(enrichment, providerKey, message) {
    enrichment.providerErrors.push({
      providerKey,
      message: String(message || 'Unknown error'),
      at: Date.now()
    });
  }

  // -- Bet data extraction -------------------------------------------------------

  function normalizeBetMatch(match, sectionType) {
    const bets = Array.isArray(match.bets) ? match.bets : [];
    const totalAmount = bets.reduce((sum, bet) => sum + (Number(bet.amount) || 0), 0);
    const sourceKey = chooseScoreSource(match);
    const sportKey  = getSportKey(match);

    return {
      tornId:       match.ID,
      sport:        match.sport || '',
      sportLabel:   getSportLabel(match),
      sportKey,
      sportAlias:   sportKey,
      league:       match.competition || match.stage || '',
      stage:        match.stage || '',
      competition:  match.competition || '',
      name:         match.name || 'Unknown match',
      rawStatus:    String(match.status || '').toLowerCase(),
      status:       match.status_desc || match.status || '',
      sectionType,
      startTime:    match.startTime || '',
      startTimestamp: match.startTimestamp,
      team1:        match.ep?.[0]?.name || '',
      team2:        match.ep?.[1]?.name || '',
      amount:       totalAmount,
      sourceKey,
      sourceLabel:  SOURCE_LABELS[sourceKey] || sourceKey,
      bets
    };
  }

  function extractLiveBets(data) {
    return getYourBetsMatches(data)
      .filter(match => {
        const status = String(match.status || '').toLowerCase();
        return status === 'inprogress' && !isExcludedSport(match) && isSportEnabledForDisplay(match);
      })
      .map(match => normalizeBetMatch(match, 'live'));
  }

  function extractUpcomingBets(data) {
    return getYourBetsMatches(data)
      .filter(match => {
        const status = String(match.status || '').toLowerCase();
        return status === 'notstarted' && !isExcludedSport(match) && isSportEnabledForDisplay(match);
      })
      .map(match => normalizeBetMatch(match, 'upcoming'))
      .sort((a, b) => (getMatchAnchorMs(a) || 0) - (getMatchAnchorMs(b) || 0));
  }

  function groupMatchesBySport(matches) {
    const groups = new Map();
    for (const match of matches) {
      if (!groups.has(match.sportKey)) {
        groups.set(match.sportKey, { sportKey: match.sportKey, sportLabel: match.sportLabel, matches: [] });
      }
      groups.get(match.sportKey).matches.push(match);
    }
    return [...groups.values()].sort((a, b) => a.sportLabel.localeCompare(b.sportLabel));
  }

  function getActiveSources(liveMatches, upcomingMatches) {
    const sourceKeys = new Set();
    for (const match of [...liveMatches, ...upcomingMatches]) {
      const foundSource = match.score?.found ? match.score.sourceKey : '';
      if (foundSource && foundSource !== 'torn' && uiSettings.enabledProviders?.[foundSource] !== false) {
        sourceKeys.add(foundSource);
        continue;
      }
      getProviderPriority(match).forEach(sourceKey => {
        if (sourceKey && sourceKey !== 'torn') sourceKeys.add(sourceKey);
      });
    }
    return [...sourceKeys];
  }

  function getInitialHeaderSources() {
    const enabledSources = PROVIDER_PRIORITY.score.filter(sourceKey =>
      uiSettings.enabledProviders?.[sourceKey] !== false
    );
    return enabledSources;
  }

  // -- Per-provider async find functions -----------------------------------------

  function buildOffsetPlan(anchorKind, anchorMs, offsets, reason, formatter) {
    return offsets.map(offsetDays => buildLookupStep(anchorKind, anchorMs, offsetDays, reason, formatter)).filter(Boolean);
  }

  function buildSofascoreLookupPlan(match) {
    const anchorMs = getMatchAnchorMs(match);
    const live = isActuallyLive(match);
    const currentMs = getLiveRecoveryMs(match);
    let plan = [];
    if (live && (match?.sportKey === 'tennis' || match?.sportKey === 'football')) {
      plan.push({
        anchorKind: 'sofascore-live',
        anchorMs: currentMs || anchorMs || Date.now(),
        offsetDays: 0,
        reason: 'live-board',
        providerDate: 'live',
        requestKey: 'live'
      });
    }
    if (anchorMs) plan.push(...buildOffsetPlan('torn-start', anchorMs, [0], 'primary-anchor', 'iso'));
    if (!anchorMs && live && currentMs) {
      const recovery = buildOffsetPlan('current-live', currentMs, [0], 'live-recovery', 'iso');
      recovery.forEach(step => { step.diagnostic = 'Torn start timestamp invalid; used current live recovery'; });
      plan.push(...recovery);
    }
    if (live && isCricketMatch(match)) {
      if (currentMs) plan.push(...buildOffsetPlan('current-live', currentMs, [0], 'multi-day-current', 'iso'));
      if (anchorMs) plan.push(...buildOffsetPlan('torn-start', anchorMs, [-1, 1], 'multi-day-anchor-fallback', 'iso'));
      if (currentMs) plan.push(...buildOffsetPlan('current-live', currentMs, [-1, -2, -3, -4, -5], 'multi-day-current-fallback', 'iso'));
      return dedupeLookupPlan(plan).slice(0, 7);
    }
    if (anchorMs) plan.push(...buildOffsetPlan('torn-start', anchorMs, [-1, 1], 'adjacent-fallback', 'iso'));
    if (live && currentMs) plan.push(...buildOffsetPlan('current-live', currentMs, [0], 'live-current-fallback', 'iso'));
    return dedupeLookupPlan(plan).slice(0, 3);
  }

  function buildDateBucketPlan(match, formatter, options = {}) {
    const anchorMs = getMatchAnchorMs(match);
    const live = isActuallyLive(match);
    const currentMs = getLiveRecoveryMs(match);
    let plan = [];
    if (anchorMs) plan.push(...buildOffsetPlan('torn-start', anchorMs, [0], 'primary-anchor', formatter));
    if (!anchorMs && live && currentMs) {
      const recovery = buildOffsetPlan('current-live', currentMs, [0], 'live-recovery', formatter);
      recovery.forEach(step => { step.diagnostic = 'Torn start timestamp invalid; used current live recovery'; });
      plan.push(...recovery);
    }
    const shouldWiden = live || (options.globalUpcoming && isGlobalDateSport(match));
    if (shouldWiden) {
      const baseKind = anchorMs ? 'torn-start' : 'current-live';
      const baseMs = anchorMs || currentMs;
      if (baseMs) plan.push(...buildOffsetPlan(baseKind, baseMs, [-1, 1], 'adjacent-fallback', formatter));
    }
    return dedupeLookupPlan(plan).slice(0, options.maxRequests || 3);
  }

  function buildTheScorePlan(match) {
    // TheScore filtering quirks (verified against api.thescore.com):
    //  - start_at.* params  -> HTTP 500 (start_at is null in league feeds)
    //  - game_date.gte/.lte -> HTTP 500
    //  - game_date.gt/.lt   -> HTTP 200 (only the strict operators work)
    // Use a ±1-day game_date window around the anchor. The unfiltered feed is ~376 KB
    // and fails over GM_xmlhttpRequest; a windowed query is ~17 KB and reliable.
    const anchorMs = getMatchAnchorMs(match);
    const live = isActuallyLive(match);
    const currentMs = getLiveRecoveryMs(match);
    const baseMs = anchorMs || (live ? currentMs : null);
    if (!baseMs) return [];
    const anchorKind = anchorMs ? 'torn-start' : 'current-live';
    const startMs = startOfUtcDay(addUtcDays(baseMs, -1));
    const endMs = endOfUtcDay(addUtcDays(baseMs, 1));
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    return [{
      anchorKind,
      anchorMs: baseMs,
      offsetDays: 0,
      reason: live ? 'live-window' : 'primary-window',
      providerDate: `${formatProviderDate(startMs, 'iso')}..${formatProviderDate(endMs, 'iso')}`,
      requestKey: `${startIso}|${endIso}`,
      startIso,
      endIso
    }];
  }

  function buildPandaScorePlan(match) {
    const anchorMs = getMatchAnchorMs(match);
    const live = isActuallyLive(match);
    const currentMs = getLiveRecoveryMs(match);
    const baseMs = anchorMs || (live ? currentMs : null);
    if (!baseMs) return [];
    const anchorKind = anchorMs ? 'torn-start' : 'current-live';
    const offsets = live ? [-1, 0, 1] : [0, -1, 1];
    return dedupeLookupPlan(offsets.map(offsetDays => {
      const lookupMs = addUtcDays(baseMs, offsetDays);
      const startMs = startOfUtcDay(lookupMs);
      const endMs = endOfUtcDay(lookupMs);
      const startIso = new Date(startMs).toISOString();
      const endIso = new Date(endMs).toISOString();
      return {
        anchorKind,
        anchorMs: baseMs,
        offsetDays,
        lookupMs,
        reason: offsetDays === 0 ? 'primary-window' : 'adjacent-fallback',
        providerDate: `${formatProviderDate(startMs, 'iso')}..${formatProviderDate(endMs, 'iso')}`,
        requestKey: `${startIso}|${endIso}`,
        startIso,
        endIso
      };
    })).slice(0, 3);
  }

  function buildNhlScorePlan(match) {
    const anchorMs = getMatchAnchorMs(match);
    const live = isActuallyLive(match);
    const currentMs = getLiveRecoveryMs(match);
    let plan = [];
    if (anchorMs) plan.push(...buildOffsetPlan('torn-start', anchorMs, [0], 'primary-anchor', 'iso'));
    if (!anchorMs && live && currentMs) {
      const recovery = buildOffsetPlan('current-live', currentMs, [0], 'live-recovery', 'iso');
      recovery.forEach(step => { step.diagnostic = 'Torn start timestamp invalid; used current live recovery'; });
      plan.push(...recovery);
    }
    if (live) {
      plan.push({
        anchorKind: 'nhl-now',
        anchorMs: currentMs || anchorMs || Date.now(),
        offsetDays: 0,
        reason: 'nhl-now',
        providerDate: 'now',
        requestKey: 'now'
      });
      if (anchorMs) plan.push(...buildOffsetPlan('torn-start', anchorMs, [-1, 1], 'adjacent-fallback', 'iso'));
    }
    return dedupeLookupPlan(plan).slice(0, 4);
  }

  function candidateWithStep(providerKey, step, event, fields) {
    return {
      event,
      providerKey,
      providerEventId: fields.providerEventId || '',
      queriedDate: step.providerDate || '',
      offsetDays: step.offsetDays || 0,
      anchorKind: step.anchorKind || '',
      normalizedStartMs: normalizeTimestampMs(fields.startMs ?? fields.startTime ?? '') || 0,
      homeName: fields.homeName || '',
      awayName: fields.awayName || '',
      homeShortName: fields.homeShortName || '',
      awayShortName: fields.awayShortName || '',
      homeCode: fields.homeCode || '',
      awayCode: fields.awayCode || '',
      status: fields.status || '',
      competitionName: fields.competitionName || '',
      raw: event
    };
  }

  function scoreFromResolution(result, sourceKey, sourceLabel, scoreMapper) {
    if (!result?.resolution) {
      return {
        found: false,
        detail: summarizeProviderResult(sourceLabel, result),
        candidateDiagnostics: result?.candidateDiagnostics || [],
        statusDiagnostics: result?.statusDiagnostics || [],
        parserDiagnostics: result?.parserDiagnostics || [],
        unmatched: true
      };
    }
    const candidate = result.resolution.candidate;
    const pair = result.resolution.pair;
    const mapped = scoreMapper(candidate, pair);
    return {
      found: true,
      sourceKey,
      sourceLabel,
      team1Score: mapped.team1Score,
      team2Score: mapped.team2Score,
      detail: mapped.detail || candidate.status || '',
      venue: mapped.venue || '',
      rawEvent: candidate.raw,
      providerEventId: candidate.providerEventId,
      providerStartMs: candidate.normalizedStartMs,
      queriedDate: candidate.queriedDate,
      anchorKind: candidate.anchorKind,
      confidence: pair.confidence,
      sourceUrl: buildScoreSourceUrl(sourceKey, candidate, mapped),
      candidateDiagnostics: result.candidateDiagnostics || [],
      statusDiagnostics: result.statusDiagnostics || [],
      parserDiagnostics: result.parserDiagnostics || [],
      unmatched: false
    };
  }

  // DATE_MATCHING_CORE_END

  function parseLivescoreStartMs(ev) {
    const raw = String(ev?.Esd || ev?.Epsd || ev?.startTime || '').trim();
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (!m) return 0;
    const yyyy = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const dd = Number(m[3]);
    const hh = Number(m[4] || 0);
    const mi = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    const ms = Date.UTC(yyyy, mm, dd, hh, mi, ss);
    return isPlausibleTimestampMs(ms) ? ms : 0;
  }

  // SofaScore's Varnish WAF returns HTTP 403 to API requests that don't look like
  // they came from its own web app. GM_xmlhttpRequest may override Origin/Referer
  // (forbidden in page fetch), so we send the same browser-origin headers the
  // LiveScore/TheScore paths rely on. Without these every SofaScore call 403s.
  function sofascoreHeaders() {
    return {
      'Accept': 'application/json',
      'Origin': 'https://www.sofascore.com',
      'Referer': 'https://www.sofascore.com/',
      'x-requested-with': getSofascoreToken(),
      'sec-fetch-site': 'same-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    };
  }

  async function resolveSofascoreMatch(match, slug, ttl = TTL_SUCCESS) {
    const plan = buildSofascoreLookupPlan(match);
    return resolveProviderMatch(match, 'sofascore', plan, async step => {
      const dateStr = step.providerDate;
      const isLiveBoard = dateStr === 'live';
      const cacheKey = isLiveBoard
        ? `sofascore:${slug}:live`
        : `sofascore:${slug}:${dateStr}`;
      const url = isLiveBoard
        ? `https://www.sofascore.com/api/v1/sport/${slug}/events/live`
        : `https://www.sofascore.com/api/v1/sport/${slug}/scheduled-events/${dateStr}`;
      const board = await fetchWithCache(
        cacheKey,
        () => gmFetchJson(url, sofascoreHeaders()),
        ttl,
        TTL_ERROR
      );
      if (board?.error) {
        const queued = isSofascoreTokenRejection(board) ? refreshSofascoreToken() : false;
        recordDebugEvent('provider-fetch-meta', {
          provider: 'sofascore',
          date: dateStr,
          status: board.error,
          tokenAgeMs: getSofascoreTokenTimestamp() ? Date.now() - getSofascoreTokenTimestamp() : null,
          tokenRefreshQueued: queued
        });
        return { errors: [board.error], candidates: [], eventCount: 0 };
      }
      if (!Array.isArray(board?.events)) {
        const queued = refreshSofascoreToken();
        recordDebugEvent('provider-fetch-meta', {
          provider: 'sofascore',
          date: dateStr,
          status: 'empty events',
          tokenAgeMs: getSofascoreTokenTimestamp() ? Date.now() - getSofascoreTokenTimestamp() : null,
          tokenRefreshQueued: queued
        });
        return { parseFailures: ['SofaScore events missing'], candidates: [], eventCount: 0 };
      }
      return {
        eventCount: board.events.length,
        candidates: board.events.map(ev => candidateWithStep('sofascore', step, ev, {
          providerEventId: ev.id || ev.customId || '',
          startMs: ev.startTimestamp ? Number(ev.startTimestamp) * 1000 : 0,
          homeName: ev.homeTeam?.name || '',
          awayName: ev.awayTeam?.name || '',
          homeShortName: ev.homeTeam?.shortName || '',
          awayShortName: ev.awayTeam?.shortName || '',
          homeCode: ev.homeTeam?.nameCode || '',
          awayCode: ev.awayTeam?.nameCode || '',
          status: ev.status?.description || ev.status?.type || '',
          competitionName: ev.tournament?.name || ev.season?.name || ''
        }))
      };
    }, { maxRequests: plan.length });
  }

  async function _findEspn(match) {
    const espnKey = getEspnKey(match);
    if (!espnKey) return { found: false, detail: 'ESPN: sport not mapped', unmatched: true };
    if (espnKey === 'tennis_all') return _findEspnTennis(match);

    const baseUrl = ESPN_ENDPOINTS[espnKey];
    if (!baseUrl) return { found: false, detail: 'ESPN: no endpoint', unmatched: true };

    const live = isActuallyLive(match);
    // For upcoming matches, also query the prior UTC day: US sports schedule by Eastern
    // time but Torn timestamps are UTC, so an 8 PM ET game starts on the next UTC day and
    // ESPN's date-based scoreboard won't return it without the offset -1 step.
    const plan = live
      ? buildDateBucketPlan(match, 'espn', { maxRequests: 3 })
      : dedupeLookupPlan([
          buildLookupStep('torn-start', getMatchAnchorMs(match), 0, 'primary-anchor', 'espn'),
          buildLookupStep('torn-start', getMatchAnchorMs(match), -1, 'tz-buffer', 'espn')
        ].filter(Boolean));
    const result = await resolveProviderMatch(match, 'espn', plan, async step => {
      const dateStr = step.providerDate;
      const board = await fetchWithCache(`espn:${espnKey}:${dateStr}`, () => gmFetchJson(`${baseUrl}?dates=${dateStr}`));
      if (board?.error) return { errors: [board.error], candidates: [], eventCount: 0 };
      if (!Array.isArray(board?.events)) return { parseFailures: ['ESPN events missing'], candidates: [], eventCount: 0 };
      return {
        eventCount: board.events.length,
        candidates: board.events.map(event => {
          const competition = event.competitions?.[0] || {};
          const competitors = competition.competitors || [];
          const teams = competitors.map(c => ({
            name: c.team?.displayName || c.team?.name || '',
            shortName: c.team?.shortDisplayName || '',
            abbr: c.team?.abbreviation || '',
            score: c.score ?? '',
            homeAway: c.homeAway || ''
          }));
          const home = teams.find(t => t.homeAway === 'home') || teams[0] || {};
          const away = teams.find(t => t.homeAway === 'away') || teams[1] || {};
          return candidateWithStep('espn', step, event, {
            providerEventId: event.id || event.uid || '',
            startTime: event.date || competition.date || '',
            homeName: home.name,
            awayName: away.name,
            homeShortName: home.shortName,
            awayShortName: away.shortName,
            homeCode: home.abbr,
            awayCode: away.abbr,
            status: competition.status?.type?.shortDetail || event.status?.type?.shortDetail || competition.status?.type?.name || '',
            competitionName: competition.name || event.name || ''
          });
        })
      };
    });

    return scoreFromResolution(result, 'espn', 'ESPN', (candidate, pair) => {
      const competition = candidate.raw.competitions?.[0] || {};
      const competitors = competition.competitors || [];
      const teams = competitors.map(c => ({ score: c.score ?? '', homeAway: c.homeAway || '' }));
      const home = teams.find(t => t.homeAway === 'home') || teams[0] || {};
      const away = teams.find(t => t.homeAway === 'away') || teams[1] || {};
      return {
        team1Score: pair.team1IsHome ? home.score : away.score,
        team2Score: pair.team1IsHome ? away.score : home.score,
        detail: competition.status?.type?.shortDetail || competition.status?.type?.detail || candidate.raw.status?.type?.shortDetail || '',
        venue: competition.venue?.fullName || competition.venue?.address?.city || '',
        sourceUrl: buildEspnSourceUrl(candidate, espnKey)
      };
    });
  }

  function espnTennisCompetitorsOf(eventOrCompetition) {
    return eventOrCompetition?.competitors || eventOrCompetition?.competitions?.[0]?.competitors || [];
  }

  function collectEspnTennisCompetitions(board) {
    const entries = [];
    const addEntry = (competition, context = {}) => {
      const competitors = espnTennisCompetitorsOf(competition);
      if (!Array.isArray(competitors) || competitors.length < 2) return;
      entries.push({
        competition,
        tournamentName: context.tournamentName || competition?.name || '',
        groupingName: context.groupingName || ''
      });
    };

    for (const event of Array.isArray(board?.events) ? board.events : []) {
      // Older verified shape: each top-level event is one match.
      addEntry(event, { tournamentName: event?.name || '' });

      // Current ESPN tennis shape: top-level events are tournaments, and matches
      // live under events[].groupings[].competitions[].
      for (const grouping of Array.isArray(event?.groupings) ? event.groupings : []) {
        const groupingName = grouping?.grouping?.displayName || grouping?.grouping?.name || grouping?.name || '';
        for (const competition of Array.isArray(grouping?.competitions) ? grouping.competitions : []) {
          addEntry(competition, { tournamentName: event?.name || '', groupingName });
        }
      }

      // Defensive fallback for any future ESPN variant with event.competitions[]
      // as the match list rather than a single wrapper competition.
      for (const competition of Array.isArray(event?.competitions) ? event.competitions : []) {
        addEntry(competition, { tournamentName: event?.name || '' });
      }
    }
    return entries;
  }

  function espnTennisParserDiagnostic(board, parsedMatchCount = 0) {
    let groupingCount = 0;
    let groupingCompetitionCount = 0;
    let directCompetitionCount = 0;
    for (const event of Array.isArray(board?.events) ? board.events : []) {
      if (Array.isArray(event?.competitions)) directCompetitionCount += event.competitions.length;
      if (!Array.isArray(event?.groupings)) continue;
      groupingCount += event.groupings.length;
      for (const grouping of event.groupings) {
        if (Array.isArray(grouping?.competitions)) groupingCompetitionCount += grouping.competitions.length;
      }
    }
    return sanitizeDebugValue({
      provider: 'espn',
      parser: 'tennis',
      topLevelKeys: board && typeof board === 'object' ? Object.keys(board).slice(0, 12) : [],
      topEventCount: Array.isArray(board?.events) ? board.events.length : 0,
      directCompetitionCount,
      groupingCount,
      groupingCompetitionCount,
      parsedMatchCount
    });
  }

  async function _findEspnTennis(match) {
    const live = isActuallyLive(match);
    const plan = live
      ? buildDateBucketPlan(match, 'espn', { maxRequests: 3 })
      : dedupeLookupPlan([
          buildLookupStep('torn-start', getMatchAnchorMs(match), 0, 'primary-anchor', 'espn'),
          buildLookupStep('torn-start', getMatchAnchorMs(match), -1, 'tz-buffer', 'espn')
        ].filter(Boolean));

    const result = await resolveProviderMatch(match, 'espn', plan, async step => {
      const dateStr = step.providerDate;
      const year = dateStr.slice(0, 4);
      const dateBoard = await fetchWithCache(
        `espn:tennis_all:all:${dateStr}`,
        () => gmFetchJson(`${ESPN_ENDPOINTS.tennis_all}?dates=${dateStr}`)
      );
      const dateBoardUsable = !dateBoard?.error
        && Array.isArray(dateBoard?.events)
        && collectEspnTennisCompetitions(dateBoard).length > 0;
      const boards = dateBoardUsable
        ? [dateBoard]
        : [
            dateBoard,
            // Fallback for older ESPN behavior where per-tournament IDs were
            // needed to populate the tennis/all scoreboard.
            ...(await Promise.all(
              TENNIS_LEAGUE_IDS.map(id =>
                fetchWithCache(
                  `espn:tennis_all:${id}-${year}:${dateStr}`,
                  () => gmFetchJson(
                    `${ESPN_ENDPOINTS.tennis_all}?leagueId=${id}&eventId=${id}-${year}&dates=${dateStr}`
                  )
                )
              )
            ))
          ];
      const candidates = [];
      const errors = [];
      const parseFailures = [];
      const parserDiagnostics = [];
      let eventCount = 0;
      for (const board of boards) {
        if (board?.error) { errors.push(board.error); continue; }
        if (!Array.isArray(board?.events)) {
          parseFailures.push('ESPN tennis: events missing');
          parserDiagnostics.push(espnTennisParserDiagnostic(board, 0));
          continue;
        }
        const entries = collectEspnTennisCompetitions(board);
        if (!entries.length && board.events.length) {
          parseFailures.push('ESPN tennis: no match competitions parsed');
          parserDiagnostics.push(espnTennisParserDiagnostic(board, 0));
        }
        for (const entry of entries) {
          const event = entry.competition;
          const competitors = espnTennisCompetitorsOf(event);
          const p1 = competitors[0] || {};
          const p2 = competitors[1] || {};
          eventCount++;
          const competitionName = [entry.tournamentName, entry.groupingName].filter(Boolean).join(' ');
          candidates.push(candidateWithStep('espn', step, event, {
            providerEventId: event.id || event.uid || '',
            startTime: event.date || event.startDate || '',
            homeName: p1.athlete?.displayName || p1.athlete?.fullName || p1.athlete?.shortName || '',
            awayName: p2.athlete?.displayName || p2.athlete?.fullName || p2.athlete?.shortName || '',
            homeShortName: p1.athlete?.shortName || '',
            awayShortName: p2.athlete?.shortName || '',
            status: event.status?.type?.shortDetail || event.status?.type?.name || '',
            competitionName: competitionName || event.name || ''
          }));
        }
      }
      return {
        eventCount,
        candidates,
        ...(errors.length ? { errors } : {}),
        ...(parseFailures.length ? { parseFailures } : {}),
        ...(parserDiagnostics.length ? { parserDiagnostics } : {})
      };
    });

    return scoreFromResolution(result, 'espn', 'ESPN', (candidate, pair) => {
      const event = candidate.raw;
      const competitors = espnTennisCompetitorsOf(event);
      const p1 = competitors[0] || {};
      const p2 = competitors[1] || {};
      const p1Score = Array.isArray(p1.linescores)
        ? p1.linescores.map(ls => ls.displayValue ?? ls.value ?? '').filter(v => v !== '').join(' ')
        : String(p1.score ?? '');
      const p2Score = Array.isArray(p2.linescores)
        ? p2.linescores.map(ls => ls.displayValue ?? ls.value ?? '').filter(v => v !== '').join(' ')
        : String(p2.score ?? '');
      return {
        team1Score: pair.team1IsHome ? p1Score : p2Score,
        team2Score: pair.team1IsHome ? p2Score : p1Score,
        detail: event.status?.type?.shortDetail || event.status?.type?.detail || '',
        sourceUrl: buildEspnSourceUrl(candidate, 'tennis_all')
      };
    });
  }

  function sofascoreStatusDetail(status) {
    const code = Number(status?.code);
    if (code === 6 || code === 7) return 'live';
    if (code === 100) return 'finished';
    if (code === 60) return 'postponed';
    if (code === 70 || code === 90) return 'canceled';
    if (code === 0) return 'scheduled';
    const statusDesc = status?.description || status?.type || '';
    return typeof statusDesc === 'string' ? statusDesc : String(statusDesc);
  }

  function sofascoreTennisScore(score) {
    const parts = [];
    for (let idx = 1; idx <= 5; idx++) {
      const value = score?.[`period${idx}`];
      if (value == null || value === '') continue;
      const tieBreak = score?.[`period${idx}TieBreak`];
      parts.push(tieBreak == null || tieBreak === '' ? String(value) : `${value}(${tieBreak})`);
    }
    if (parts.length) return parts.join(' ');
    return score?.current ?? score?.display ?? '';
  }

  const ESPNCRICINFO_BASE = 'https://hs-consumer-api.espncricinfo.com/v1/pages';

  function buildCricinfoPlan(match) {
    const anchorMs = getMatchAnchorMs(match);
    const live = isActuallyLive(match);
    const currentMs = getLiveRecoveryMs(match);
    const baseMs = anchorMs || (live ? currentMs : null);
    const plan = [];
    if (live) {
      plan.push({
        anchorKind: anchorMs ? 'torn-start' : 'current-live',
        anchorMs: baseMs || Date.now(),
        offsetDays: 0,
        reason: 'live-board',
        providerDate: 'live',
        requestKey: 'live'
      });
      plan.push({
        anchorKind: anchorMs ? 'torn-start' : 'current-live',
        anchorMs: baseMs || Date.now(),
        offsetDays: 0,
        reason: 'current-board',
        providerDate: 'current',
        requestKey: 'current'
      });
    }
    if (baseMs) {
      plan.push(...buildOffsetPlan(anchorMs ? 'torn-start' : 'current-live', baseMs, [0, -1, 1], 'date-board', 'cricinfo'));
    }
    return dedupeLookupPlan(plan).slice(0, live ? 5 : 3);
  }

  function cricinfoExtractMatches(body) {
    if (Array.isArray(body)) return body;
    const containers = [
      body?.matches,
      body?.content?.matches,
      body?.content?.matchList?.matches,
      body?.matchList?.matches,
      body?.data?.matches,
      body?.data?.content?.matches
    ];
    for (const value of containers) {
      if (Array.isArray(value)) return value;
    }
    const groups = body?.content?.matchesByDate || body?.matchesByDate || body?.content?.groups || body?.groups;
    if (Array.isArray(groups)) {
      return groups.flatMap(group => group?.matches || group?.items || []).filter(Boolean);
    }
    return [];
  }

  function cricinfoTeamName(teamEntry) {
    const team = teamEntry?.team || teamEntry || {};
    return team.longName || team.name || team.displayName || '';
  }

  function cricinfoTeamShortName(teamEntry) {
    const team = teamEntry?.team || teamEntry || {};
    return team.abbreviation || team.shortName || team.name || '';
  }

  function cricinfoTeamScore(teamEntry) {
    const score = teamEntry?.score || teamEntry?.scores || teamEntry?.teamScore || teamEntry?.scoreText;
    if (typeof score === 'string' || typeof score === 'number') return String(score);
    if (score?.display) return String(score.display);
    if (score?.summary) return String(score.summary);
    const innings = Array.isArray(teamEntry?.innings) ? teamEntry.innings : (Array.isArray(score?.innings) ? score.innings : []);
    const parts = innings.map(inn => inn?.score || inn?.display || inn?.summary || inn?.runs).filter(v => v !== undefined && v !== null && String(v) !== '');
    return parts.map(String).join(' & ');
  }

  function cricinfoEventId(item) {
    return item?.objectId || item?.matchId || item?.id || item?.slug || '';
  }

  function cricinfoStatus(item) {
    return item?.statusText || item?.status || item?.state || item?.stage || '';
  }

  function cricinfoSourceUrl(item) {
    const url = item?.url || item?.href || item?.link || item?.webUrl || item?.matchUrl;
    if (url) return url;
    const seriesId = item?.series?.objectId || item?.seriesId || '';
    const matchId = item?.objectId || item?.matchId || item?.id || '';
    if (!seriesId || !matchId) return '';
    return `https://www.espncricinfo.com/series/${encodeURIComponent(seriesId)}/match/${encodeURIComponent(matchId)}`;
  }

  async function _findEspnCricinfo(match) {
    const plan = buildCricinfoPlan(match);
    if (!plan.length) return { found: false, detail: 'ESPNcricinfo: no lookup date', unmatched: true };

    const result = await resolveProviderMatch(match, 'espncricinfo', plan, async step => {
      const requests = [];
      if (step.providerDate === 'live') {
        requests.push({ cacheKey: 'espncricinfo:matches:live', url: `${ESPNCRICINFO_BASE}/matches/live?lang=en` });
      } else if (step.providerDate === 'current') {
        requests.push({ cacheKey: 'espncricinfo:matches:current', url: `${ESPNCRICINFO_BASE}/matches/current?lang=en&latest=true` });
      } else {
        const dateStr = step.providerDate;
        requests.push({
          cacheKey: `espncricinfo:matches:scheduled:${dateStr}`,
          url: `${ESPNCRICINFO_BASE}/matches/scheduled?lang=en&filterType=DATE&filterValue=${encodeURIComponent(dateStr)}`
        });
        requests.push({
          cacheKey: `espncricinfo:matches:result:${dateStr}`,
          url: `${ESPNCRICINFO_BASE}/matches/result?lang=en&filterType=DATE&filterValue=${encodeURIComponent(dateStr)}`
        });
      }

      const boards = await Promise.all(requests.map(req =>
        fetchWithCache(req.cacheKey, () => gmFetchJsonWithMeta(req.url, {}, 'ESPNcricinfo matches request'))
      ));
      const errors = [];
      const candidates = [];
      let eventCount = 0;
      for (const response of boards) {
        if (response?.error) { errors.push(response.error); continue; }
        const matches = cricinfoExtractMatches(response?.data);
        recordDebugEvent('provider-fetch-meta', { provider: 'espncricinfo', date: step.providerDate, results: matches.length });
        eventCount += matches.length;
        for (const item of matches) {
          const teams = Array.isArray(item?.teams) ? item.teams : [];
          if (teams.length < 2) continue;
          const home = teams[0] || {};
          const away = teams[1] || {};
          candidates.push(candidateWithStep('espncricinfo', step, item, {
            providerEventId: cricinfoEventId(item),
            startTime: item.startDate || item.startTime || item.date || '',
            homeName: cricinfoTeamName(home),
            awayName: cricinfoTeamName(away),
            homeShortName: cricinfoTeamShortName(home),
            awayShortName: cricinfoTeamShortName(away),
            homeCode: cricinfoTeamShortName(home),
            awayCode: cricinfoTeamShortName(away),
            status: cricinfoStatus(item),
            competitionName: item.series?.longName || item.series?.name || item.competition?.name || ''
          }));
        }
      }
      return {
        eventCount,
        candidates,
        ...(errors.length ? { errors } : {}),
        ...(!eventCount ? { parseFailures: ['ESPNcricinfo: no matches in response'] } : {})
      };
    });

    return scoreFromResolution(result, 'espncricinfo', 'ESPNcricinfo', (candidate, pair) => {
      const teams = Array.isArray(candidate.raw?.teams) ? candidate.raw.teams : [];
      const homeScore = cricinfoTeamScore(teams[0] || {});
      const awayScore = cricinfoTeamScore(teams[1] || {});
      return {
        team1Score: pair.team1IsHome ? homeScore : awayScore,
        team2Score: pair.team1IsHome ? awayScore : homeScore,
        detail: cricinfoStatus(candidate.raw),
        venue: candidate.raw?.ground?.name || candidate.raw?.venue?.name || candidate.raw?.ground || '',
        sourceUrl: cricinfoSourceUrl(candidate.raw)
      };
    });
  }

  async function _findSofascore(match) {
    const sportKey = match.sportAlias || match.sportKey || '';
    const slug     = SOFASCORE_SPORT_SLUGS[sportKey];
    if (!slug) return { found: false, detail: `SofaScore: sport '${sportKey}' not mapped`, unmatched: true };
    const result = await resolveSofascoreMatch(match, slug);
    return scoreFromResolution(result, 'sofascore', 'SofaScore', (candidate, pair) => {
      const ev = candidate.raw;
      const homeScore = match?.sportKey === 'tennis'
        ? sofascoreTennisScore(ev.homeScore)
        : (ev.homeScore?.current ?? ev.homeScore?.display ?? '');
      const awayScore = match?.sportKey === 'tennis'
        ? sofascoreTennisScore(ev.awayScore)
        : (ev.awayScore?.current ?? ev.awayScore?.display ?? '');
      const statusDesc = sofascoreStatusDetail(ev.status);
      return {
        team1Score: pair.team1IsHome ? homeScore : awayScore,
        team2Score: pair.team1IsHome ? awayScore : homeScore,
        detail: typeof statusDesc === 'string' ? statusDesc : String(statusDesc),
        venue: ev.venue?.city?.name || ev.venue?.name || ''
      };
    });
  }

  async function _findLivescore(match) {
    const slug = LIVESCORE_SPORT_SLUGS[match.sportKey];
    if (!slug) return { found: false, detail: 'LiveScore: sport not mapped', unmatched: true };
    const plan = buildDateBucketPlan(match, 'livescore', { maxRequests: isActuallyLive(match) || isGlobalDateSport(match) ? 3 : 1, globalUpcoming: true });
    const result = await resolveProviderMatch(match, 'livescore', plan, async step => {
      const [dd, mm, yyyy] = step.providerDate.split('/');
      const url = `https://prod-public-api.livescore.com/v1/api/app/date/${slug}/${dd}/${mm}/${yyyy}/0`;
      const board = await fetchWithCache(`livescore:${slug}:${step.providerDate}`, () => gmFetchJson(url, {
        'Accept': 'application/json',
        'Origin': 'https://www.livescore.com',
        'Referer': 'https://www.livescore.com/'
      }));
      if (board?.error) return { errors: [board.error], candidates: [], eventCount: 0 };
      if (!Array.isArray(board?.Stages)) return { parseFailures: ['LiveScore Stages missing'], candidates: [], eventCount: 0 };
      const candidates = [];
      let eventCount = 0;
      for (const stage of board.Stages) {
        for (const ev of (stage.Events || [])) {
          eventCount += 1;
          candidates.push(candidateWithStep('livescore', step, ev, {
            providerEventId: ev.Eid || ev.ID || '',
            startTime: parseLivescoreStartMs(ev),
            homeName: ev.T1?.[0]?.Nm || '',
            awayName: ev.T2?.[0]?.Nm || '',
            status: ev.Eps || ev.Esid || '',
            competitionName: stage.Snm || stage.Cnm || ''
          }));
        }
      }
      return { candidates, eventCount };
    }, { maxRequests: plan.length });

    return scoreFromResolution(result, 'livescore', 'LiveScore', (candidate, pair) => {
      const ev = candidate.raw;
      const homeScore = ev.Tr1 ?? '';
      const awayScore = ev.Tr2 ?? '';
      return {
        team1Score: pair.team1IsHome ? homeScore : awayScore,
        team2Score: pair.team1IsHome ? awayScore : homeScore,
        detail: String(ev.Eps || (ev.Esid === 3 ? 'FT' : ev.Esid === 1 ? 'Not started' : 'Live')),
        venue: ''
      };
    });
  }

  function thescoreSlugFor(match) {
    const base = THESCORE_SPORT_SLUGS[match.sportKey];
    if (!base) return null;
    if (match.sportKey === 'american-football') {
      const stage = normalizeName(match.stage || '');
      const comp  = normalizeName(match.competition || '');
      if (stage.includes('cfl') || comp.includes('cfl')) return 'cfl';
      if (stage.includes('nfl') || comp.includes('nfl')) return 'nfl';
    }
    return base;
  }

  // Shared TheScore event resolution — used by both the score and stats paths.
  async function resolveThescore(match, slug) {
    slug = slug || thescoreSlugFor(match);
    if (!slug) return { slug: null, result: null };
    const plan = buildTheScorePlan(match);
    if (!plan.length) return { slug, result: null };
    const result = await resolveProviderMatch(match, 'thescore', plan, async step => {
      // Only game_date.gt/.lt work (gte/lte and start_at.* return HTTP 500). See buildTheScorePlan.
      const url = `https://api.thescore.com/${slug}/events?game_date.gt=${encodeURIComponent(step.startIso)}&game_date.lt=${encodeURIComponent(step.endIso)}`;
      const events = await fetchWithCache(`thescore:${slug}:${step.requestKey}`, () => gmFetchJson(url, {
        'Accept': 'application/json',
        'Referer': 'https://www.thescore.com/'
      }));
      if (events?.error) return { errors: [events.error], candidates: [], eventCount: 0 };
      if (!Array.isArray(events)) return { parseFailures: ['TheScore array missing'], candidates: [], eventCount: 0 };
      return {
        eventCount: events.length,
        candidates: events.map(ev => {
          // game_date is RFC-2822 (e.g. "Fri, 19 Jun 2026 23:30:00 -0000"); Date.parse handles it.
          const gameDateMs = ev.game_date ? Date.parse(ev.game_date) : NaN;
          const startMs = Number.isFinite(gameDateMs) && isPlausibleTimestampMs(gameDateMs)
            ? gameDateMs
            : (ev.start_at ? Date.parse(ev.start_at) : NaN);
          return candidateWithStep('thescore', step, ev, {
            providerEventId: ev.id || ev.uuid || '',
            startTime: Number.isFinite(startMs) ? startMs : 0,
            homeName: ev.home_team?.full_name || ev.home_team?.name || ev.home_team?.short_display_name || '',
            awayName: ev.away_team?.full_name || ev.away_team?.name || ev.away_team?.short_display_name || '',
            // event_status ('in_progress'/'final'/'pre_game') is reliable; status can be 'half_over' etc.
            status: ev.event_status || ev.status || ev.game_status || '',
            competitionName: ev.league?.name || ev.competition?.name || slug.toUpperCase()
          });
        })
      };
    }, { maxRequests: 1 });
    return { slug, result };
  }

  async function _findThescore(match) {
    const { slug, result } = await resolveThescore(match);
    if (!slug) return { found: false, detail: 'TheScore: sport not mapped', unmatched: true };
    if (!result) return { found: false, detail: 'TheScore: no valid anchor', unmatched: true };

    return scoreFromResolution(result, 'thescore', 'TheScore', (candidate, pair) => {
      const ev = candidate.raw;
      // Live score lives in box_score.score.{home,away}.score; top-level `score` is null in-play.
      const boxScore = ev.box_score?.score || {};
      const homeScore = ev.score?.home ?? boxScore.home?.score ?? '';
      const awayScore = ev.score?.away ?? boxScore.away?.score ?? '';
      const statusRaw = ev.event_status || ev.status || ev.game_status || '';
      const matchTime = ev.match_time || ev.period_display || '';
      return {
        team1Score: pair.team1IsHome ? homeScore : awayScore,
        team2Score: pair.team1IsHome ? awayScore : homeScore,
        detail: matchTime ? String(matchTime) : String(statusRaw).replace(/_/g, ' '),
        venue: ev.location || ''
      };
    });
  }

  async function _findBbc(match) {
    const sport = BBC_SPORT_PATHS[match.sportKey];
    if (!sport) return { found: false, detail: 'BBC: sport not mapped', unmatched: true };
    const plan = buildDateBucketPlan(match, 'iso', { maxRequests: isActuallyLive(match) ? 3 : 1 });
    const result = await resolveProviderMatch(match, 'bbcsport', plan, async step => {
      const raw = await fetchWithCache(`bbc:${sport}:${step.providerDate}`, () => gmFetchJson(`https://www.bbc.com/sport/${sport}/scores-fixtures/${step.providerDate}`));
      if (raw?.error) return { errors: [raw.error], candidates: [], eventCount: 0 };
      if (!raw) return { errors: ['BBC empty response'], candidates: [], eventCount: 0 };

      let data = raw;
      let parseFailure = '';
      const matchObjs = [];
      const decodeHtml = value => String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      const stripTags = value => decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      const pushTextFixture = (text, href) => {
        const fixtureText = stripTags(text);
        const m = fixtureText.match(/\b(.+?)\s+versus\s+(.+?)\s+kick off\s+(\d{1,2}:\d{2})\b/i);
        if (!m) return;
        const homeName = m[1].trim();
        const awayName = m[2].trim();
        if (!homeName || !awayName) return;
        const eventId = String(href || '').match(/\/live\/([^/?#]+)/)?.[1] || '';
        matchObjs.push({
          id: eventId,
          startTime: `${step.providerDate}T${m[3].padStart(5, '0')}:00Z`,
          status: { description: 'scheduled' },
          homeTeam: { name: homeName, scores: { score: '' } },
          awayTeam: { name: awayName, scores: { score: '' } },
          sourceUrl: href || ''
        });
      };
      const extractTextFixtures = html => {
        const itemRe = /<(li|article|div|a)\b[^>]*>([\s\S]*?)<\/\1>/gi;
        let item;
        while ((item = itemRe.exec(html))) {
          if (!/\bversus\b/i.test(item[2]) || !/\bkick off\b/i.test(item[2])) continue;
          const href = item[0].match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
          pushTextFixture(item[2], href);
        }
        if (!matchObjs.length) {
          String(html).split(/\n|<\/(?:li|article|div|a)>/i).forEach(chunk => {
            if (/\bversus\b/i.test(chunk) && /\bkick off\b/i.test(chunk)) pushTextFixture(chunk, '');
          });
        }
      };
      const extractDomFixtures = html => {
        // Current BBC markup has no __NEXT_DATA__ blob: fixtures are <li data-tipo-topic-id>
        // rows with team names in [class*="TeamNameWrapper"], the BBC event id on the
        // a[data-tipo-id]/href, kickoff in <time>, and a visually-hidden
        // "HOME versus AWAY kick off HH:MM" summary as a fallback. Scraped from the raw
        // string (no server-side DOM parser) via attribute-anchored regex.
        const liRe = /<li\b([^>]*\bdata-tipo-topic-id="[^"]*"[^>]*)>([\s\S]*?)<\/li>/gi;
        let li;
        while ((li = liRe.exec(html))) {
          const liAttrs = li[1];
          const inner = li[2];
          const href = inner.match(/href="([^"]*\/live\/[^"]*)"/i)?.[1] || '';
          const eventId =
            inner.match(/\bdata-tipo-id="([^"]+)"/i)?.[1] ||
            href.match(/\/live\/([^/?#"]+)/)?.[1] ||
            liAttrs.match(/\bdata-tipo-topic-id="([^"]+)"/i)?.[1] || '';
          const names = [];
          const seen = new Set();
          const wrapRe = /class="[^"]*TeamNameWrapper[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
          let w;
          while ((w = wrapRe.exec(inner))) {
            const name = stripTags(w[1]);
            const key = name.toLowerCase();
            if (name && !seen.has(key)) { seen.add(key); names.push(name); }
          }
          const summary = stripTags(inner).match(/\b(.+?)\s+versus\s+(.+?)\s+kick off\s+(\d{1,2}:\d{2})\b/i);
          let homeName = names[0] || (summary ? summary[1].trim() : '');
          let awayName = names[1] || (summary ? summary[2].trim() : '');
          if (!homeName || !awayName) continue;
          let startTime = inner.match(/<time\b[^>]*\bdatetime="([^"]+)"/i)?.[1] || '';
          if (!startTime) {
            const timeText = stripTags(inner.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i)?.[1] || '');
            const hhmm = timeText.match(/\b(\d{1,2}:\d{2})\b/)?.[1] || (summary ? summary[3] : '');
            if (hhmm) startTime = `${step.providerDate}T${hhmm.padStart(5, '0')}:00Z`;
          }
          const scoreNums = [];
          const scoreRe = /class="[^"]*[Ss]core[^"]*"[^>]*>\s*(\d{1,3})\s*</g;
          let s;
          while ((s = scoreRe.exec(inner)) && scoreNums.length < 2) scoreNums.push(s[1]);
          const lower = stripTags(inner).toLowerCase();
          let statusText = 'scheduled';
          if (scoreNums.length === 2) statusText = /\bfull time\b|\bft\b/.test(lower) ? 'finished' : 'live';
          matchObjs.push({
            id: eventId,
            startTime,
            status: { description: statusText },
            homeTeam: { name: homeName, scores: { score: scoreNums[0] ?? '' } },
            awayTeam: { name: awayName, scores: { score: scoreNums[1] ?? '' } },
            sourceUrl: href ? (href.startsWith('http') ? href : `https://www.bbc.com${href}`) : ''
          });
        }
      };
      if (typeof raw === 'string') {
        try {
          extractDomFixtures(raw);
          if (matchObjs.length) {
            data = null;
          } else {
            const m = raw.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (m) data = JSON.parse(m[1]);
            else {
              extractTextFixtures(raw);
              data = null;
            }
          }
        } catch (_) {
          parseFailure = 'BBC JSON parse failed';
        }
      }
      const walk = obj => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(walk); return; }
        const hn = obj.homeTeam?.name || obj.home?.name || '';
        const an = obj.awayTeam?.name || obj.away?.name || '';
        if (hn && an) matchObjs.push(obj);
        Object.values(obj).forEach(walk);
      };
      if (data) walk(data);
      if (!matchObjs.length) return { parseFailures: [parseFailure || 'BBC expected competition structure absent'], candidates: [], eventCount: 0 };
      return {
        eventCount: matchObjs.length,
        candidates: matchObjs.map(ev => candidateWithStep('bbcsport', step, ev, {
          providerEventId: ev.id || ev.matchId || '',
          startTime: ev.startTime || ev.startDateTime || ev.date || '',
          homeName: ev.homeTeam?.name || ev.home?.name || '',
          awayName: ev.awayTeam?.name || ev.away?.name || '',
          status: ev.status?.description || ev.progressDescription || ev.matchStatus || '',
          competitionName: ev.competition?.name || ev.tournament?.name || ''
        }))
      };
    }, { maxRequests: plan.length });

    return scoreFromResolution(result, 'bbcsport', 'BBC Sport', (candidate, pair) => {
      const ev = candidate.raw;
      const homeScore = ev.homeTeam?.scores?.score ?? ev.home?.score ?? ev.homeScore ?? '';
      const awayScore = ev.awayTeam?.scores?.score ?? ev.away?.score ?? ev.awayScore ?? '';
      return {
        team1Score: pair.team1IsHome ? homeScore : awayScore,
        team2Score: pair.team1IsHome ? awayScore : homeScore,
        detail: String(ev.status?.description || ev.progressDescription || ev.matchStatus || ''),
        venue: ev.venueName || '',
        sourceUrl: ev.sourceUrl || buildBbcSourceUrl(sport, candidate)
      };
    });
  }

  // -- API-Football (api-sports.io) soccer provider --------------------------------
  // Endpoint: GET https://v3.football.api-sports.io/fixtures?date=YYYY-MM-DD
  // Auth: x-apisports-key header (BYOK). One call returns all fixtures for the date
  // across all leagues; the response is cached per date so each soccer match served
  // from the same date costs 0 additional tokens. Free tier: 100 req/day, 10 req/min.

  const TTL_APISPORTS = 5 * 60 * 1000;   // 5-min board cache (quota-aware, shorter TTL added in A·2)
  const TTL_APISPORTS_MANUAL = 24 * 60 * 60 * 1000; // manual-only mode: board effectively never expires between manual refreshes

  function apiSportsAuthHeaders() {
    return { 'x-apisports-key': getApiSportsKey() };
  }

  // Shared board fetch for both api-sports providers (rugby/AFL + soccer). On the
  // free tier (apiSportsRefreshMode === 'manual') the network is skipped during
  // auto/interval refreshes — the last cached board keeps rendering at 0 tokens —
  // and is only refetched when the user clicks "Refresh now" (context.manualRefresh).
  // The manual refresh clears the api-sports date keys once up-front (in
  // refreshPanel), so normal fetchWithCache dedup guarantees exactly one request
  // per sport/date. Returns the gmFetchJsonWithMeta response, or null when the
  // manual gate served nothing this cycle (caller treats as "no board").
  function fetchApiSportsBoard({ cacheKey, url, label, provider }, context = {}) {
    const familyKey = provider === 'apifootball'
      ? 'Football'
      : (label.replace(/\s+(games|fixtures)\s+request$/i, '') || label);
    const manualOnly = uiSettings.apiSportsRefreshMode === 'manual';
    const annotate = (response, meta = {}) => response && typeof response === 'object'
      ? { ...response, ...meta }
      : response;
    const cached = peekProviderCache(cacheKey);
    if (cached) {
      return Promise.resolve(annotate(cached, {
        networkRequested: false,
        cacheHit: true,
        manualSuppressed: false,
        cacheKey
      }));
    }
    if (manualOnly && context?.manualRefresh !== true) {
      recordDebugEvent('provider-fetch-meta', { provider, cacheKey, servedFromCache: 'manual-skip' });
      return Promise.resolve({
        skipped: true,
        skipReason: 'manual-cache-only',
        provider,
        label,
        cacheKey,
        networkRequested: false,
        cacheHit: false,
        manualSuppressed: true,
        headers: {},
        status: null,
        data: null
      });
    }
    if (isByokQuotaExhausted(provider, familyKey) && context?.manualRefresh !== true) {
      recordDebugEvent('provider-fetch-meta', { provider, cacheKey, skipped: 'out-of-tokens' });
      return Promise.resolve({
        error: `${label}: Out of Tokens`,
        skipped: true,
        skipReason: 'out-of-tokens',
        provider,
        label,
        cacheKey,
        networkRequested: false,
        cacheHit: false,
        manualSuppressed: false,
        headers: {},
        status: null,
        data: null
      });
    }
    const trackedFetch = trackByokRequest(provider, familyKey, familyKey, 1, () => gmFetchJsonWithMeta(url, apiSportsAuthHeaders(), label));
    return fetchWithCache(
      cacheKey,
      () => trackedFetch().then(response => annotate(response, {
          networkRequested: true,
          cacheHit: false,
          manualSuppressed: false,
          cacheKey
        })),
      manualOnly ? TTL_APISPORTS_MANUAL : TTL_APISPORTS,
      TTL_ERROR
    );
  }

  const APISPORTS_ENDPOINTS = {
    rugby: {
      label: 'API-Sports Rugby',
      url: 'https://v1.rugby.api-sports.io/games',
      cachePrefix: 'apisports:rugby:games'
    },
    'rugby-league': {
      label: 'API-Sports Rugby',
      url: 'https://v1.rugby.api-sports.io/games',
      cachePrefix: 'apisports:rugby:games'
    },
    'australian-football': {
      label: 'API-Sports AFL',
      url: 'https://v1.afl.api-sports.io/games',
      cachePrefix: 'apisports:afl:games'
    }
  };

  function apiSportsTeamName(team) {
    if (typeof team === 'string') return team;
    return team?.name || team?.displayName || team?.shortName || '';
  }

  function apiFootballParserDiagnostic(response, fixtures = [], providerName = 'API-Football', meta = {}) {
    const body = response?.data;
    const errors = body?.errors;
    const lowerHeaders = {};
    Object.entries(response?.headers || {}).forEach(([key, value]) => { lowerHeaders[String(key).toLowerCase()] = value; });
    return sanitizeDebugValue({
      providerName,
      providerDate: meta.providerDate || response?.providerDate || '',
      networkRequested: meta.networkRequested ?? response?.networkRequested ?? false,
      manualSuppressed: meta.manualSuppressed ?? response?.manualSuppressed ?? false,
      cacheHit: meta.cacheHit ?? response?.cacheHit ?? false,
      skipReason: meta.skipReason || response?.skipReason || '',
      responseType: Array.isArray(body) ? 'array' : typeof body,
      topLevelKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 12) : [],
      results: body?.results ?? null,
      errorsKeys: errors && typeof errors === 'object' && !Array.isArray(errors) ? Object.keys(errors).slice(0, 12) : [],
      candidateCount: Array.isArray(fixtures) ? fixtures.length : 0,
      quotaHeadersPresent: lowerHeaders['x-ratelimit-requests-remaining'] != null || lowerHeaders['x-ratelimit-remaining'] != null
    });
  }

  async function _findApiSports(match, context = {}) {
    const config = APISPORTS_ENDPOINTS[match.sportKey];
    if (!config) {
      return { found: false, detail: 'API-Sports: sport not mapped', unmatched: true };
    }
    if (!hasApiSportsKey()) {
      return { found: false, detail: 'API-Sports: key not configured', unmatched: true };
    }

    const live = isActuallyLive(match);
    const plan = buildDateBucketPlan(match, 'iso', {
      maxRequests: live ? 3 : 2
    });

    const result = await resolveProviderMatch(match, 'apisports', plan, async step => {
      const dateStr = step.providerDate; // YYYY-MM-DD
      const url = `${config.url}?date=${encodeURIComponent(dateStr)}`;
      const response = await fetchApiSportsBoard({
        cacheKey: `${config.cachePrefix}:${dateStr}`,
        url,
        label: `${config.label} games request`,
        provider: 'apisports'
      }, context);
      const baseDiagnostic = apiFootballParserDiagnostic(response, [], config.label, {
        providerDate: dateStr
      });
      if (response?.skipped && response?.skipReason === 'manual-cache-only') {
        return { parseFailures: ['API-Sports: manual mode cache-only; not requested'], candidates: [], eventCount: 0, parserDiagnostics: [baseDiagnostic] };
      }
      if (response?.error) return { errors: [response.error], candidates: [], eventCount: 0, parserDiagnostics: [baseDiagnostic] };

      const body = response?.data;
      const apiErrors = body?.errors;
      const parserDiagnostic = apiFootballParserDiagnostic(response, Array.isArray(body?.response) ? body.response : [], config.label, {
        providerDate: dateStr
      });
      if (apiErrors && !Array.isArray(apiErrors) && Object.keys(apiErrors).length > 0) {
        const errMsg = Object.values(apiErrors).join('; ');
        updateByokQuotaState({
          providerKey: 'apisports',
          familyKey: config.label,
          label: config.label,
          headers: response?.headers || {},
          status: response?.status || 200,
          errorText: errMsg,
          outcome: 'error'
        });
        recordDebugEvent('provider-fetch-meta', { provider: 'apisports', sportKey: match.sportKey, date: dateStr, errors: sanitizeDebugText(errMsg), parserDiagnostic });
        return { errors: [errMsg], candidates: [], eventCount: 0, parserDiagnostics: [parserDiagnostic] };
      }

      if (!Array.isArray(body?.response)) {
        return { parseFailures: ['API-Sports: response array missing'], candidates: [], eventCount: 0, parserDiagnostics: [parserDiagnostic] };
      }

      const games = body.response;
      recordDebugEvent('provider-fetch-meta', {
        provider: 'apisports',
        sportKey: match.sportKey,
        date: dateStr,
        results: body?.results ?? games.length
      });

      if (!games.length) return { parseFailures: ['API-Sports: no games in response'], candidates: [], eventCount: 0 };

      return {
        eventCount: games.length,
        candidates: games.map(item => {
          const teams = item.teams || {};
          const scores = item.scores || {};
          const status = item.status || {};
          const league = item.league || item.competition || {};
          return candidateWithStep('apisports', step, item, {
            providerEventId: item.game?.id || item.id || '',
            startMs: item.timestamp ? Number(item.timestamp) * 1000 : 0,
            homeName: apiSportsTeamName(teams.home),
            awayName: apiSportsTeamName(teams.away),
            status: status.short || status.long || '',
            competitionName: league.name || league.displayName || ''
          });
        }).filter(c => c.homeName && c.awayName)
      };
    });

    return scoreFromResolution(result, 'apisports', 'API-Sports', (candidate, pair) => {
      const item = candidate.raw;
      const scores = item.scores || {};
      const status = item.status || {};
      const league = item.league || item.competition || {};
      return {
        team1Score: pair.team1IsHome ? (scores.home ?? '') : (scores.away ?? ''),
        team2Score: pair.team1IsHome ? (scores.away ?? '') : (scores.home ?? ''),
        detail: status.long || status.short || '',
        venue: item.venue?.name || item.venue?.city || league.name || ''
      };
    });
  }

  async function _findApiFootball(match, context = {}) {
    if (!hasApiSportsKey()) {
      return { found: false, detail: 'API-Football: key not configured', unmatched: true };
    }

    const live = isActuallyLive(match);
    const plan = buildDateBucketPlan(match, 'iso', {
      maxRequests: live ? 3 : 2
    });

    const result = await resolveProviderMatch(match, 'apifootball', plan, async step => {
      const dateStr = step.providerDate; // YYYY-MM-DD
      const url = `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(dateStr)}`;
      const response = await fetchApiSportsBoard({
        cacheKey: `apifootball:fixtures:${dateStr}`,
        url,
        label: 'API-Football fixtures request',
        provider: 'apifootball'
      }, context);
      const baseDiagnostic = apiFootballParserDiagnostic(response, [], 'API-Football', {
        providerDate: dateStr
      });
      if (response?.skipped && response?.skipReason === 'manual-cache-only') {
        return { parseFailures: ['API-Football: manual mode cache-only; not requested'], candidates: [], eventCount: 0, parserDiagnostics: [baseDiagnostic] };
      }
      if (response?.error) return { errors: [response.error], candidates: [], eventCount: 0, parserDiagnostics: [baseDiagnostic] };

      const body = response?.data;
      const parserDiagnostic = apiFootballParserDiagnostic(response, Array.isArray(body?.response) ? body.response : [], 'API-Football', {
        providerDate: dateStr
      });
      const apiErrors = body?.errors;
      if (apiErrors && !Array.isArray(apiErrors) && Object.keys(apiErrors).length > 0) {
        const errMsg = Object.values(apiErrors).join('; ');
        updateByokQuotaState({
          providerKey: 'apifootball',
          familyKey: 'Football',
          label: 'Football',
          headers: response?.headers || {},
          status: response?.status || 200,
          errorText: errMsg,
          outcome: 'error'
        });
        recordDebugEvent('provider-fetch-meta', { provider: 'apifootball', date: dateStr, errors: sanitizeDebugText(errMsg), parserDiagnostic });
        return { errors: [errMsg], candidates: [], eventCount: 0, parserDiagnostics: [parserDiagnostic] };
      }

      if (!Array.isArray(body?.response)) {
        return { parseFailures: ['API-Football: response array missing'], candidates: [], eventCount: 0, parserDiagnostics: [parserDiagnostic] };
      }

      const fixtures = body.response;
      parserDiagnostic.candidateCount = fixtures.length;
      recordDebugEvent('provider-fetch-meta', {
        provider: 'apifootball',
        date: dateStr,
        results: body?.results ?? fixtures.length,
        parserDiagnostic
      });

      if (!fixtures.length) return { parseFailures: ['API-Football: no fixtures in response'], candidates: [], eventCount: 0, parserDiagnostics: [parserDiagnostic] };

      return {
        eventCount: fixtures.length,
        candidates: fixtures.map(item => {
          const fixture = item.fixture || {};
          const teams = item.teams || {};
          const goals = item.goals || {};
          const league = item.league || {};
          return candidateWithStep('apifootball', step, item, {
            providerEventId: fixture.id || '',
            startMs: fixture.timestamp ? fixture.timestamp * 1000 : 0,
            homeName: teams.home?.name || '',
            awayName: teams.away?.name || '',
            status: fixture.status?.short || fixture.status?.long || '',
            competitionName: league.name || ''
          });
        }).filter(c => c.homeName && c.awayName)
      };
    });

    return scoreFromResolution(result, 'apifootball', 'API-Football', (candidate, pair) => {
      const item = candidate.raw;
      const goals = item.goals || {};
      const fixture = item.fixture || {};
      const league = item.league || {};
      const statusShort = fixture.status?.short || '';
      const statusLong = fixture.status?.long || '';
      return {
        team1Score: pair.team1IsHome ? (goals.home ?? '') : (goals.away ?? ''),
        team2Score: pair.team1IsHome ? (goals.away ?? '') : (goals.home ?? ''),
        detail: statusLong || statusShort,
        venue: fixture.venue?.name || fixture.venue?.city || league.name || ''
      };
    });
  }

  function pandaScoreAuthHeaders() {
    return { Authorization: `Bearer ${getPandaScoreToken()}` };
  }

  function pandaScoreOpponent(matchObj, index) {
    const entry = Array.isArray(matchObj?.opponents) ? matchObj.opponents[index] : null;
    const opponent = entry?.opponent || {};
    return {
      id: opponent.id ?? entry?.id ?? '',
      name: opponent.name || '',
      acronym: opponent.acronym || opponent.slug || ''
    };
  }

  function pandaScoreScoreFor(matchObj, opponentId) {
    const results = Array.isArray(matchObj?.results) ? matchObj.results : [];
    const found = results.find(result => String(result.team_id ?? result.opponent_id ?? '') === String(opponentId));
    return found?.score ?? '';
  }

  function pandaScoreMatchUrl(matchObj) {
    const url = matchObj?.official_stream_url || matchObj?.streams_list?.[0]?.raw_url || '';
    return safeExternalSourceUrl(url);
  }

  async function _findPandaScore(match, context = {}) {
    const slug = PANDASCORE_GAME_SLUGS[match.sportKey];
    if (!slug) return { found: false, detail: 'PandaScore: esport not mapped', unmatched: true };
    if (!hasPandaScoreToken()) return { found: false, detail: 'PandaScore token not configured', unmatched: true };

    const plan = buildPandaScorePlan(match);
    const result = await resolveProviderMatch(match, 'pandascore', plan, async step => {
      const params = new URLSearchParams();
      params.set('range[begin_at]', `${step.startIso},${step.endIso}`);
      params.set('page[size]', '100');
      params.set('sort', 'begin_at');
      const url = `https://api.pandascore.co/${encodeURIComponent(slug)}/matches?${params.toString()}`;
      const cacheKey = `pandascore:${slug}:${step.requestKey}`;
      if (isByokQuotaExhausted('pandascore', slug) && context?.manualRefresh !== true) {
        const cached = peekProviderCache(cacheKey);
        if (cached) return cached;
        recordDebugEvent('provider-fetch-meta', { provider: 'pandascore', slug, skipped: 'out-of-tokens' });
        return { errors: ['PandaScore: Out of Tokens'], candidates: [], eventCount: 0 };
      }
      const response = await fetchWithCache(
        cacheKey,
        trackByokRequest('pandascore', slug, `PandaScore ${slug}`, 1, () => gmFetchJsonWithMeta(url, pandaScoreAuthHeaders(), 'PandaScore matches request')),
        TTL_SUCCESS,
        TTL_ERROR
      );
      if (response?.error) return { errors: [response.error], candidates: [], eventCount: 0 };
      const matches = Array.isArray(response?.data) ? response.data : response;
      if (!Array.isArray(matches)) return { parseFailures: ['PandaScore matches array missing'], candidates: [], eventCount: 0 };
      return {
        eventCount: matches.length,
        candidates: matches.map(matchObj => {
          const first = pandaScoreOpponent(matchObj, 0);
          const second = pandaScoreOpponent(matchObj, 1);
          return candidateWithStep('pandascore', step, matchObj, {
            providerEventId: matchObj.id || matchObj.slug || '',
            startTime: matchObj.begin_at || matchObj.scheduled_at || '',
            homeName: first.name,
            awayName: second.name,
            homeShortName: first.acronym,
            awayShortName: second.acronym,
            status: matchObj.status || '',
            competitionName: [
              matchObj.league?.name,
              matchObj.serie?.full_name || matchObj.serie?.name,
              matchObj.tournament?.name
            ].filter(Boolean).join(' - ')
          });
        }).filter(candidate => candidate.homeName && candidate.awayName)
      };
    }, { maxRequests: plan.length });

    return scoreFromResolution(result, 'pandascore', 'PandaScore', (candidate, pair) => {
      const matchObj = candidate.raw;
      const first = pandaScoreOpponent(matchObj, 0);
      const second = pandaScoreOpponent(matchObj, 1);
      const firstScore = pandaScoreScoreFor(matchObj, first.id);
      const secondScore = pandaScoreScoreFor(matchObj, second.id);
      const status = String(matchObj.status || '').replace(/_/g, ' ');
      const begin = matchObj.begin_at ? formatStartTime(matchObj.begin_at) : '';
      return {
        team1Score: pair.team1IsHome ? firstScore : secondScore,
        team2Score: pair.team1IsHome ? secondScore : firstScore,
        detail: status || begin,
        venue: matchObj.tournament?.name || matchObj.league?.name || '',
        sourceUrl: pandaScoreMatchUrl(matchObj)
      };
    });
  }

  // -- Stats / head-to-head providers --------------------------------------------

  function normalizeStatsResult(sourceKey, sourceLabel, items, extra = {}) {
    const teams = (items || []).filter(Boolean).map(item => (
      typeof item === 'string' ? { summary: item } : item
    ));
    return {
      found: teams.length > 0 || !!extra.summary,
      sourceKey,
      sourceLabel,
      teams,
      recentForm: extra.recentForm || [],
      standings: extra.standings || [],
      updatedAt: Date.now()
    };
  }

  function normalizeHeadToHead(sourceKey, sourceLabel, events, summary = '') {
    const normalizedEvents = (events || []).filter(Boolean).slice(0, 5).map(event => (
      typeof event === 'string' ? { summary: event } : event
    ));
    return {
      found: normalizedEvents.length > 0 || !!summary,
      events: normalizedEvents,
      summary,
      sourceKey,
      sourceLabel,
      updatedAt: normalizedEvents.length || summary ? Date.now() : 0
    };
  }

  function getNhlSeasonId(timestamp) {
    const d = new Date(normalizeTimestampMs(timestamp) || Date.now());
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const start = month >= 9 ? year : year - 1;
    return Number(`${start}${start + 1}`);
  }

  function getNhlTeamAbbrevs(game, landing) {
    return [
      game?.homeTeam?.abbrev || landing?.homeTeam?.abbrev || '',
      game?.awayTeam?.abbrev || landing?.awayTeam?.abbrev || ''
    ].filter(Boolean);
  }

  function _statsFromEspnReuse(match) {
    const score = match?.score || {};
    const event = score.rawEvent;
    if (!score.found || score.sourceKey !== 'espn' || !event) {
      // Inapplicable (score came from another provider) — a skip, not an error worth surfacing.
      return { found: false };
    }

    const competition = event.competitions?.[0] || {};
    const competitors = competition.competitors || [];
    const items = competitors.map(c => {
      const teamName = c.team?.displayName || c.team?.name || '';
      const record = c.records?.[0]?.summary || c.record || '';
      const homeAway = c.homeAway ? `${c.homeAway}` : '';
      return [teamName, record, homeAway].filter(Boolean).join(' - ');
    });
    if (competition.venue?.fullName) items.push(`Venue: ${competition.venue.fullName}`);
    if (competition.status?.type?.detail) items.push(`Status: ${competition.status.type.detail}`);

    const result = normalizeStatsResult('espn-reuse', 'ESPN', items);
    return result.found ? result : { found: false, detail: 'ESPN reuse: no stats fields' };
  }

  function findSofascoreEvent(match, events) {
    const step = buildLookupStep('torn-start', getMatchAnchorMs(match) || Date.now(), 0, 'legacy', 'iso') || {
      anchorKind: 'torn-start',
      offsetDays: 0,
      providerDate: '',
      requestKey: ''
    };
    const candidates = (events || []).map(ev => candidateWithStep('sofascore', step, ev, {
      providerEventId: ev.id || ev.customId || '',
      startMs: ev.startTimestamp ? Number(ev.startTimestamp) * 1000 : 0,
      homeName: ev.homeTeam?.name || '',
      awayName: ev.awayTeam?.name || '',
      homeShortName: ev.homeTeam?.shortName || '',
      awayShortName: ev.awayTeam?.shortName || '',
      homeCode: ev.homeTeam?.nameCode || '',
      awayCode: ev.awayTeam?.nameCode || '',
      status: ev.status?.description || ev.status?.type || '',
      competitionName: ev.tournament?.name || ev.season?.name || ''
    }));
    const best = selectBestCandidate(match, candidates);
    return best.resolution ? { ev: best.resolution.candidate.raw, pair: best.resolution.pair } : null;
  }

  async function _findH2hSofascore(eventId) {
    if (!eventId) return normalizeHeadToHead('sofascore', 'SofaScore', []);
    const data = await fetchWithCache(
      `sofascore:h2h:${eventId}`,
      () => gmFetchJson(`https://www.sofascore.com/api/v1/event/${encodeURIComponent(eventId)}/h2h/events`, sofascoreHeaders()),
      TTL_H2H,
      TTL_ERROR
    );
    const events = (data?.events || []).slice(0, 5).map(ev => {
      const home = ev.homeTeam?.name || '';
      const away = ev.awayTeam?.name || '';
      const homeScore = ev.homeScore?.current ?? ev.homeScore?.display ?? '';
      const awayScore = ev.awayScore?.current ?? ev.awayScore?.display ?? '';
      const date = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toLocaleDateString() : '';
      return {
        summary: [date, `${home} ${homeScore}-${awayScore} ${away}`].filter(Boolean).join(' - ')
      };
    });
    return normalizeHeadToHead('sofascore', 'SofaScore', events);
  }

  function formatThescoreStandingRow(row) {
    if (!row) return '';
    const team = row.team || {};
    const name = team.full_name || team.name || '';
    const record = row.short_record ||
      ([row.wins, row.losses, row.ties].every(v => v != null) ? `${row.wins}-${row.losses}-${row.ties}` : '');
    const pf = row.points_for, pa = row.points_against;
    return [
      name,
      record ? `Record ${record}` : '',
      row.formatted_rank ? `Rank ${row.formatted_rank}` : (row.division ? `${row.division} Division` : ''),
      (pf != null && pa != null) ? `PF ${pf} PA ${pa}` : '',
      row.streak ? `Streak ${row.streak}` : '',
      row.last_five_games_record ? `L5 ${row.last_five_games_record}` : ''
    ].filter(Boolean).join(' - ');
  }

  async function _findStatsThescore(match) {
    const slug = thescoreSlugFor(match);
    if (!slug || uiSettings.enabledProviders?.thescore === false) {
      return { found: false, detail: 'TheScore stats: disabled or unsupported' };
    }
    // Reuse the event already resolved by the score path when available; otherwise resolve afresh.
    let ev = match?.score?.sourceKey === 'thescore' && match.score.rawEvent ? match.score.rawEvent : null;
    if (!ev) {
      const { result } = await resolveThescore(match, slug);
      ev = result?.resolution?.candidate?.raw || null;
      if (!ev) return { found: false, detail: summarizeProviderResult('TheScore stats', result) };
    }

    const home = ev.home_team || {};
    const away = ev.away_team || {};
    const items = [`${home.full_name || home.name || 'Home'} vs ${away.full_name || away.name || 'Away'}`];

    try {
      const standings = await fetchWithCache(
        `thescore:standings:${slug}`,
        () => gmFetchJson(`https://api.thescore.com/${slug}/standings`, {
          'Accept': 'application/json',
          'Referer': 'https://www.thescore.com/'
        }),
        TTL_STATS,
        TTL_ERROR
      );
      if (Array.isArray(standings)) {
        const findRow = (id, name) =>
          (id != null && standings.find(r => String((r.team || {}).id) === String(id))) ||
          standings.find(r => normalizeName((r.team || {}).full_name || (r.team || {}).name) === normalizeName(name));
        [findRow(home.id, home.full_name || home.name), findRow(away.id, away.full_name || away.name)]
          .map(formatThescoreStandingRow)
          .filter(Boolean)
          .forEach(line => items.push(line));
      }
    } catch (_) {}

    if (ev.location || ev.stadium) items.push(`Venue: ${ev.location || ev.stadium}`);
    if (ev.week != null) items.push(`Week ${ev.week}`);

    const result = normalizeStatsResult('thescore', 'TheScore', items);
    return result.found ? result : { found: false, detail: 'TheScore stats: no stats fields' };
  }

  async function _findStatsSofascore(match) {
    try {
      const sportKey = match.sportAlias || match.sportKey || '';
      const slug = SOFASCORE_SPORT_SLUGS[sportKey];
      if (!slug || uiSettings.enabledProviders?.sofascore === false) {
        return { found: false, detail: 'SofaScore stats: disabled or unsupported' };
      }

      let ev = match?.score?.sourceKey === 'sofascore' && match.score.rawEvent ? match.score.rawEvent : null;
      if (!ev) {
        const result = await resolveSofascoreMatch(match, slug, TTL_FORM);
        if (!result?.resolution?.candidate?.raw) {
          return { found: false, detail: summarizeProviderResult('SofaScore stats', result) };
        }
        ev = result.resolution.candidate.raw;
      }
      const items = [];
      const home = ev.homeTeam?.name || '';
      const away = ev.awayTeam?.name || '';
      if (home || away) items.push(`${home || 'Home'} vs ${away || 'Away'}`);
      if (ev.tournament?.name) items.push(`Competition: ${ev.tournament.name}`);
      if (ev.season?.name) items.push(`Season: ${ev.season.name}`);
      if (ev.venue?.name || ev.venue?.city?.name) {
        items.push(`Venue: ${[ev.venue?.name, ev.venue?.city?.name].filter(Boolean).join(', ')}`);
      }
      if (ev.status?.description) items.push(`Status: ${ev.status.description}`);

      const result = normalizeStatsResult('sofascore', 'SofaScore', items);
      if (ev.id) {
        result.eventId = ev.id;
        try {
          result.headToHead = await _findH2hSofascore(ev.id);
        } catch (_) {
          result.headToHead = normalizeHeadToHead('sofascore', 'SofaScore', []);
        }
      }
      return result.found ? result : { found: false, detail: 'SofaScore stats: no structured stats' };
    } catch (error) {
      return { found: false, detail: `SofaScore stats: ${error?.message || 'unavailable'}` };
    }
  }

  function findNhlGame(match, dates) {
    const games = [];
    for (const day of dates || []) {
      if (Array.isArray(day.games)) games.push(...day.games);
    }
    for (const game of games) {
      const home = game.homeTeam?.name?.default || game.homeTeam?.abbrev || '';
      const away = game.awayTeam?.name?.default || game.awayTeam?.abbrev || '';
      const pair = matchTeamPair(match, home, away, game.homeTeam?.abbrev, game.awayTeam?.abbrev);
      if (pair.confidence) return { game, pair };
    }
    return null;
  }

  async function _findNhlTeamSummaries(match, abbrevs) {
    if (!abbrevs.length) return [];
    const seasonId = getNhlSeasonId(match.startTimestamp);
    const exp = encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2`);
    const url = `https://api.nhle.com/stats/rest/en/team/summary?isAggregate=false&isGame=false&sort=%5B%7B%22property%22:%22points%22,%22direction%22:%22DESC%22%7D%5D&start=0&limit=100&cayenneExp=${exp}`;
    const data = await fetchWithCache(
      `nhl:team-summary:${seasonId}`,
      () => gmFetchJson(url),
      TTL_STATS,
      TTL_ERROR
    );
    const rows = Array.isArray(data?.data) ? data.data : [];
    const formatNhlRate = (label, value, digits = 2, suffix = '') => {
      const num = Number(value);
      return Number.isFinite(num) ? `${label} ${num.toFixed(digits)}${suffix}` : '';
    };
    return abbrevs.map(abbrev => {
      const row = rows.find(item => {
        const possible = [
          item.teamAbbrev,
          item.teamAbbrevs,
          item.teamTriCode,
          item.teamCommonName,
          item.teamFullName
        ].map(value => normalizeName(value));
        return possible.some(value => value === normalizeName(abbrev));
      });
      if (!row) return '';
      const record = [row.wins, row.losses, row.otLosses].every(v => v != null)
        ? `${row.wins}-${row.losses}-${row.otLosses}`
        : '';
      const gf = row.goalsForPerGame ?? row.goalsForPerGamePlayed ?? row.goalsFor;
      const ga = row.goalsAgainstPerGame ?? row.goalsAgainstPerGamePlayed ?? row.goalsAgainst;
      const pp = row.powerPlayPct ?? row.ppPct;
      const pk = row.penaltyKillPct ?? row.pkPct;
      return [
        row.teamFullName || row.teamName || abbrev,
        record ? `Record ${record}` : '',
        formatNhlRate('GF/G', gf),
        formatNhlRate('GA/G', ga),
        formatNhlRate('PP', pp, 1, '%'),
        formatNhlRate('PK', pk, 1, '%')
      ].filter(Boolean).join(' - ');
    }).filter(Boolean);
  }

  function _h2hFromNhlLanding(landing) {
    const candidates = [
      landing?.seasonSeries,
      landing?.seriesStatus,
      landing?.matchup,
      landing?.summary?.seasonSeries
    ].filter(Boolean);
    const summary = candidates.map(item => (
      typeof item === 'string'
        ? item
        : item.description || item.summary || item.seriesTitle || item.seriesStatus || ''
    )).find(Boolean) || '';
    return normalizeHeadToHead('nhl', 'NHL public API', [], summary);
  }

  async function resolveNhlGame(match) {
    const plan = buildNhlScorePlan(match);
    return resolveProviderMatch(match, 'nhl', plan, async step => {
      const cacheKey = step.requestKey === 'now' ? 'nhl:score:now' : `nhl:score:${step.providerDate}`;
      const url = step.requestKey === 'now'
        ? 'https://api-web.nhle.com/v1/score/now'
        : `https://api-web.nhle.com/v1/score/${step.providerDate}`;
      const data = await fetchWithCache(cacheKey, () => gmFetchJson(url), TTL_STATS, TTL_ERROR);
      if (data?.error) return { errors: [data.error], candidates: [], eventCount: 0 };
      const games = Array.isArray(data?.games) ? data.games : [];
      return {
        eventCount: games.length,
        candidates: games.map(game => candidateWithStep('nhl', step, game, {
          providerEventId: game.id || '',
          startTime: game.startTimeUTC || game.gameDate || '',
          homeName: game.homeTeam?.name?.default || game.homeTeam?.abbrev || '',
          awayName: game.awayTeam?.name?.default || game.awayTeam?.abbrev || '',
          homeCode: game.homeTeam?.abbrev || '',
          awayCode: game.awayTeam?.abbrev || '',
          status: game.gameState || '',
          competitionName: 'NHL'
        }))
      };
    }, { maxRequests: 4 });
  }

  async function _findStatsNhl(match) {
    if (!isNhlMatch(match)) return { found: false, detail: 'NHL stats: not an NHL match' };
    const resolved = await resolveNhlGame(match);
    if (!resolved?.resolution?.candidate?.raw) {
      return { found: false, detail: summarizeProviderResult('NHL stats', resolved) };
    }

    const game = resolved.resolution.candidate.raw;
    const landing = game.id
      ? await fetchWithCache(
          `nhl:landing:${game.id}`,
          () => gmFetchJson(`https://api-web.nhle.com/v1/gamecenter/${game.id}/landing`),
          TTL_STATS,
          TTL_ERROR
        )
      : null;

    const homeName = game.homeTeam?.name?.default || landing?.homeTeam?.name?.default || 'Home';
    const awayName = game.awayTeam?.name?.default || landing?.awayTeam?.name?.default || 'Away';
    const items = [
      `${homeName}: ${game.homeTeam?.score ?? landing?.homeTeam?.score ?? '-'} goals`,
      `${awayName}: ${game.awayTeam?.score ?? landing?.awayTeam?.score ?? '-'} goals`
    ];
    if (landing?.venue?.default || game.venue?.default) {
      items.push(`Venue: ${landing?.venue?.default || game.venue?.default}`);
    }
    if (landing?.gameState || game.gameState) {
      items.push(`State: ${landing?.gameState || game.gameState}`);
    }

    try {
      const teamSummaries = await _findNhlTeamSummaries(match, getNhlTeamAbbrevs(game, landing));
      items.push(...teamSummaries);
    } catch (_) {}

    const result = normalizeStatsResult('nhl', 'NHL public API', items);
    result.headToHead = _h2hFromNhlLanding(landing || {});
    return result.found ? result : { found: false, detail: 'NHL stats: no stats fields' };
  }

  async function fetchCategory(category, match, enrichment) {
    if (category !== 'stats') return { found: false, detail: `${category}: unsupported` };
    const providers = getStatsProviderPriority(match);
    for (const providerKey of providers) {
      markProviderTried(enrichment, providerKey);
      try {
        let result = null;
        if (providerKey === 'espn-reuse') result = _statsFromEspnReuse(match);
        else if (providerKey === 'thescore') result = await _findStatsThescore(match);
        else if (providerKey === 'sofascore') result = await _findStatsSofascore(match);
        else if (providerKey === 'nhl') result = await _findStatsNhl(match);
        if (result?.found) return result;
        if (result?.detail) markProviderError(enrichment, providerKey, result.detail);
      } catch (error) {
        markProviderError(enrichment, providerKey, error?.message || error);
      }
    }
    return { found: false, detail: 'Stats: no provider data available' };
  }

  function getOddsApiSportKey(match) {
    const sport = normalizeName(match?.sport);
    const stage = normalizeName(match?.stage);
    const competition = normalizeName(match?.competition || match?.league);
    if (sport === 'baseball' && stage.includes('mlb')) return 'baseball_mlb';
    if (sport === 'basketball' && (stage.includes('nba') || competition.includes('nba'))) return 'basketball_nba';
    if (sport === 'basketball' && (stage.includes('wnba') || competition.includes('wnba'))) return 'basketball_wnba';
    if (sport === 'hockey' && (stage.includes('nhl') || competition.includes('nhl'))) return 'icehockey_nhl';
    if (sport === 'american football' && (stage.includes('nfl') || competition.includes('nfl'))) return 'americanfootball_nfl';
    if (sport === 'american football' && (stage.includes('cfl') || competition.includes('cfl'))) return 'americanfootball_cfl';
    if (sport === 'australian football') return 'aussierules_afl';
    if (sport === 'rugby league' && (stage.includes('nrl') || competition.includes('nrl'))) return 'rugbyleague_nrl';
    if (sport === 'football' && competition.includes('mls')) return 'soccer_usa_mls';
    return '';
  }

  function getOddsRegion() {
    const region = uiSettings.oddsRegion;
    return ODDS_AVAILABLE_REGIONS.includes(region) ? region : ODDS_DEFAULT_REGION;
  }

  function getOddsMarketsMode() {
    return uiSettings.oddsMarketsMode === 'full' ? 'full' : 'moneyline';
  }

  // Markets are grouped by token cost: a single Odds API request is billed
  // 1 x (#markets) x (#regions), so the user picks "moneyline only" (1 credit per
  // region) or "full markets" (h2h+spreads+totals = 3 credits per region) rather
  // than toggling individual markets.
  function getSelectedOddsMarkets() {
    return getOddsMarketsMode() === 'full'
      ? [...ODDS_FULL_MARKETS]
      : [...ODDS_DEFAULT_MARKETS];
  }

  // Credits consumed by one Odds API pull for the current settings.
  function getOddsPullCost() {
    return getSelectedOddsMarkets().length; // single region per pull
  }

  function getOddsAnalysisCacheMeta(match) {
    const sportKey = getOddsApiSportKey(match);
    const matchKey = makeMatchKey(match);
    if (!sportKey || !matchKey) return null;
    const markets = getSelectedOddsMarkets();
    return {
      cacheKey: [
        'v1',
        matchKey,
        sportKey,
        getOddsRegion(),
        getOddsMarketsMode(),
        markets.join(','),
        ODDS_ODDS_FORMAT
      ].map(part => encodeURIComponent(String(part || ''))).join('|'),
      matchKey,
      sportKey,
      region: getOddsRegion(),
      marketsMode: getOddsMarketsMode(),
      markets,
      oddsFormat: ODDS_ODDS_FORMAT
    };
  }

  function loadOddsAnalysisCacheStore() {
    try {
      const raw = localStorage.getItem(ODDS_ANALYSIS_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveOddsAnalysisCacheStore(store) {
    try {
      const entries = Object.entries(store || {})
        .filter(([, entry]) => entry && typeof entry === 'object')
        .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))
        .slice(0, ODDS_ANALYSIS_CACHE_LIMIT);
      localStorage.setItem(ODDS_ANALYSIS_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {}
  }

  function isValidOddsAnalysisCacheEntry(entry, meta) {
    if (!entry || !meta || typeof entry !== 'object') return false;
    if (!Array.isArray(entry.rows)) return false;
    if (!Number.isFinite(Number(entry.updatedAt))) return false;
    if (entry.matchKey !== meta.matchKey) return false;
    if (entry.sportKey !== meta.sportKey) return false;
    if (entry.region !== meta.region) return false;
    if (entry.marketsMode !== meta.marketsMode) return false;
    if (entry.oddsFormat !== meta.oddsFormat) return false;
    if ((entry.markets || []).join(',') !== meta.markets.join(',')) return false;
    return true;
  }

  function loadCachedBetPanel(match) {
    const meta = getOddsAnalysisCacheMeta(match);
    if (!meta) return null;
    const entry = loadOddsAnalysisCacheStore()[meta.cacheKey];
    if (!isValidOddsAnalysisCacheEntry(entry, meta)) return null;
    return {
      rows: entry.rows,
      bestBet: entry.bestBet || null,
      oddsFormat: entry.oddsFormat,
      updatedAt: Number(entry.updatedAt),
      fromLocalCache: true
    };
  }

  function saveCachedBetPanel(match, panel) {
    const meta = getOddsAnalysisCacheMeta(match);
    if (!meta || !panel || !Array.isArray(panel.rows)) return;
    const store = loadOddsAnalysisCacheStore();
    store[meta.cacheKey] = {
      matchKey: meta.matchKey,
      sportKey: meta.sportKey,
      region: meta.region,
      marketsMode: meta.marketsMode,
      markets: meta.markets,
      oddsFormat: panel.oddsFormat || meta.oddsFormat,
      rows: panel.rows,
      bestBet: panel.bestBet || null,
      updatedAt: Number(panel.updatedAt || Date.now())
    };
    saveOddsAnalysisCacheStore(store);
  }

  function hydrateBetPanelFromCache(match, enrichment) {
    if (!match || !enrichment || enrichment.betPanel) return false;
    const cached = loadCachedBetPanel(match);
    if (!cached) return false;
    enrichment.betPanel = cached;
    return true;
  }

  function isLiveForOdds(match) {
    return isActuallyLive(match);
  }

  function findOddsApiEvent(match, events) {
    const matchTime = getMatchAnchorMs(match) || (isActuallyLive(match) ? getLiveRecoveryMs(match) : null);
    const toleranceMs = isActuallyLive(match) ? 36 * HOUR_MS : 18 * HOUR_MS;
    for (const event of events || []) {
      const pair = matchTeamPair(match, event.home_team || '', event.away_team || '');
      if (!pair.confidence) continue;
      const eventTime = Date.parse(event.commence_time || '');
      if (!matchTime || Number.isNaN(eventTime)) continue;
      if (Math.abs(eventTime - matchTime) <= toleranceMs) return { event, pair };
    }
    return null;
  }

  function roundNumber(value, places = 4) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  }

  // ODDS_ANALYSIS_CORE_START
  // Deterministic betting-analysis helpers operating on a single Odds API event
  // snapshot. No network, no historical endpoint, no saved snapshots, no line
  // movement. Pure functions only (Math/Number/Object/Array/String/RegExp), so they
  // are extracted and unit-tested in tests/odds-math.test.js. Decimal is the app's
  // display standard but the conversion helpers accept american too. For both
  // american and decimal odds the numerically larger price is better for the bettor.

  function americanToImpliedProb(odds) {
    const n = Number(odds);
    if (!Number.isFinite(n) || n === 0) return null;
    return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  }

  function decimalToImpliedProb(odds) {
    const n = Number(odds);
    if (!Number.isFinite(n) || n <= 1) return null;
    return 1 / n;
  }

  function oddsToImpliedProb(odds, oddsFormat) {
    return oddsFormat === 'american' ? americanToImpliedProb(odds) : decimalToImpliedProb(odds);
  }

  function probToAmerican(prob) {
    if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
    if (prob === 0.5) return 100;
    return prob > 0.5
      ? Math.round(-(prob / (1 - prob)) * 100)
      : Math.round(((1 - prob) / prob) * 100);
  }

  function probToDecimal(prob) {
    if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
    return 1 / prob;
  }

  function americanProfitPer1(odds) {
    const n = Number(odds);
    if (!Number.isFinite(n) || n === 0) return null;
    return n > 0 ? n / 100 : 100 / Math.abs(n);
  }

  function decimalProfitPer1(odds) {
    const n = Number(odds);
    if (!Number.isFinite(n) || n <= 1) return null;
    return n - 1;
  }

  function profitPer1(odds, oddsFormat) {
    return oddsFormat === 'american' ? americanProfitPer1(odds) : decimalProfitPer1(odds);
  }

  function calcNoVigPair(p1, p2) {
    const total = p1 + p2;
    if (!Number.isFinite(total) || total <= 0) return [null, null];
    return [p1 / total, p2 / total];
  }

  function calcEvPct(consensusProb, bestPrice, oddsFormat) {
    const winProfit = profitPer1(bestPrice, oddsFormat);
    if (!Number.isFinite(consensusProb) || winProfit == null) return null;
    const ev = consensusProb * winProfit - (1 - consensusProb);
    return ev * 100;
  }

  function pickBestPrice(prices, oddsFormat) {
    // Larger numeric value is better for both american and decimal odds.
    void oddsFormat;
    let best = null;
    for (const entry of prices || []) {
      const price = Number(entry.price);
      if (!Number.isFinite(price)) continue;
      if (!best || price > best.price) best = { book: entry.book, price };
    }
    return best;
  }

  // Region-aware bookmaker key -> short tag. Falls back to the first 3 letters so
  // non-US books still render a stable abbreviation.
  const BOOKMAKER_ABBREVIATIONS = {
    fanduel: 'FD', draftkings: 'DK', betmgm: 'MGM', caesars: 'CZR', williamhill_us: 'WH',
    pointsbetus: 'PB', betrivers: 'BR', bovada: 'BVD', mybookieag: 'MYB', betonlineag: 'BOL',
    lowvig: 'LV', betus: 'BU', superbook: 'SB', wynnbet: 'WYN', espnbet: 'ESB',
    fanatics: 'FAN', hardrockbet: 'HR', ballybet: 'BLY', unibet_us: 'UNI',
    bet365: 'B365', williamhill: 'WH', betfair_ex_uk: 'BF', betfair: 'BF', skybet: 'SKY',
    paddypower: 'PP', ladbrokes_uk: 'LAD', coral: 'COR', betway: 'BW', unibet_uk: 'UNI',
    betvictor: 'BV', boylesports: 'BOY', marathonbet: 'MAR', pinnacle: 'PIN', matchbook: 'MB',
    onexbet: '1XB', sport888: '888', nordicbet: 'NB', betsson: 'BTS', unibet_eu: 'UNI',
    betclic: 'BTC', tab: 'TAB', sportsbet: 'SBT', ladbrokes_au: 'LAD', neds: 'NED',
    pointsbetau: 'PB', betfair_ex_au: 'BF', topsport: 'TOP', unibet: 'UNI', playup: 'PU', bluebet: 'BLU'
  };

  function abbreviateBook(key) {
    const k = String(key || '').toLowerCase();
    return BOOKMAKER_ABBREVIATIONS[k] || k.slice(0, 3).toUpperCase() || '?';
  }

  // Stable, dependency-free selection shortener. Multi-word names become initials
  // when that yields 2-4 chars (e.g. "New York Yankees" -> "NYY"); otherwise the
  // first three letters are used. Deterministic so labels never drift.
  function abbreviateSelection(name) {
    const clean = String(name || '').trim();
    if (!clean) return '?';
    const words = clean.split(/\s+/).filter(w => !/^(the|fc|sc|cf|of|and|&)$/i.test(w));
    if (words.length >= 2) {
      const initials = words.map(w => w[0]).join('').toUpperCase();
      if (initials.length >= 2 && initials.length <= 4) return initials;
    }
    const remainder = words.join(' ').trim() || clean;
    return remainder.slice(0, 3).toUpperCase();
  }

  function formatSpreadPoint(point) {
    const n = Number(point);
    if (!Number.isFinite(n)) return '';
    return n > 0 ? `+${n}` : `${n}`;
  }

  function findBookMarket(bookmaker, key) {
    return (bookmaker.markets || []).find(market => market.key === key) || null;
  }

  // Build the two consensus rows for one paired market. pairs is one observation per
  // bookmaker: { book, price1, price2 }. A market is only valid when at least two
  // books provide both sides of the exact same pair. consensusProb is the average of
  // per-book no-vig probabilities; holdPct is the average per-book hold.
  function computePairRows(pairs, side1, side2, market, oddsFormat) {
    const noVig1 = [], noVig2 = [], holds = [], prices1 = [], prices2 = [];
    for (const pair of pairs || []) {
      const ip1 = oddsToImpliedProb(pair.price1, oddsFormat);
      const ip2 = oddsToImpliedProb(pair.price2, oddsFormat);
      if (ip1 == null || ip2 == null) continue;
      const [nv1, nv2] = calcNoVigPair(ip1, ip2);
      if (nv1 == null) continue;
      noVig1.push(nv1);
      noVig2.push(nv2);
      holds.push((ip1 + ip2 - 1) * 100);
      prices1.push({ book: pair.book, price: Number(pair.price1) });
      prices2.push({ book: pair.book, price: Number(pair.price2) });
    }
    const bookCount = noVig1.length;
    if (bookCount < 2) return [];
    const avg = arr => arr.reduce((sum, x) => sum + x, 0) / arr.length;
    const holdPct = avg(holds);
    const makeRow = (side, noVigArr, prices) => {
      const consensusProb = avg(noVigArr);
      const best = pickBestPrice(prices, oddsFormat);
      return {
        market,
        label: side.label,
        sideKey: side.key,
        consensusProb,
        fairAmerican: probToAmerican(consensusProb),
        fairDecimal: probToDecimal(consensusProb),
        bestPrice: best ? best.price : null,
        bestBook: best ? best.book : '',
        evPct: best ? calcEvPct(consensusProb, best.price, oddsFormat) : null,
        bookCount,
        holdPct
      };
    };
    return [makeRow(side1, noVig1, prices1), makeRow(side2, noVig2, prices2)];
  }

  function buildMoneylineRows(event, oddsFormat) {
    let home = event.home_team || '';
    let away = event.away_team || '';
    const pairs = [];
    for (const bk of event.bookmakers || []) {
      const market = findBookMarket(bk, 'h2h');
      // Only two-outcome moneylines are supported (skip 3-way h2h with a draw).
      if (!market || !Array.isArray(market.outcomes) || market.outcomes.length !== 2) continue;
      if (!home && !away) { home = market.outcomes[0].name; away = market.outcomes[1].name; }
      const ho = market.outcomes.find(o => o.name === home);
      const ao = market.outcomes.find(o => o.name === away);
      if (!ho || !ao) continue;
      pairs.push({ book: abbreviateBook(bk.key || bk.title), price1: ho.price, price2: ao.price });
    }
    if (!home || !away) return [];
    const side1 = { key: home, label: `${abbreviateSelection(home)} ML` };
    const side2 = { key: away, label: `${abbreviateSelection(away)} ML` };
    return computePairRows(pairs, side1, side2, 'ML', oddsFormat);
  }

  function buildSpreadRows(event, oddsFormat) {
    const home = event.home_team || '';
    const away = event.away_team || '';
    if (!home || !away) return [];
    // Bucket by spread magnitude; never mix different point values.
    const buckets = new Map();
    for (const bk of event.bookmakers || []) {
      const market = findBookMarket(bk, 'spreads');
      if (!market) continue;
      const ho = (market.outcomes || []).find(o => o.name === home);
      const ao = (market.outcomes || []).find(o => o.name === away);
      if (!ho || !ao) continue;
      const hp = Number(ho.point), ap = Number(ao.point);
      if (!Number.isFinite(hp) || !Number.isFinite(ap)) continue;
      const mag = Math.abs(hp);
      if (!buckets.has(mag)) buckets.set(mag, []);
      buckets.get(mag).push({ book: abbreviateBook(bk.key || bk.title), price1: ho.price, price2: ao.price, homePoint: hp });
    }
    let chosen = null;
    for (const arr of buckets.values()) {
      if (!chosen || arr.length > chosen.length) chosen = arr;
    }
    if (!chosen || chosen.length < 2) return [];
    const homePoint = chosen[0].homePoint;
    const side1 = { key: home, label: `${abbreviateSelection(home)} ${formatSpreadPoint(homePoint)}` };
    const side2 = { key: away, label: `${abbreviateSelection(away)} ${formatSpreadPoint(-homePoint)}` };
    return computePairRows(chosen, side1, side2, 'RL', oddsFormat);
  }

  function buildTotalRows(event, oddsFormat) {
    // Bucket by exact total point; only pair Over/Under from the same number.
    const buckets = new Map();
    for (const bk of event.bookmakers || []) {
      const market = findBookMarket(bk, 'totals');
      if (!market) continue;
      const over = (market.outcomes || []).find(o => /^over$/i.test(o.name || ''));
      const under = (market.outcomes || []).find(o => /^under$/i.test(o.name || ''));
      if (!over || !under) continue;
      const pt = Number(over.point);
      if (!Number.isFinite(pt) || Number(under.point) !== pt) continue;
      if (!buckets.has(pt)) buckets.set(pt, []);
      buckets.get(pt).push({ book: abbreviateBook(bk.key || bk.title), price1: under.price, price2: over.price });
    }
    let chosenPoint = null, chosen = null;
    for (const [pt, arr] of buckets.entries()) {
      if (!chosen || arr.length > chosen.length) { chosen = arr; chosenPoint = pt; }
    }
    if (!chosen || chosen.length < 2) return [];
    const side1 = { key: `U${chosenPoint}`, label: `U ${chosenPoint}` };
    const side2 = { key: `O${chosenPoint}`, label: `O ${chosenPoint}` };
    return computePairRows(chosen, side1, side2, 'TOT', oddsFormat);
  }

  // Merge all valid rows and rank by EV. bestBet is the top positive-EV row (or null).
  function buildBetRows(event, oddsFormat) {
    const fmt = oddsFormat === 'american' ? 'american' : 'decimal';
    const rows = [
      ...buildMoneylineRows(event, fmt),
      ...buildSpreadRows(event, fmt),
      ...buildTotalRows(event, fmt)
    ];
    rows.sort((a, b) => (b.evPct ?? -Infinity) - (a.evPct ?? -Infinity));
    const bestBet = rows
      .filter(row => Number.isFinite(row.evPct) && row.evPct > 0)
      .sort((a, b) => b.evPct - a.evPct)[0] || null;
    return { rows, bestBet, oddsFormat: fmt };
  }

  function stripMarketSuffix(label) {
    return String(label || '').replace(/\s+ML$/, '');
  }

  // Deterministic, rule-based commentary only — no subjective handicapping. Exactly
  // 3 lines when a positive best bet exists; a single fallback line otherwise.
  function buildBetCommentary(bestBet, rows) {
    if (!bestBet) return ['No current line beats fair value from the available snapshot.'];
    const lines = [];
    if (bestBet.market === 'ML') {
      lines.push(`Consensus favors ${stripMarketSuffix(bestBet.label)} on the moneyline.`);
    } else if (bestBet.market === 'RL') {
      lines.push(`Consensus supports ${bestBet.label} against the current spread.`);
    } else {
      lines.push(`Consensus leans ${bestBet.label}.`);
    }
    lines.push(`Best available price beats fair value by ${bestBet.evPct.toFixed(1)}% EV.`);

    const secondary = rows
      .filter(row => row !== bestBet && Number.isFinite(row.evPct) && row.evPct > 0)
      .sort((a, b) => b.evPct - a.evPct)
      .slice(0, 2);
    if (secondary.length === 2) {
      lines.push(`Secondary value exists on ${secondary[0].label} and ${secondary[1].label}, but both trail the ${bestBet.market}.`);
    } else if (secondary.length === 1) {
      lines.push(`Secondary value exists on ${secondary[0].label}, but it trails the ${bestBet.market}.`);
    } else {
      lines.push('No secondary market currently clears fair value.');
    }
    return lines;
  }
  // ODDS_ANALYSIS_CORE_END

  // Single, explicit full-markets pull for the Odds Analysis panel. One request
  // (h2h,spreads,totals for the configured region/decimal); returns the matched raw
  // event. No history, no extra calls.
  async function pullBetPanelData(match) {
    if (!uiSettings.enableExternalOdds || uiSettings.enabledProviders?.theoddsapi !== true) {
      return { error: 'External odds are disabled.' };
    }
    if (!hasOddsApiKey()) return { error: 'No Odds API key configured.' };
    const sportKey = getOddsApiSportKey(match);
    if (!sportKey) return { error: 'Sport not supported by The Odds API.' };

    const region = getOddsRegion();
    const markets = getSelectedOddsMarkets();
    const cacheKey = `theoddsapi-panel:${sportKey}:${region}:${markets.join(',')}:${ODDS_ODDS_FORMAT}`;
    const ttl = isLiveForOdds(match) ? TTL_ODDS_LIVE : TTL_ODDS_UPCOMING;
    const url = [
      `https://api.the-odds-api.com/v4/sports/${encodeURIComponent(sportKey)}/odds/`,
      `?apiKey=${encodeURIComponent(getOddsApiKey())}`,
      `&regions=${encodeURIComponent(region)}`,
      `&markets=${encodeURIComponent(markets.join(','))}`,
      `&oddsFormat=${encodeURIComponent(ODDS_ODDS_FORMAT)}`
    ].join('');

    const response = await fetchWithCache(
      cacheKey,
      trackByokRequest('theoddsapi', sportKey, 'The Odds API', getOddsPullCost(), () => gmFetchJsonWithMeta(url, {}, 'The Odds API odds request')),
      ttl,
      TTL_ODDS_ERROR
    );
    if (response?.error) return { error: response.error };

    const matched = findOddsApiEvent(match, Array.isArray(response.data) ? response.data : []);
    if (!matched?.event) return { error: 'No matching event in The Odds API snapshot.' };
    return { event: matched.event };
  }

  function updateBetPanelSection(match) {
    updateDetailsSection(getEnrichment(match).matchKey, 'bettingPanel');
  }

  async function handleBetPull(match) {
    const enrichment = getEnrichment(match);
    enrichment.betPanel = { loading: true };
    updateBetPanelSection(match);
    try {
      const result = await pullBetPanelData(match);
      if (result.error) {
        enrichment.betPanel = { error: result.error };
      } else {
        const { rows, bestBet, oddsFormat } = buildBetRows(result.event, ODDS_ODDS_FORMAT);
        enrichment.betPanel = { rows, bestBet, oddsFormat, updatedAt: Date.now() };
        saveCachedBetPanel(match, enrichment.betPanel);
      }
    } catch (e) {
      enrichment.betPanel = { error: e?.message || 'Odds pull failed.' };
    }
    updateBetPanelSection(match);
  }

  // -- Staged per-match fallback -------------------------------------------------

  async function findScoreForMatch(match, context = {}) {
    const providers = getProviderPriority(match);
    const tried  = [];
    const errors = [];
    const diagnostics = [];
    const statusDiagnostics = [];
    const parserDiagnostics = [];

    for (const providerKey of providers) {
      tried.push(providerKey);
      try {
        let result = null;
        if      (providerKey === 'espn')        result = await _findEspn(match);
        else if (providerKey === 'espncricinfo') result = await _findEspnCricinfo(match);
        else if (providerKey === 'apifootball') result = await _findApiFootball(match, context);
        else if (providerKey === 'apisports')   result = await _findApiSports(match, context);
        else if (providerKey === 'sofascore')   result = await _findSofascore(match);
        else if (providerKey === 'livescore')   result = await _findLivescore(match);
        else if (providerKey === 'thescore')    result = await _findThescore(match);
        else if (providerKey === 'bbcsport')    result = await _findBbc(match);
        else if (providerKey === 'pandascore')  result = await _findPandaScore(match, context);

        if (result?.found) {
          diagnostics.push(...(result.candidateDiagnostics || []));
          statusDiagnostics.push(...(result.statusDiagnostics || []));
          parserDiagnostics.push(...(result.parserDiagnostics || []));
          recordDebugEvent('score-found', {
            match: match?.name || '',
            providerKey,
            detail: result.detail || '',
            statusDiagnostics: result.statusDiagnostics || []
          });
          debugLog(`Score found via ${providerKey} for "${match.name}"`);
          return { ...result, providersTried: tried, providerErrors: errors, providerDiagnostics: diagnostics, statusDiagnostics, parserDiagnostics };
        }
        if (result?.detail) {
          errors.push(result.detail);
          diagnostics.push(...(result.candidateDiagnostics || []));
          statusDiagnostics.push(...(result.statusDiagnostics || []));
          parserDiagnostics.push(...(result.parserDiagnostics || []));
          recordDebugEvent('score-provider-unmatched', {
            match: match?.name || '',
            providerKey,
            detail: result.detail,
            candidateDiagnostics: result.candidateDiagnostics || [],
            parserDiagnostics: result.parserDiagnostics || [],
            statusDiagnostics: result.statusDiagnostics || []
          });
        }
      } catch (e) {
        errors.push(`${providerKey}: ${e.message}`);
        recordDebugEvent('score-provider-exception', {
          match: match?.name || '',
          providerKey,
          error: e
        });
        debugLog(`Provider ${providerKey} threw for "${match.name}":`, e.message);
      }
    }

    recordDebugEvent('score-unmatched', {
      match: match?.name || '',
      providersTried: tried,
      providerErrors: errors,
      providerDiagnostics: diagnostics,
      parserDiagnostics,
      statusDiagnostics
    });
    return {
      found:          false,
      detail:         errors.join(' | ') || 'No Games Matched',
      unmatched:      true,
      providersTried: tried,
      providerErrors: errors,
      providerDiagnostics: diagnostics,
      parserDiagnostics,
      statusDiagnostics
    };
  }

  // -- Panel state helpers -------------------------------------------------------

  function renderPoweredBySources(sourceKeys) {
    return sourceKeys.filter(sourceKey => sourceKey && sourceKey !== 'torn').map(sourceKey => {
      const label = SOURCE_LABELS[sourceKey] || sourceKey;
      const icon = SOURCE_ICONS[sourceKey];
      if (icon) {
        return `<span class="tm-bookie-source-badge tm-bookie-source-icon-badge tm-bookie-source-${escapeHtml(sourceKey)}" title="${escapeHtml(label)}"><img class="tm-bookie-source-icon" src="${escapeHtml(icon)}" alt="${escapeHtml(label)}"></span>`;
      }
      return `<span class="tm-bookie-source-badge tm-bookie-source-${escapeHtml(sourceKey)}">${escapeHtml(label)}</span>`;
    }).join('');
  }

  function updateHeaderSources(sourceKeys) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const sourceContainer = panel.querySelector('.tm-bookie-source-list');
    if (!sourceContainer) return;
    sourceContainer.innerHTML = renderPoweredBySources(sourceKeys);
    panel.classList.toggle('tm-no-powered-sources', !sourceContainer.innerHTML);
  }

  function applyPanelClasses() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove(
      'tm-theme-default', 'tm-theme-bloody', 'tm-theme-cyberpunk', 'tm-theme-light', 'tm-theme-c64',
      'tm-layout-right', 'tm-layout-left', 'tm-hide-powered'
    );
    panel.classList.add(`tm-theme-${uiSettings.theme || 'default'}`);
    panel.classList.add(`tm-layout-${uiSettings.layoutSide || 'right'}`);
    if (!uiSettings.showPoweredBy) panel.classList.add('tm-hide-powered');
  }

  function updatePanelHiddenState() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    applyPanelClasses();
    panel.classList.toggle('tm-bookie-panel-hidden', isPanelHidden);
    const button = panel.querySelector('.tm-bookie-panel-toggle');
    if (!button) return;
    const isLeft = uiSettings.layoutSide === 'left';
    button.textContent = isPanelHidden ? (isLeft ? '⟫' : '⟪') : (isLeft ? '⟪' : '⟫');
    button.title = isPanelHidden ? 'Show scores panel' : 'Hide scores panel';
    button.setAttribute('aria-label', button.title);
  }

  function togglePanelHidden() {
    isPanelHidden = !isPanelHidden;
    if (isPanelHidden) hideDetailsPanel(true);
    updatePanelHiddenState();
  }

  function setRefreshMode(mode) {
    if (!Object.prototype.hasOwnProperty.call(REFRESH_OPTIONS, mode)) return;
    refreshMode = mode;
    if (refreshIntervalId) { clearInterval(refreshIntervalId); refreshIntervalId = null; }
    const ms = REFRESH_OPTIONS[refreshMode];
    if (ms > 0) refreshIntervalId = setInterval(refreshPanel, ms);
    updateRefreshButtons();
  }

  function updateRefreshButtons() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.querySelectorAll('.tm-bookie-refresh-mode').forEach(button => {
      button.classList.toggle('is-active', button.dataset.mode === refreshMode);
    });
  }

  function getActionNoticeIcon(type) {
    if (type === 'success') return '✓';
    if (type === 'warning') return '!';
    if (type === 'error') return '!';
    if (type === 'loading') return '';
    return 'i';
  }

  function showActionNotice({ type = 'info', title = '', detail = '', timeoutMs } = {}) {
    const normalizedType = ['success', 'info', 'warning', 'error', 'loading'].includes(type) ? type : 'info';
    const isAssertive = normalizedType === 'warning' || normalizedType === 'error';
    const noticeTimeout = Number.isFinite(timeoutMs)
      ? timeoutMs
      : (isAssertive ? 3500 : 2200);
    document.getElementById(TOAST_ID)?.remove();

    const notice = document.createElement('div');
    notice.id = TOAST_ID;
    notice.className = [
      'tm-bookie-action-notice',
      `tm-notice-${normalizedType}`,
      `tm-layout-${uiSettings.layoutSide === 'left' ? 'left' : 'right'}`,
      `tm-theme-${uiSettings.theme || 'default'}`
    ].join(' ');
    notice.setAttribute('role', isAssertive ? 'alert' : 'status');
    notice.setAttribute('aria-live', isAssertive ? 'assertive' : 'polite');

    const icon = document.createElement('div');
    icon.className = 'tm-bookie-notice-icon';
    icon.textContent = getActionNoticeIcon(normalizedType);

    const copy = document.createElement('div');
    copy.className = 'tm-bookie-notice-copy';

    const titleNode = document.createElement('div');
    titleNode.className = 'tm-bookie-notice-title';
    titleNode.textContent = title || (isAssertive ? 'Action failed' : 'Action complete');

    const detailNode = document.createElement('div');
    detailNode.className = 'tm-bookie-notice-detail';
    detailNode.textContent = detail || '';
    if (detail) detailNode.title = detail;

    copy.appendChild(titleNode);
    if (detail) copy.appendChild(detailNode);
    notice.appendChild(icon);
    notice.appendChild(copy);

    const progress = document.createElement('div');
    progress.className = 'tm-bookie-notice-progress';
    notice.appendChild(progress);

    document.body.appendChild(notice);
    if (normalizedType !== 'loading' && noticeTimeout > 0) {
      setTimeout(() => {
        if (notice.isConnected) notice.remove();
      }, noticeTimeout);
    }
    return notice;
  }

  function parseLegacyToastMessage(msg, isError) {
    const text = String(msg || '');
    const copiedMatch = text.match(/^Copied(?: compact| enriched)?:\s*(.+)$/i);
    if (copiedMatch) {
      const isCompact = /compact|enriched/i.test(text);
      return {
        type: 'success',
        title: isCompact ? 'Copied compact text' : 'Copied full game',
        detail: copiedMatch[1]
      };
    }
    if (/External analysis unavailable/i.test(text)) {
      return {
        type: 'warning',
        title: 'Copied compact text',
        detail: 'External analysis unavailable, original game copied'
      };
    }
    if (/Copy failed|Could not copy/i.test(text)) {
      return {
        type: 'error',
        title: 'Copy failed',
        detail: /console/i.test(text) ? 'Clipboard blocked. Output was written to the console.' : text
      };
    }
    return {
      type: isError ? 'error' : 'success',
      title: text,
      detail: ''
    };
  }

  function toast(msg, isError) {
    showActionNotice(parseLegacyToastMessage(msg, isError));
  }

  function setButtonActionState(button, state, label, options = {}) {
    if (!button) return;
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent || '';
    button.classList.remove('is-loading', 'is-success', 'is-error', 'is-disabled');
    if (state && state !== 'idle') button.classList.add(`is-${state}`);
    if (label) button.textContent = label;
    const shouldDisable = state === 'loading' || state === 'disabled' || options.disabled === true;
    button.disabled = shouldDisable;
    button.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  }

  function restoreButtonActionState(button, delayMs = 1600) {
    if (!button) return;
    const restore = () => {
      if (!button.isConnected) return;
      button.classList.remove('is-loading', 'is-success', 'is-error', 'is-disabled');
      button.disabled = false;
      button.setAttribute('aria-busy', 'false');
      button.textContent = button.dataset.originalLabel || button.textContent;
    };
    if (delayMs > 0) setTimeout(restore, delayMs);
    else restore();
  }

  // -- Scoreboard renderers ------------------------------------------------------

  function renderScoreboard(match) {
    const score = match.score;
    if (!score?.found) {
      return `<div class="tm-bookie-unmatched">Score not matched: ${escapeHtml(score?.detail || 'No Games Matched')}</div>`;
    }
    if (uiSettings.scoreboardStyle === 'minimal') return renderMinimalScoreboard(match, score);
    if (uiSettings.scoreboardStyle === 'classic') return renderClassicScoreboard(match, score);
    return renderCompactScoreboard(match, score);
  }

  function renderCompactScoreboard(match, score) {
    return `
      <div class="tm-bookie-scoreboard tm-bookie-scoreboard-compact">
        <div class="tm-bookie-team-row">
          <span class="tm-bookie-team-name">${escapeHtml(match.team1)}</span>
          <span class="tm-bookie-team-score">${escapeHtml(String(score.team1Score))}</span>
        </div>
        <div class="tm-bookie-team-row">
          <span class="tm-bookie-team-name">${escapeHtml(match.team2)}</span>
          <span class="tm-bookie-team-score">${escapeHtml(String(score.team2Score))}</span>
        </div>
      </div>`;
  }

  function renderClassicScoreboard(match, score) {
    return `
      <div class="tm-bookie-scoreboard tm-bookie-scoreboard-classic">
        <div class="tm-bookie-team-row">
          <span class="tm-bookie-team-name">${escapeHtml(match.team1)}</span>
          <span class="tm-bookie-team-score">${escapeHtml(String(score.team1Score))}</span>
        </div>
        <div class="tm-bookie-team-row">
          <span class="tm-bookie-team-name">${escapeHtml(match.team2)}</span>
          <span class="tm-bookie-team-score">${escapeHtml(String(score.team2Score))}</span>
        </div>
      </div>`;
  }

  function renderMinimalScoreboard(match, score) {
    const statusText = score.detail || match.status || '';
    const betHtml = uiSettings.showBetAmount
      ? `<span class="tm-bookie-minimal-bet">${escapeHtml(formatMoney(match.amount))}</span>`
      : '';
    return `
      <div class="tm-bookie-scoreboard tm-bookie-scoreboard-minimal">
        <div class="tm-bookie-minimal-score-line">
          <span class="tm-bookie-minimal-team">${escapeHtml(match.team1)}</span>
          <span class="tm-bookie-minimal-score">${escapeHtml(String(score.team1Score))} - ${escapeHtml(String(score.team2Score))}</span>
          <span class="tm-bookie-minimal-team">${escapeHtml(match.team2)}</span>
        </div>
        ${(statusText || betHtml) ? `
        <div class="tm-bookie-minimal-status-row">
          <span class="tm-bookie-minimal-status">${escapeHtml(statusText)}</span>
          ${betHtml}
        </div>` : ''}
      </div>`;
  }

  // -- Match row renderers -------------------------------------------------------

  function getConfidenceLabel(match) {
    const confidence = Number(match?.score?.confidence || 0);
    if (!confidence) return '';
    if (confidence >= 95) return 'exact';
    if (confidence >= CONFIDENCE_THRESHOLD) return 'likely';
    return '';
  }

  function getMatchRowState(match, selectedSummary = null) {
    const matchKey = makeMatchKey(match);
    const isUnmatched = match.sectionType === 'live' && !match.score?.found;
    const statusKind = isUnmatched
      ? 'unmatched'
      : (match.sectionType === 'upcoming' ? 'upcoming' : 'live');
    return {
      matchKey,
      isTornSelected: !!(selectedSummary?.matchKey && selectedSummary.matchKey === matchKey),
      isDetailsActive: activeDetailsMatchKey === matchKey,
      isPinned: isLiveMatchPinned(match),
      isUnmatched,
      statusKind,
      sourceLabel: match.score?.sourceLabel || match.sourceLabel || '',
      confidenceLabel: getConfidenceLabel(match)
    };
  }

  function renderMatchStatusPills(match, rowState) {
    const pills = [];
    const statusLabel = rowState.statusKind === 'unmatched'
      ? 'Unmatched'
      : (rowState.statusKind === 'upcoming' ? 'Upcoming' : 'Live');
    pills.push(`<span class="tm-bookie-row-pill tm-pill-${escapeHtml(rowState.statusKind)}">${escapeHtml(statusLabel)}</span>`);
    if (uiSettings.showSourceInRows && rowState.sourceLabel) {
      pills.push(`<span class="tm-bookie-row-pill tm-pill-source">${escapeHtml(rowState.sourceLabel)}</span>`);
    }
    if (rowState.confidenceLabel) {
      pills.push(`<span class="tm-bookie-row-pill tm-pill-confidence">${escapeHtml(rowState.confidenceLabel)}</span>`);
    }
    return pills.length ? `<div class="tm-bookie-row-pills">${pills.join('')}</div>` : '';
  }

  function getMatchRowClassNames(baseClasses, rowState) {
    const classes = [...baseClasses];
    if (rowState.isTornSelected) classes.push('tm-row-selected');
    if (rowState.isDetailsActive) classes.push('tm-row-details-active');
    if (rowState.isPinned) classes.push('tm-row-pinned');
    if (rowState.isUnmatched) classes.push('tm-row-unmatched');
    return classes.join(' ');
  }

  function renderLivePinButton(match, rowState) {
    if (!rowState.matchKey) return '';
    const title = `${rowState.isPinned ? 'Unpin' : 'Pin'} ${match.name || 'live match'}`;
    return `<button class="tm-live-pin-btn${rowState.isPinned ? ' is-pinned' : ''}" type="button" data-match-key="${escapeHtml(rowState.matchKey)}" aria-pressed="${rowState.isPinned ? 'true' : 'false'}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">📌</button>`;
  }

  function renderDetailsButton(match, rowState) {
    if (!uiSettings.showDetailsButtons || uiSettings.detailsPosition === 'off') return '';
    const title = `${rowState.isDetailsActive ? 'Close' : 'Open'} details for ${match.name || 'selected match'}`;
    return `<button class="tm-bookie-details-btn${rowState.isDetailsActive ? ' tm-details-active' : ''}" type="button" data-match-key="${escapeHtml(rowState.matchKey)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">⋯</button>`;
  }

  function renderLiveMatch(match, selectedSummary = null) {
    const scoreHtml = renderScoreboard(match);
    const metaParts = [match.sport, match.stage];
    const rowState = getMatchRowState(match, selectedSummary);
    if (uiSettings.showSourceInRows) metaParts.push(rowState.sourceLabel);
    const pinBtn = renderLivePinButton(match, rowState);
    const detailsBtn = renderDetailsButton(match, rowState);
    const pillHtml = renderMatchStatusPills(match, rowState);
    const rowClasses = getMatchRowClassNames(['tm-bookie-row', 'tm-bookie-live-row'], rowState);

    const hideStatusLine = uiSettings.scoreboardStyle === 'minimal' && match.score?.found;
    return `
      <div class="${escapeHtml(rowClasses)}" data-event-id="${escapeHtml(match.tornId)}" data-match-key="${escapeHtml(rowState.matchKey)}">
        <div class="tm-bookie-title-row">
          <div class="tm-bookie-title-stack">
            <div class="tm-bookie-title tm-bookie-live-title">${escapeHtml(match.name)}</div>
            ${pillHtml}
          </div>
          <div class="tm-bookie-row-actions">${pinBtn}${detailsBtn}</div>
        </div>
        ${scoreHtml}
        <div class="tm-bookie-meta">${escapeHtml(metaParts.filter(Boolean).join(' - '))}</div>
        ${hideStatusLine ? '' : `
        <div class="tm-bookie-status-line">
          <span class="tm-bookie-status">${escapeHtml(match.score?.detail || match.status)}</span>
          ${uiSettings.showBetAmount ? `<span class="tm-bookie-amount"><span class="tm-bookie-bet-label">Bet:</span> ${formatMoney(match.amount)}</span>` : ''}
        </div>`}
      </div>`;
  }

  function renderUpcomingMatch(match, selectedSummary = null) {
    const metaParts = [match.sport, match.stage];
    const rowState = getMatchRowState(match, selectedSummary);
    if (uiSettings.showSourceInRows) metaParts.push(rowState.sourceLabel);
    const detailsBtn = renderDetailsButton(match, rowState);
    const pillHtml = renderMatchStatusPills(match, rowState);
    const rowClasses = getMatchRowClassNames(['tm-bookie-row', 'tm-bookie-upcoming-row-card'], rowState);

    return `
      <div class="${escapeHtml(rowClasses)}" data-event-id="${escapeHtml(match.tornId)}" data-match-key="${escapeHtml(rowState.matchKey)}">
        <div class="tm-bookie-title-row">
          <div class="tm-bookie-title-stack">
            <div class="tm-bookie-title">${escapeHtml(match.name)}</div>
            ${pillHtml}
          </div>
          <div class="tm-bookie-row-actions">${detailsBtn}</div>
        </div>
        <div class="tm-bookie-meta">${escapeHtml(metaParts.filter(Boolean).join(' - '))}</div>
        <div class="tm-bookie-status-line">
          <span class="tm-bookie-status">Starts ${escapeHtml(formatStartTime(match.startTimestamp))}</span>
          ${uiSettings.showBetAmount ? `<span class="tm-bookie-amount"><span class="tm-bookie-bet-label">Bet:</span> ${formatMoney(match.amount)}</span>` : ''}
        </div>
      </div>`;
  }

  function renderSportGroups(sectionType, sectionTitle, matches, renderMatchFn) {
    if (!matches.length) return '';
    const groups = groupMatchesBySport(matches);
    return `
      <div class="tm-bookie-section-title">${escapeHtml(sectionTitle)}</div>
      ${groups.map(group => {
        const isCollapsed = isSportGroupCollapsed(sectionType, group.sportKey);
        const caret = isCollapsed ? '▸' : '▾';
        const countLabel = group.matches.length === 1 ? '1 bet' : `${group.matches.length} bets`;
        const groupMatches = sectionType === 'live'
          ? sortLiveMatchesForPins(group.matches)
          : group.matches;
        return `
          <div class="tm-bookie-sport-group" data-section-type="${escapeHtml(sectionType)}" data-sport-key="${escapeHtml(group.sportKey)}">
            <button class="tm-bookie-sport-header" type="button" data-section-type="${escapeHtml(sectionType)}" data-sport-key="${escapeHtml(group.sportKey)}">
              <span class="tm-bookie-sport-left">
                <span class="tm-bookie-caret">${caret}</span>
                <span class="tm-bookie-sport-name">${escapeHtml(group.sportLabel)}</span>
              </span>
              <span class="tm-bookie-sport-count">${escapeHtml(countLabel)}</span>
            </button>
            ${isCollapsed ? '' : groupMatches.map(renderMatchFn).join('')}
          </div>`;
      }).join('')}`;
  }

  // -- Details panel -------------------------------------------------------------

  function getBetImpliedOutcomes(match) {
    if (!Array.isArray(match.bets) || !match.bets.length) return [];
    const results = [];
    for (const bet of match.bets) {
      const { marketTitle, selectionTitle, odds } = bet;
      if (!odds || !selectionTitle) continue;
      let impliedProb = null;
      const o = parseFloat(odds);
      if (!isNaN(o)) {
        if (o > 0)      impliedProb = 100 / (o + 100);
        else if (o < 0) impliedProb = Math.abs(o) / (Math.abs(o) + 100);
      }
      results.push({ market: marketTitle || 'Unknown Market', selection: selectionTitle, odds, impliedProb });
    }
    return results;
  }

  function parseOddsToDecimal(odds, mult) {
    const decimalFromMult = parseMult(mult);
    if (decimalFromMult && decimalFromMult > 1) return decimalFromMult;

    const raw = String(odds || '').trim();
    const fractional = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (fractional) {
      const numerator = Number(fractional[1]);
      const denominator = Number(fractional[2]);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
        return 1 + (numerator / denominator);
      }
    }

    const decimal = Number(raw);
    if (/^\d+(?:\.\d+)$/.test(raw) && Number.isFinite(decimal) && decimal > 1) return decimal;

    const american = Number(raw.replace(/^\+/, ''));
    if (!Number.isFinite(american) || american === 0) return null;
    if (american > 0) return 1 + (american / 100);
    return 1 + (100 / Math.abs(american));
  }

  function getTornExpectationMarkets(match) {
    const grouped = new Map();
    for (const bet of match?.bets || []) {
      const marketName = bet.marketTitle || bet.market || bet.name || 'Torn Market';
      const selection = bet.selectionTitle || bet.selection || bet.desc || '';
      const decimalOdds = parseOddsToDecimal(bet.odds, bet.mult);
      if (!grouped.has(marketName)) grouped.set(marketName, { total: 0, outcomes: [] });
      const group = grouped.get(marketName);
      group.total += 1;
      if (!selection || !decimalOdds || decimalOdds <= 1) continue;
      group.outcomes.push({
        market: marketName,
        selection,
        decimalOdds,
        rawImpliedProbability: roundNumber(1 / decimalOdds, 4),
        normalizedProbability: null,
        sourceKey: 'torn',
        sourceLabel: 'Torn odds'
      });
    }

    return [...grouped.entries()].map(([marketName, group]) => {
      const outcomes = group.outcomes;
      const complete = outcomes.length > 1 && outcomes.length === group.total && outcomes.every(outcome => outcome.rawImpliedProbability != null);
      const rawSum = outcomes.reduce((sum, outcome) => sum + (outcome.rawImpliedProbability || 0), 0);
      if (complete && rawSum > 0) {
        outcomes.forEach(outcome => {
          outcome.normalizedProbability = roundNumber(outcome.rawImpliedProbability / rawSum, 4);
        });
      }
      return {
        sourceKey: 'torn',
        sourceLabel: 'Torn odds',
        market: marketName,
        complete,
        partial: !complete,
        outcomes
      };
    }).filter(market => market.outcomes.length);
  }

  function computeExpectation(enrichment, match) {
    const tornMarkets = getTornExpectationMarkets(match);
    const markets = [...tornMarkets];
    const outcomes = markets.flatMap(market => market.outcomes.map(outcome => ({
      ...outcome,
      market: market.market,
      partialMarket: market.partial
    })));
    const methods = [];
    if (tornMarkets.length) methods.push('Torn odds converted to raw implied probability; normalized only within complete Torn markets.');

    enrichment.expectation = {
      found: outcomes.length > 0,
      markets,
      outcomes,
      method: methods.join(' '),
      generatedAt: Date.now(),
      updatedAt: Date.now()
    };
    return enrichment.expectation;
  }

  function findExpectationMarket(enrichment, sourceKey) {
    return (enrichment?.expectation?.markets || []).find(market => market.sourceKey === sourceKey && market.outcomes?.length);
  }

  function buildCommentary(enrichment) {
    const commentary = {
      summary: [],
      supportingFactors: [],
      riskFactors: [],
      generatedAt: Date.now(),
      updatedAt: Date.now()
    };
    const identity = enrichment.identity || {};
    const score = enrichment.score || {};
    const stats = enrichment.teamStats || {};
    const h2h = enrichment.headToHead || {};
    const expectation = enrichment.expectation || {};

    if (score.found) {
      const scoreLine = `${identity.team1 || 'Team 1'} ${score.team1Score ?? '-'} - ${score.team2Score ?? '-'} ${identity.team2 || 'Team 2'}`;
      commentary.summary.push(`${scoreLine}${score.detail ? ` (${score.detail})` : ''}.`);
      const factUrl = safeExternalSourceUrl(score.sourceUrl);
      if (factUrl) commentary.factLink = { label: score.sourceLabel || 'Source', url: factUrl };
    } else if (identity.startTimestamp) {
      commentary.summary.push(`Match fact: scheduled for ${formatStartTime(identity.startTimestamp)}.`);
    }

    if (stats.found) {
      commentary.summary.push(`Team snapshot facts are available from ${stats.sourceLabel || 'the stats provider'}${stats.updatedAt ? ` as of ${new Date(stats.updatedAt).toLocaleTimeString()}` : ''}.`);
      const firstStats = (stats.teams || []).map(team => team.summary || team.name || '').filter(Boolean).slice(0, 2);
      firstStats.forEach(item => commentary.supportingFactors.push(`${item}.`));
    }

    if (h2h.found) {
      commentary.supportingFactors.push(`Head-to-head data is available from ${h2h.sourceLabel || 'the H2H provider'}.`);
    }

    if (expectation.found) {
      const tornMarket = findExpectationMarket(enrichment, 'torn');
      if (tornMarket) {
        commentary.supportingFactors.push(`Calculated values include Torn raw implied probabilities for ${tornMarket.market}.`);
        if (tornMarket.partial) commentary.riskFactors.push(`Torn market "${tornMarket.market}" is incomplete or partly unparseable, so raw probabilities are shown without normalization.`);
      }
    }

    enrichment.commentary = commentary;
    return commentary;
  }

  function renderExpectedOutcome(bet) {
    if (bet.impliedProb === null) return '';
    const pct = Math.round(bet.impliedProb * 100);
    const barWidth = Math.min(100, Math.max(0, pct));
    return `
      <div class="tm-det-prob-row">
        <span class="tm-det-prob-label">${escapeHtml(bet.selection)}</span>
        <span class="tm-det-prob-pct">${pct}%</span>
        <div class="tm-det-prob-bar-bg">
          <div class="tm-det-prob-bar-fill" style="width:${barWidth}%"></div>
        </div>
      </div>`;
  }

  function buildGameCommentary(match) {
    const lines = [];
    lines.push(`<strong>${escapeHtml(match.name)}</strong>`);
    if (match.score?.found) {
      if (match.score.venue) lines.push(`<span class="tm-det-venue">📍 ${escapeHtml(match.score.venue)}</span>`);
      if (match.score.detail) lines.push(`<span class="tm-det-status">${escapeHtml(match.score.detail)}</span>`);
    } else {
      lines.push(`<span class="tm-det-no-score">${escapeHtml(match.score?.detail || 'Score unavailable')}</span>`);
    }
    return lines.join('<br>');
  }

  function renderDetailsRows(match) {
    const rows = [];
    if (match.score?.found) {
      rows.push(`
        <div class="tm-det-row tm-det-score-row">
          <span class="tm-det-team">${escapeHtml(match.team1 || '?')}</span>
          <span class="tm-det-score-val">${escapeHtml(String(match.score.team1Score ?? '-'))}</span>
          <span class="tm-det-dash">–</span>
          <span class="tm-det-score-val">${escapeHtml(String(match.score.team2Score ?? '-'))}</span>
          <span class="tm-det-team tm-det-team-r">${escapeHtml(match.team2 || '?')}</span>
        </div>`);
    }
    const infoItems = [match.sport, match.league, match.stage].filter(Boolean);
    if (infoItems.length) rows.push(`<div class="tm-det-row tm-det-info-row">${escapeHtml(infoItems.join(' - '))}</div>`);
    if (!match.score?.found && match.startTimestamp) {
      rows.push(`<div class="tm-det-row tm-det-starts-row">Starts ${escapeHtml(formatStartTime(match.startTimestamp))}</div>`);
    }
    return rows.join('');
  }

  function renderDetailsBets(match) {
    const outcomes = getBetImpliedOutcomes(match);
    if (!outcomes.length) return '<div class="tm-det-no-bets">No bets found</div>';
    return `<div class="tm-det-bets-list">${outcomes.map(bet => `
      <div class="tm-det-bet-block">
        <div class="tm-det-bet-market">${escapeHtml(bet.market)}</div>
        <div class="tm-det-bet-sel">${escapeHtml(bet.selection)} <span class="tm-det-odds">(${escapeHtml(String(bet.odds))})</span></div>
        ${renderExpectedOutcome(bet)}
      </div>`).join('')}</div>`;
  }

  const DETAILS_SECTIONS = [
    'teamStats',
    'commentary',
    'bettingPanel',
    'sources'
  ];

  const DETAILS_SECTION_LABELS = {
    identity: 'Match',
    score: 'Score',
    teamStats: 'Team Snapshot',
    commentary: 'Commentary',
    bettingPanel: 'Odds Analysis',
    sources: 'Sources'
  };

  function renderDetailsStatus(text) {
    return `<div class="tm-det-status-note">${escapeHtml(text)}</div>`;
  }

  function renderDetailsSkeletonRows(rowCount = 3) {
    const safeCount = Math.max(1, Math.min(5, Number(rowCount) || 3));
    return `<div class="tm-det-skeleton" aria-hidden="true">${Array.from({ length: safeCount }, () => '<div class="tm-det-skeleton-row"></div>').join('')}</div>`;
  }

  function renderDetailsSkeleton(sectionName) {
    if (sectionName === 'bettingPanel') return renderDetailsSkeletonRows(4);
    if (sectionName === 'teamStats' || sectionName === 'commentary') return renderDetailsSkeletonRows(3);
    return renderDetailsSkeletonRows(2);
  }

  function renderDetailsList(items) {
    const visible = (items || []).filter(Boolean);
    if (!visible.length) return renderDetailsStatus('Not available.');
    return `<ul class="tm-det-list">${visible.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function renderDetailsSourceLine(sourceLabel, updatedAt) {
    if (!sourceLabel) return '';
    const time = updatedAt ? ` - ${new Date(updatedAt).toLocaleTimeString()}` : '';
    return `<div class="tm-det-source-line">${escapeHtml(sourceLabel)}${escapeHtml(time)}</div>`;
  }

  function sourceStatus(label, section, ttl) {
    if (!section?.sourceLabel) return '';
    const state = isFresh(section, ttl) ? 'fresh' : 'cached';
    const time = section.updatedAt ? ` retrieved ${new Date(section.updatedAt).toLocaleTimeString()}` : '';
    return `${label}: ${section.sourceLabel}${time} (${state})`;
  }

  function renderCommentaryGroup(title, items) {
    const visible = (items || []).filter(Boolean);
    if (!visible.length) return '';
    return `
      <div class="tm-det-commentary-group">
        <div class="tm-det-commentary-label">${escapeHtml(title)}</div>
        ${renderDetailsList(visible)}
      </div>`;
  }

  // Facts group renders like renderCommentaryGroup, but when a deep source link is
  // available it is shown right-aligned on the first (score) line so the user can
  // open the exact page the fact came from.
  function renderCommentaryFactsGroup(items, factLink) {
    const visible = (items || []).filter(Boolean);
    if (!visible.length) return '';
    const lis = visible.map((item, idx) => {
      if (idx === 0 && factLink?.url) {
        return `<li class="tm-det-fact-row"><span class="tm-det-fact-text">${escapeHtml(item)}</span><a class="tm-det-fact-source" href="${escapeHtml(factLink.url)}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(factLink.label)} source">${escapeHtml(factLink.label)} ↗</a></li>`;
      }
      return `<li>${escapeHtml(item)}</li>`;
    }).join('');
    return `
      <div class="tm-det-commentary-group">
        <div class="tm-det-commentary-label">Facts</div>
        <ul class="tm-det-list">${lis}</ul>
      </div>`;
  }

  function renderCommentary(commentary) {
    if (!commentary) return renderDetailsStatus('Not available.');
    const html = [
      renderCommentaryFactsGroup(commentary.summary, commentary.factLink),
      renderCommentaryGroup('Supporting Factors', commentary.supportingFactors),
      renderCommentaryGroup('Risk Factors', commentary.riskFactors)
    ].filter(Boolean).join('');
    if (!html) return renderDetailsStatus('Not available.');
    return `${html}${commentary.generatedAt ? renderDetailsSourceLine('Deterministic rules', commentary.generatedAt) : ''}`;
  }

  function renderBetPullButton(isRefresh) {
    const cost = getOddsPullCost();
    const label = isRefresh ? 'Refresh odds' : `Pull odds (${cost} credit${cost === 1 ? '' : 's'})`;
    return `<button class="tm-det-bet-pull" type="button">${escapeHtml(label)}</button>`;
  }

  // Renders the deterministic betting-analysis panel for one selected event from
  // already-pulled odds (no fetch here). Decimal is the app's display standard.
  function renderBetPanel(rows, bestBet, oddsFormat) {
    const fmt = oddsFormat === 'american' ? 'american' : 'decimal';
    const priceStr = price => {
      const n = Number(price);
      if (price == null || !Number.isFinite(n)) return '-';
      return fmt === 'american' ? `${n > 0 ? '+' : ''}${Math.round(n)}` : n.toFixed(2);
    };
    const fairStr = row => {
      const v = fmt === 'american' ? row.fairAmerican : row.fairDecimal;
      if (v == null) return '-';
      return fmt === 'american' ? `${v > 0 ? '+' : ''}${v}` : Number(v).toFixed(2);
    };
    const evStr = row => Number.isFinite(row.evPct) ? `${row.evPct >= 0 ? '+' : ''}${row.evPct.toFixed(1)}` : '-';
    const consStr = row => Number.isFinite(row.consensusProb) ? (row.consensusProb * 100).toFixed(1) : '-';

    const header = { bet: 'Bet', cons: 'Cons%', fair: 'Fair', best: 'Best', ev: 'EV' };
    const cols = rows.map(row => ({
      bet: row.label,
      cons: consStr(row),
      fair: fairStr(row),
      best: `${priceStr(row.bestPrice)} ${row.bestBook || ''}`.trim(),
      ev: evStr(row)
    }));
    const all = [header, ...cols];
    const w = key => Math.max(...all.map(r => r[key].length));
    const wBet = w('bet'), wCons = w('cons'), wFair = w('fair'), wBest = w('best'), wEv = w('ev');
    const line = r => `${r.bet.padEnd(wBet)}  ${r.cons.padStart(wCons)}  ${r.fair.padStart(wFair)}  ${r.best.padEnd(wBest)}  ${r.ev.padStart(wEv)}`;
    const bodyLines = [line(header), ...cols.map(line)];
    const innerW = Math.max(...bodyLines.map(l => l.length));
    const top = `┌${'─'.repeat(innerW + 2)}┐`;
    const bottom = `└${'─'.repeat(innerW + 2)}┘`;
    const boxed = bodyLines.map(l => `│ ${l.padEnd(innerW)} │`);
    const block = [top, ...boxed, bottom].join('\n');

    const bestText = bestBet
      ? `Best Bet: ${bestBet.label} ${priceStr(bestBet.bestPrice)}${bestBet.bestBook ? ` ${bestBet.bestBook}` : ''}`
      : 'Best Bet: None';
    const meta = bestBet ? `Bk# ${bestBet.bookCount}   Hold ${Number(bestBet.holdPct).toFixed(1)}%` : '';
    const commentary = buildBetCommentary(bestBet, rows);

    return `
      <pre class="tm-det-bet-panel">${escapeHtml(block)}</pre>
      <div class="tm-det-bet-best">${escapeHtml(bestText)}</div>
      ${meta ? `<div class="tm-det-bet-meta">${escapeHtml(meta)}</div>` : ''}
      <div class="tm-det-bet-commentary">${commentary.map(text => `<div>${escapeHtml(text)}</div>`).join('')}</div>`;
  }

  function renderBettingPanelSection(enrichment, match) {
    if (!uiSettings.enableExternalOdds || uiSettings.enabledProviders?.theoddsapi !== true) {
      return renderDetailsStatus('Enable The Odds API in settings to use odds analysis.');
    }
    if (!hasOddsApiKey()) return renderDetailsStatus('Add an Odds API key in settings to use odds analysis.');
    hydrateBetPanelFromCache(match, enrichment);
    const panel = enrichment.betPanel;
    if (panel?.loading) return renderDetailsStatus('Pulling odds…');
    if (panel?.error) return `${renderDetailsStatus(panel.error)}${renderBetPullButton(true)}`;
    if (panel?.rows) {
      if (!panel.rows.length) return `${renderDetailsStatus('No qualifying markets in the current snapshot.')}${renderBetPullButton(true)}`;
      return `${renderBetPanel(panel.rows, panel.bestBet, panel.oddsFormat)}${renderBetPullButton(true)}`;
    }
    const markets = getSelectedOddsMarkets();
    const cost = markets.length;
    return `${renderDetailsStatus(`One pull uses ${cost} credit${cost === 1 ? '' : 's'} (${markets.join(' + ')}, region ${getOddsRegion().toUpperCase()}). Change scope under Odds detail in settings.`)}${renderBetPullButton(false)}`;
  }

  function renderDetailsSectionBody(enrichment, match, sectionName) {
    const section = enrichment?.[sectionName];
    if (enrichment?.loadingSections?.[sectionName]) return renderDetailsSkeleton(sectionName);

    if (sectionName === 'identity') {
      const identity = enrichment.identity || {};
      const lines = [
        identity.name,
        [identity.sportLabel || identity.sport, identity.competition || identity.league, identity.stage]
          .filter(Boolean)
          .join(' - '),
        identity.startTimestamp ? `Starts ${formatStartTime(identity.startTimestamp)}` : identity.status
      ].filter(Boolean);
      return renderDetailsList(lines);
    }

    if (sectionName === 'score') {
      const score = enrichment.score || {};
      if (!score.found) {
        const fallback = uiSettings.enableDebugMode && match?.score?.detail
          ? `Score source did not return this match. (${match.score.detail})`
          : 'Score source did not return this match.';
        return renderDetailsStatus(fallback);
      }
      return `
        <div class="tm-det-row tm-det-score-row">
          <span class="tm-det-team">${escapeHtml(enrichment.identity?.team1 || '?')}</span>
          <span class="tm-det-score-val">${escapeHtml(String(score.team1Score ?? '-'))}</span>
          <span class="tm-det-dash">-</span>
          <span class="tm-det-score-val">${escapeHtml(String(score.team2Score ?? '-'))}</span>
          <span class="tm-det-team tm-det-team-r">${escapeHtml(enrichment.identity?.team2 || '?')}</span>
        </div>
        ${score.detail ? `<div class="tm-det-row tm-det-info-row">${escapeHtml(score.detail)}</div>` : ''}
        ${score.venue ? `<div class="tm-det-row tm-det-info-row">${escapeHtml(score.venue)}</div>` : ''}
        ${renderDetailsSourceLine(score.sourceLabel, score.updatedAt)}`;
    }

    if (sectionName === 'teamStats') {
      if (!section?.found) return renderDetailsStatus('Team snapshot unavailable from the current sources.');
      const stats = [
        ...(section.teams || []).map(team => team.summary || team.name || ''),
        ...(section.recentForm || []).map(form => form.summary || form.label || '')
      ];
      return `${renderDetailsList(stats)}${renderDetailsSourceLine(section.sourceLabel, section.updatedAt)}`;
    }

    if (sectionName === 'headToHead') {
      if (!section?.found) return renderDetailsStatus('Not available.');
      const items = [
        section.summary,
        ...(section.events || []).map(event => event.summary || event.name || '')
      ];
      return `${renderDetailsList(items)}${renderDetailsSourceLine(section.sourceLabel, section.updatedAt)}`;
    }

    if (sectionName === 'commentary') {
      return renderCommentary(enrichment.commentary);
    }

    if (sectionName === 'bettingPanel') {
      return renderBettingPanelSection(enrichment, match);
    }

    if (sectionName === 'sources') {
      const sources = [];
      if (enrichment.score?.found) sources.push(sourceStatus('Score', enrichment.score, TTL_SUCCESS));
      if (enrichment.teamStats?.found) sources.push(sourceStatus('Team stats', enrichment.teamStats, TTL_STATS));
      if (enrichment.providersTried?.length) {
        sources.push(`Tried: ${enrichment.providersTried.join(', ')}`);
      }
      if (uiSettings.enableDebugMode && enrichment.providerErrors?.length) {
        sources.push(`Errors: ${enrichment.providerErrors.map(e => `${e.providerKey}: ${e.message}`).join('; ')}`);
      }
      return renderDetailsList(sources);
    }

    return renderDetailsStatus('Not available.');
  }

  // INVARIANT: all dynamic values escaped before innerHTML
  function renderDetailsSection(enrichment, match, sectionName) {
    const label = DETAILS_SECTION_LABELS[sectionName] || sectionName;
    return `
      <section class="tm-det-section" data-details-section="${escapeHtml(sectionName)}">
        <div class="tm-det-section-title">${escapeHtml(label)}</div>
        <div class="tm-det-section-body">
          ${renderDetailsSectionBody(enrichment, match, sectionName)}
        </div>
      </section>`;
  }

  function renderDetailsHeaderSource(score) {
    if (!score?.found || !score.sourceLabel) return '';
    const label = escapeHtml(score.sourceLabel);
    const sourceUrl = safeExternalSourceUrl(score.sourceUrl);
    if (!sourceUrl) return `<span class="tm-det-header-source">${label}</span>`;
    return `<a class="tm-det-header-source tm-det-header-source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" title="Open ${label} source">${label}</a>`;
  }

  function renderDetailsHeader(enrichment) {
    const identity = enrichment.identity || {};
    const score = enrichment.score || {};
    const sourceLine = renderDetailsHeaderSource(score);
    const meta = [identity.sportLabel || identity.sport, identity.competition || identity.league]
      .filter(Boolean)
      .join(' - ');
    return `
      <div class="tm-det-header">
        <div class="tm-det-heading">
          <div class="tm-det-eyebrow">MATCH DETAILS</div>
          <div class="tm-det-title">${escapeHtml(identity.name || 'Selected match')}</div>
          <div class="tm-det-header-meta">${escapeHtml(meta)}${sourceLine ? ` ${sourceLine}` : ''}</div>
        </div>
        <button class="tm-det-close" type="button" title="Close details" aria-label="Close details">x</button>
      </div>`;
  }

  function renderDetailsSummaryStrip(enrichment, match) {
    const identity = enrichment.identity || {};
    const score = enrichment.score || {};
    const scoreSummary = score.found
      ? `${identity.team1 || '?'} ${score.team1Score ?? '-'} - ${score.team2Score ?? '-'} ${identity.team2 || '?'}`
      : (identity.startTimestamp ? `Starts ${formatStartTime(identity.startTimestamp)}` : (match?.status || 'Score pending'));
    const sourceSummary = score.found
      ? `${score.sourceLabel || 'Matched source'}${score.updatedAt ? ` - ${new Date(score.updatedAt).toLocaleTimeString()}` : ''}`
      : 'Awaiting a matching score source';
    return `
      <div class="tm-det-summary-strip">
        <div class="tm-det-summary-score">${escapeHtml(scoreSummary)}</div>
        <div class="tm-det-summary-meta">${escapeHtml(sourceSummary)}</div>
      </div>`;
  }

  function renderLegacyDetailsPanel(match) {
    if (!match) return '<div class="tm-det-empty">Select a game to view details</div>';
    return `
      <div class="tm-det-header">
        <div class="tm-det-commentary">${buildGameCommentary(match)}</div>
        <button class="tm-det-close" type="button" title="Close details">✕</button>
      </div>
      <div class="tm-det-body">
        ${renderDetailsRows(match)}
        <div class="tm-det-divider"></div>
        <div class="tm-det-bets-title">Your Bets</div>
        ${renderDetailsBets(match)}
      </div>`;
  }

  function getVisibleSections(match) {
    const sections = [...DETAILS_SECTIONS];
    const remove = name => { const i = sections.indexOf(name); if (i > -1) sections.splice(i, 1); };
    if (uiSettings.showTeamStats === false)        remove('teamStats');
    if (uiSettings.showMarketConsensus === false)  remove('bettingPanel');
    if (uiSettings.showBettingCommentary === false) remove('commentary');
    if (uiSettings.showSourceList === false)       remove('sources');
    // Sources is debugging detail only: keep it available when debug mode is on,
    // but hide it from the normal pane to reduce clutter (data is retained).
    if (!uiSettings.enableDebugMode)               remove('sources');
    return sections;
  }

  // INVARIANT: all dynamic values escaped before innerHTML
  function renderDetailsPanel(match) {
    if (!match) return '<div class="tm-det-empty">Select a game to view details</div>';
    const enrichment = getEnrichment(match);
    computeExpectation(enrichment, match);
    buildCommentary(enrichment);
    return `
      ${renderDetailsHeader(enrichment)}
      ${renderDetailsSummaryStrip(enrichment, match)}
      <div class="tm-det-body">
        ${getVisibleSections(match).map(sectionName => renderDetailsSection(enrichment, match, sectionName)).join('')}
      </div>`;
  }

  function updateDetailsSection(matchKey, sectionName) {
    if (!activeDetailsMatchKey || activeDetailsMatchKey !== matchKey) return;
    if (!DETAILS_SECTIONS.includes(sectionName)) return;
    const det = document.getElementById(DETAILS_ID);
    const match = getActiveDetailsMatch();
    if (!det || !match) return;
    const target = det.querySelector(`[data-details-section="${sectionName}"]`);
    if (!target) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderDetailsSection(getEnrichment(match), match, sectionName).trim();
    const next = wrapper.firstElementChild;
    if (next) target.replaceWith(next);
  }

  async function enrichMatch(match, options = {}) {
    const enrichment = getEnrichment(match);
    const matchKey = enrichment.matchKey;

    // refreshPanel only scores live bets, so an upcoming panel match (or its row's
    // details button) reaches enrichment with no score. Without it, _statsFromEspnReuse
    // has no ESPN event to reuse and the pane falls through to other providers and shows
    // nothing. Mirror the fallback path (enrichSelectedFallbackDetails): when no score
    // lookup has happened yet, run one on demand so espn-reuse, the header source link,
    // and the commentary score fact populate. findScoreForMatch is cached/coalesced, and
    // live matches (already scored) and the fallback path (score preset) skip this.
    if (!match.score) {
      match.score = await findScoreForMatch(match);
      syncEnrichmentFromMatch(enrichment, match);
      if (options.forPane) updateDetailsPanel();
    }

    if (uiSettings.showTeamStats !== false && !isFresh(enrichment.teamStats, TTL_STATS)) {
      enrichment.loadingSections.teamStats = true;
      if (options.forPane) updateDetailsSection(matchKey, 'teamStats');
      const stats = await fetchCategory('stats', match, enrichment);
      enrichment.loadingSections.teamStats = false;
      if (stats?.found) {
        enrichment.teamStats = {
          ...enrichment.teamStats,
          ...stats,
          updatedAt: stats.updatedAt || Date.now()
        };
        if (stats.headToHead && !isFresh(enrichment.headToHead, TTL_H2H)) {
          enrichment.headToHead = stats.headToHead;
        }
      } else {
        enrichment.teamStats = {
          ...enrichment.teamStats,
          found: false,
          detail: stats?.detail || 'Not available.',
          updatedAt: Date.now()
        };
      }
      if (options.forPane) {
        computeExpectation(enrichment, match);
        buildCommentary(enrichment);
        updateDetailsSection(matchKey, 'teamStats');
        updateDetailsSection(matchKey, 'headToHead');
        updateDetailsSection(matchKey, 'commentary');
        updateDetailsSection(matchKey, 'sources');
      }
    }

    // External odds are never auto-fetched. The Odds Analysis panel pulls them with
    // a single explicit user action (the Pull odds button) — see handleBetPull.

    return enrichment;
  }

  function getOrCreateDetailsPanel() {
    let det = document.getElementById(DETAILS_ID);
    if (!det) {
      det = document.createElement('div');
      det.id = DETAILS_ID;
      det.className = 'tm-bookie-details';
      document.body.appendChild(det);
    }
    return det;
  }

  function resetDetailsPanePosition(det) {
    if (!det) return;
    det.style.left = '';
    det.style.right = '';
    det.style.top = '';
    det.style.bottom = '';
    det.style.width = '';
    det.style.transform = '';
  }

  function hideDetailsPanel(clearActive = false) {
    if (clearActive) clearActiveDetails();
    const existing = document.getElementById(DETAILS_ID);
    if (!existing) return;
    existing.style.display = 'none';
    existing.classList.remove('tm-details-overlay');
    resetDetailsPanePosition(existing);
  }

  function applyDetailsClasses() {
    const det = document.getElementById(DETAILS_ID);
    if (!det) return;
    det.classList.remove(
      'tm-theme-default', 'tm-theme-bloody', 'tm-theme-cyberpunk', 'tm-theme-light', 'tm-theme-c64',
      'tm-layout-right', 'tm-layout-left'
    );
    det.classList.add(`tm-theme-${uiSettings.theme || 'default'}`);
    det.classList.add(`tm-layout-${uiSettings.layoutSide || 'right'}`);
  }

  function ensureDetailsResizeListener() {
    if (detailsResizeListenerBound) return;
    detailsResizeListenerBound = true;
    window.addEventListener('resize', () => {
      clearTimeout(detailsResizeTimer);
      detailsResizeTimer = setTimeout(() => {
        const det = document.getElementById(DETAILS_ID);
        if (det && det.style.display !== 'none') positionDetailsPane(det);
      }, 150);
    });
  }

  function positionDetailsPane(det) {
    if (!det) return;
    const layoutSide = uiSettings.layoutSide === 'left' ? 'left' : 'right';
    const detailsPosition = uiSettings.detailsPosition || 'adjacent';
    const requiredWidth = PANEL_WIDTH + DETAILS_WIDTH + EDGE_GAP * 3;
    const useOverlay = window.innerWidth < requiredWidth;

    resetDetailsPanePosition(det);
    det.classList.toggle('tm-details-overlay', useOverlay);

    if (useOverlay) {
      det.style.width = `min(${DETAILS_WIDTH}px, calc(100vw - ${EDGE_GAP * 2}px))`;
      det.style.left = '50%';
      det.style.right = 'auto';
      det.style.top = 'auto';
      det.style.bottom = `${EDGE_GAP}px`;
      det.style.transform = 'translateX(-50%)';
      return;
    }

    det.style.width = `${DETAILS_WIDTH}px`;
    det.style.top = `${PANEL_TOP}px`;
    det.style.bottom = 'auto';
    det.style.transform = 'none';

    if (detailsPosition === 'screen-edge') {
      if (layoutSide === 'right') {
        det.style.left = `${EDGE_GAP}px`;
        det.style.right = 'auto';
      } else {
        det.style.left = 'auto';
        det.style.right = `${EDGE_GAP}px`;
      }
      return;
    }

    const adjacentOffset = PANEL_WIDTH + EDGE_GAP * 2;
    if (layoutSide === 'right') {
      det.style.left = 'auto';
      det.style.right = `${adjacentOffset}px`;
    } else {
      det.style.left = `${adjacentOffset}px`;
      det.style.right = 'auto';
    }
  }

  function updateDetailsPanel() {
    if (!uiSettings.showDetailsButtons || uiSettings.detailsPosition === 'off') {
      hideDetailsPanel(true);
      return;
    }
    if (!activeDetailsMatchKey) {
      hideDetailsPanel(false);
      return;
    }
    const match = getActiveDetailsMatch();
    if (!match) {
      hideDetailsPanel(true);
      return;
    }
    const det   = getOrCreateDetailsPanel();
    applyDetailsClasses();
    positionDetailsPane(det);
    ensureDetailsResizeListener();
    det.style.display = 'block';
    det.innerHTML = renderDetailsPanel(match);
    const closeBtn = det.querySelector('.tm-det-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => { clearActiveDetails(); rerenderPanel(); });
    }
    // Delegated once: survives per-section re-renders of the Odds Analysis panel.
    if (!det.dataset.betPullBound) {
      det.dataset.betPullBound = '1';
      det.addEventListener('click', event => {
        if (!event.target.closest?.('.tm-det-bet-pull')) return;
        const active = getActiveDetailsMatch();
        if (active) handleBetPull(active);
      });
    }
  }

  // -- Copy tools ----------------------------------------------------------------

  async function expandExtraOdds(active) {
    const links = active.querySelectorAll('a');
    for (const a of links) {
      if (/Show\s+\d+\s+additional/i.test(a.textContent)) {
        a.click();
        await new Promise(resolve => setTimeout(resolve, 250));
        break;
      }
    }
  }

  function inferSelectedDateParts(firstPart, secondPart) {
    const first = Number(firstPart);
    const second = Number(secondPart);
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
    if (first > 12) return { day: first, month: second };
    if (second > 12) return { day: second, month: first };
    return { day: first, month: second };
  }

  function buildSelectedStartTimestamp(firstDatePart, secondDatePart, yearPart, hourPart, minutePart, secondPart = '0', meridiem = '') {
    const inferred = inferSelectedDateParts(firstDatePart, secondDatePart);
    if (!inferred) return '';
    let year = Number(yearPart);
    let hour = Number(hourPart);
    const minute = Number(minutePart || 0);
    const second = Number(secondPart || 0);
    if (!Number.isFinite(year) || !Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) return '';
    if (year < 100) year += 2000;
    const ampm = String(meridiem || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const ms = new Date(year, inferred.month - 1, inferred.day, hour, minute, second).getTime();
    return isPlausibleTimestampMs(ms) ? ms : '';
  }

  function parseSelectedGameStartTimestamp(value) {
    const raw = clean(value);
    if (!raw) return '';
    const normalized = normalizeTimestampMs(raw);
    if (normalized) return normalized;

    const timeDate = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/i);
    if (timeDate) {
      return buildSelectedStartTimestamp(timeDate[5], timeDate[6], timeDate[7], timeDate[1], timeDate[2], timeDate[3], timeDate[4]);
    }

    const dateTime = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (dateTime) {
      return buildSelectedStartTimestamp(dateTime[1], dateTime[2], dateTime[3], dateTime[4], dateTime[5], dateTime[6], dateTime[7]);
    }

    const parsed = Date.parse(raw.replace(/\s+-\s+/, ' '));
    return isPlausibleTimestampMs(parsed) ? parsed : '';
  }

  function extractActiveGame() {
    const active = document.querySelector('li.c-pointer.active');
    if (!active) return null;
    const sport   = clean(active.querySelector('li.game')?.title);
    const matchP  = active.querySelector('.matchName p') || active.querySelector('.pop-game .name p');
    const matchTitle = clean(matchP?.title || matchP?.textContent);
    let matchName = matchTitle, competition = '';
    const idx = matchTitle.indexOf(' - ');
    if (idx > -1) { matchName = matchTitle.slice(0, idx).trim(); competition = matchTitle.slice(idx + 3).trim(); }
    const startTitle = clean(active.querySelector('.state-wrap .state')?.title);
    const startTime  = startTitle.replace(/^Due to start at\s*/i, '');
    const startTimestamp = parseSelectedGameStartTimestamp(startTime);
    const infoWrap = active.querySelector('.info-wrap');
    const markets  = [];
    if (infoWrap) {
      for (const wrap of infoWrap.querySelectorAll('ul.bets-wrap')) {
        const firstLi = wrap.querySelector(':scope > li.bets');
        if (!firstLi) continue;
        const marketCell = firstLi.querySelector('.market-name-cell');
        if (!marketCell) continue;
        const marketName = clean(marketCell.querySelector('.bold')?.textContent);
        const bets = [];
        for (const betLi of wrap.querySelectorAll(':scope > li.bets')) {
          if (betLi.querySelector('.market-name-cell')) continue;
          const oddsCell = betLi.querySelector('.bet-cell.odds.fractional');
          const multCell = betLi.querySelector('.bet-cell.odds.decimal');
          const descCell = betLi.querySelector('.bet-cell.result');
          if (!oddsCell || !descCell) continue;
          const odds = clean(oddsCell.textContent).replace(/^Odds:\s*/i, '');
          const mult = clean(multCell?.textContent).replace(/^Multiplier:\s*/i, '');
          const desc = clean(descCell.querySelector('span')?.textContent || descCell.textContent);
          const moneyGroup = betLi.querySelector('.input-money-group');
          const suspended  = moneyGroup?.classList.contains('disabled') || betLi.querySelector('input.amount')?.value === 'Suspended';
          bets.push({ desc, odds, mult, suspended });
        }
        if (bets.length) markets.push({ name: marketName, bets });
      }
    }
    return { sport, matchName, competition, startTime, startTimestamp, markets };
  }

  function getSelectedGameSummary() {
    const active = document.querySelector('li.c-pointer.active');
    if (!active) return null;

    const sport = clean(active.querySelector('li.game')?.title || active.querySelector('li.game')?.textContent);
    const matchP = active.querySelector('.matchName p') || active.querySelector('.pop-game .name p');
    const matchTitle = clean(matchP?.title || matchP?.textContent);
    let name = matchTitle;
    let competition = '';
    const idx = matchTitle.indexOf(' - ');
    if (idx > -1) {
      name = matchTitle.slice(0, idx).trim();
      competition = matchTitle.slice(idx + 3).trim();
    }

    const statusTitle = clean(active.querySelector('.state-wrap .state')?.title || active.querySelector('.state-wrap .state')?.textContent);
    const status = statusTitle.replace(/^Due to start at\s*/i, '') || 'Selected';
    const lookupGame = { sport, matchName: name, competition };
    const panelMatch = name ? findRenderableMatchForGame(lookupGame) : null;
    const sourceLabel = panelMatch ? (panelMatch.score?.sourceLabel || panelMatch.sourceLabel || '') : '';
    const amountText = panelMatch && Number.isFinite(panelMatch.amount) ? formatMoney(panelMatch.amount) : '';

    return {
      name: name || 'Selected game',
      sport: panelMatch?.sportLabel || panelMatch?.sport || sport || 'Sport unknown',
      status: panelMatch?.score?.detail || panelMatch?.status || status,
      amountText,
      sourceLabel,
      matchKey: panelMatch ? makeMatchKey(panelMatch) : ''
    };
  }

  function formatSelectedGameSummary(summary) {
    if (!summary) return { primary: '', secondary: '' };
    const secondary = [
      summary.status || 'Selected',
      summary.sport || 'Sport unknown',
      summary.amountText ? `Bet: ${summary.amountText}` : '',
      summary.sourceLabel || ''
    ].filter(Boolean).join(' - ');
    return {
      primary: summary.name || 'Selected game',
      secondary
    };
  }

  function selectedGameSummarySignature(summary) {
    if (!summary) return '';
    return [
      summary.name || '',
      summary.status || '',
      summary.sport || '',
      summary.amountText || '',
      summary.sourceLabel || '',
      summary.matchKey || ''
    ].join('|');
  }

  function refreshCopyToolsSelectionUi() {
    if (!uiSettings.showCopyTools) return;
    const panel = document.getElementById(PANEL_ID);
    const group = panel?.querySelector?.('.tm-bookie-copy-group');
    if (!group) return;
    const summary = getSelectedGameSummary();
    const signature = selectedGameSummarySignature(summary);
    if (signature === lastCopyToolsSelectionSignature) return;
    lastCopyToolsSelectionSignature = signature;
    group.outerHTML = renderCopyTools();
    bindCopyTools();
  }

  function queueCopyToolsSelectionRefresh() {
    [80, 350, 900].forEach(delay => {
      setTimeout(refreshCopyToolsSelectionUi, delay);
    });
  }

  function installCopyToolsSelectionWatcher() {
    if (copyToolsSelectionWatcherBound) return;
    copyToolsSelectionWatcherBound = true;
    document.addEventListener('click', event => {
      const target = event.target;
      if (!target?.closest) return;
      if (target.closest(`#${PANEL_ID}, #${DETAILS_ID}`)) return;
      if (target.closest('li.c-pointer, .matchName, .pop-game')) {
        queueCopyToolsSelectionRefresh();
      }
    }, true);
  }

  function getCopyReceiptTime(copiedAt) {
    const d = new Date(copiedAt || Date.now());
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function recordCopyReceipt({ mode, matchName, characterCount, quality }) {
    lastCopyReceipt = {
      mode,
      matchName: matchName || 'Selected game',
      copiedAt: Date.now(),
      characterCount: Number.isFinite(characterCount) ? characterCount : 0,
      quality
    };
    updateCopyReceiptDisplay();
  }

  function renderCopyReceipt() {
    if (!lastCopyReceipt) return '';
    const timeText = getCopyReceiptTime(lastCopyReceipt.copiedAt);
    const characterText = `${lastCopyReceipt.characterCount.toLocaleString()} characters`;
    return `
      <div class="tm-bookie-copy-receipt" role="status" aria-live="polite">
        <div class="tm-bookie-copy-receipt-top">Last copied: ${escapeHtml(lastCopyReceipt.mode)}${timeText ? `, ${escapeHtml(timeText)}` : ''}</div>
        <div class="tm-bookie-copy-receipt-name" title="${escapeHtml(lastCopyReceipt.matchName)}">${escapeHtml(lastCopyReceipt.matchName)}</div>
        <div class="tm-bookie-copy-receipt-meta">
          <span class="tm-bookie-copy-chip">Copied ${escapeHtml(characterText)}</span>
          ${lastCopyReceipt.quality ? `<span class="tm-bookie-copy-chip">${escapeHtml(lastCopyReceipt.quality)}</span>` : ''}
        </div>
      </div>`;
  }

  function updateCopyReceiptDisplay() {
    const panel = document.getElementById(PANEL_ID);
    const slot = panel?.querySelector('.tm-bookie-copy-receipt-slot');
    if (slot) slot.innerHTML = renderCopyReceipt();
  }

  function compactMarkets(markets) {
    const ouGroups = new Map();
    const ahEntries = [];
    const keep = new Set();
    markets.forEach((m, i) => {
      let mt = m.name.match(/^(.+?) Score Over\/Under ([\d.]+) (.+?) Full event$/i);
      if (mt) { const key = `team:${mt[1]}|${mt[3]}`; if (!ouGroups.has(key)) ouGroups.set(key, []); ouGroups.get(key).push({ market: m, line: parseFloat(mt[2]), index: i }); return; }
      mt = m.name.match(/^Over\/Under ([\d.]+) (.+?) Full event$/i);
      if (mt) { const key = `total:${mt[2]}`; if (!ouGroups.has(key)) ouGroups.set(key, []); ouGroups.get(key).push({ market: m, line: parseFloat(mt[1]), index: i }); return; }
      mt = m.name.match(/^Asian Handicap ([\d.]+) Full event$/i);
      if (mt) { const handicap = parseFloat(mt[1]); const firstDesc = m.bets[0]?.desc || ''; const isFavGives = firstDesc.includes(`(-${handicap})`); ahEntries.push({ market: m, handicap, index: i, isFavGives }); return; }
      keep.add(i);
    });
    ouGroups.forEach(entries => {
      if (entries.length <= 2 * COMPACT_RANGE + 1) { entries.forEach(e => keep.add(e.index)); return; }
      entries.sort((a, b) => a.line - b.line);
      let centralIdx = 0, minDiff = Infinity;
      entries.forEach((e, i) => { const o = parseMult(e.market.bets[0]?.mult), u = parseMult(e.market.bets[1]?.mult); if (o != null && u != null) { const d = Math.abs(o - u); if (d < minDiff) { minDiff = d; centralIdx = i; } } });
      for (let i = Math.max(0, centralIdx - COMPACT_RANGE); i <= Math.min(entries.length - 1, centralIdx + COMPACT_RANGE); i++) keep.add(entries[i].index);
    });
    const ahByH = new Map();
    ahEntries.forEach(e => { const cur = ahByH.get(e.handicap); if (!cur) ahByH.set(e.handicap, e); else if (!cur.isFavGives && e.isFavGives) ahByH.set(e.handicap, e); });
    const deduped = Array.from(ahByH.values()).sort((a, b) => a.handicap - b.handicap);
    if (deduped.length <= 2 * COMPACT_RANGE + 1) { deduped.forEach(e => keep.add(e.index)); }
    else {
      let centralIdx = 0, minDiff = Infinity;
      deduped.forEach((e, i) => { const m1 = parseMult(e.market.bets[0]?.mult), m2 = parseMult(e.market.bets[1]?.mult); if (m1 != null && m2 != null) { const d = Math.abs(m1 - m2); if (d < minDiff) { minDiff = d; centralIdx = i; } } });
      for (let i = Math.max(0, centralIdx - COMPACT_RANGE); i <= Math.min(deduped.length - 1, centralIdx + COMPACT_RANGE); i++) keep.add(deduped[i].index);
    }
    return markets.filter((_, i) => keep.has(i));
  }

  function formatGame(game, compact) {
    const lines = [COPY_SEP, `Sport:       ${game.sport}`, `Match:       ${game.matchName}`];
    if (game.competition) lines.push(`Competition: ${game.competition}`);
    if (game.startTime)   lines.push(`Start:       ${game.startTime}`);
    lines.push('');
    const markets = compact ? compactMarkets(game.markets) : game.markets;
    for (const market of markets) {
      lines.push(`Market: ${market.name}`);
      const maxDesc = Math.max(...market.bets.map(b => b.desc.length));
      const maxOdds = Math.max(...market.bets.map(b => b.odds.length));
      for (const bet of market.bets) {
        const desc = bet.desc.padEnd(maxDesc + 2, ' ');
        const odds = bet.odds.padEnd(maxOdds + 2, ' ');
        const mult = bet.mult ? `(${bet.mult})` : '';
        const sus  = bet.suspended ? ' [SUSPENDED]' : '';
        lines.push(`  ${desc}${odds}${mult}${sus}`);
      }
      lines.push('');
    }
    if (compact) { lines.push('Compact bookie options shown - advise if the full output is needed.'); lines.push(''); }
    lines.push(COPY_SEP);
    return lines.join('\n');
  }

  function parseGameTeams(matchName) {
    const raw = String(matchName || '');
    const separators = [/\s+vs\.?\s+/i, /\s+v\.?\s+/i, /\s+@\s+/i];
    for (const sep of separators) {
      const parts = raw.split(sep).map(clean).filter(Boolean);
      if (parts.length === 2) return parts;
    }
    return [raw, ''];
  }

  function findRenderableMatchForGame(game) {
    const [team1, team2] = parseGameTeams(game.matchName);
    const sport = normalizeName(game.sport);
    const competition = normalizeName(game.competition);
    let best = null;
    let bestScore = 0;
    for (const match of latestRenderableMatches) {
      if (sport && normalizeName(match.sport) !== sport && normalizeName(match.sportLabel) !== sport) continue;
      let score = 0;
      if (team1 && team2) {
        score = matchTeamPair(match, team1, team2).confidence;
      }
      if (!score && normalizeName(match.name) === normalizeName(game.matchName)) score = 100;
      if (competition && normalizeName(match.competition || match.league).includes(competition)) score += 5;
      if (score > bestScore) {
        best = match;
        bestScore = score;
      }
    }
    return bestScore >= CONFIDENCE_THRESHOLD ? best : null;
  }

  function makeFallbackMatchFromGame(game) {
    const [team1, team2] = parseGameTeams(game.matchName);
    const startTime = clean(game.startTime || '');
    const startTimestamp = game.startTimestamp || parseSelectedGameStartTimestamp(startTime);
    const fallbackIsLive = isActuallyLive({ status: startTime, rawStatus: startTime });
    const match = {
      tornId: '',
      sport: game.sport || '',
      sportLabel: game.sport || '',
      sportKey: slugify(game.sport || ''),
      sportAlias: slugify(game.sport || ''),
      league: game.competition || '',
      stage: game.competition || '',
      competition: game.competition || '',
      name: game.matchName || 'Selected match',
      rawStatus: startTime,
      status: startTime ? (fallbackIsLive ? startTime : `Starts ${startTime}`) : '',
      sectionType: fallbackIsLive ? 'live' : 'upcoming',
      isLive: fallbackIsLive,
      startTime,
      startTimestamp,
      team1,
      team2,
      amount: 0,
      sourceKey: 'torn',
      sourceLabel: 'Torn',
      score: { found: false, detail: 'Looking up score providers...' },
      bets: flattenGameMarkets(game)
    };
    match.sourceKey = chooseScoreSource(match);
    match.sourceLabel = SOURCE_LABELS[match.sourceKey] || match.sourceKey;
    return match;
  }

  function flattenGameMarkets(game) {
    const bets = [];
    for (const market of game.markets || []) {
      for (const bet of market.bets || []) {
        bets.push({
          marketTitle: market.name,
          selectionTitle: bet.desc,
          odds: bet.odds,
          mult: bet.mult,
          suspended: bet.suspended
        });
      }
    }
    return bets;
  }

  function gameFromRenderableMatch(match) {
    const marketsByName = new Map();
    for (const bet of match?.bets || []) {
      const marketName = bet.marketTitle || bet.market || bet.name || 'Torn Market';
      if (!marketsByName.has(marketName)) marketsByName.set(marketName, []);
      marketsByName.get(marketName).push({
        desc: bet.selectionTitle || bet.selection || bet.desc || '',
        odds: String(bet.odds || ''),
        mult: String(bet.mult || ''),
        suspended: !!bet.suspended
      });
    }
    const markets = [...marketsByName.entries()].map(([name, bets]) => ({ name, bets }));
    return {
      sport: match?.sport || match?.sportLabel || '',
      matchName: match?.name || [match?.team1, match?.team2].filter(Boolean).join(' vs '),
      competition: match?.competition || match?.league || '',
      startTime: match?.startTime || (match?.startTimestamp ? formatStartTime(match.startTimestamp) : ''),
      markets
    };
  }

  function textOrUnavailable(items) {
    const visible = (items || []).filter(Boolean);
    return visible.length ? visible : ['Not available.'];
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'raw only';
  }

  function formatEnrichedGame(game, enrichment, options = {}) {
    const match = options.match || makeFallbackMatchFromGame(game);
    computeExpectation(enrichment, match);
    hydrateBetPanelFromCache(match, enrichment);
    buildCommentary(enrichment);
    const lines = [COPY_SEP, `MATCH: ${game.matchName || enrichment.identity?.name || 'Selected match'}`];
    if (game.sport || enrichment.identity?.sport) lines.push(`SPORT: ${game.sport || enrichment.identity.sport}`);
    if (game.competition || enrichment.identity?.competition) lines.push(`COMPETITION: ${game.competition || enrichment.identity.competition}`);
    lines.push('');

    lines.push('CURRENT STATUS');
    if (enrichment.score?.found) {
      lines.push(`${enrichment.identity.team1 || 'Team 1'} ${enrichment.score.team1Score ?? '-'} - ${enrichment.score.team2Score ?? '-'} ${enrichment.identity.team2 || 'Team 2'}`);
      lines.push(`Source: ${enrichment.score.sourceLabel || 'Score provider'}${enrichment.score.updatedAt ? ` retrieved ${new Date(enrichment.score.updatedAt).toLocaleTimeString()}` : ''}`);
    } else {
      lines.push('Not available.');
    }
    lines.push('');

    lines.push('TORN MARKETS');
    const marketsText = formatGame(game, !!options.compact).split('\n').filter(line => line && line !== COPY_SEP);
    lines.push(...textOrUnavailable(marketsText));
    lines.push('');

    if (uiSettings.showTeamStats !== false) {
      lines.push('TEAM SNAPSHOT');
      const teamSnapLines = [
        ...(enrichment.teamStats?.teams || []).map(team => team.summary || team.name || ''),
        ...(enrichment.teamStats?.recentForm || []).map(f => f.summary || f.label || '')
      ].filter(Boolean);
      lines.push(...textOrUnavailable(teamSnapLines));
      if (enrichment.teamStats?.sourceLabel) lines.push(`Source: ${enrichment.teamStats.sourceLabel}${enrichment.teamStats.updatedAt ? ` retrieved ${new Date(enrichment.teamStats.updatedAt).toLocaleTimeString()}` : ''}`);
      lines.push('');
    }

    if (uiSettings.showMarketConsensus !== false) {
      lines.push('ODDS ANALYSIS');
      const bp = enrichment.betPanel;
      if (bp?.rows?.length) {
        const fmt = bp.oddsFormat === 'american' ? 'american' : 'decimal';
        const priceTxt = price => {
          const n = Number(price);
          if (price == null || !Number.isFinite(n)) return '-';
          return fmt === 'american' ? `${n > 0 ? '+' : ''}${Math.round(n)}` : n.toFixed(2);
        };
        for (const row of bp.rows) {
          const fair = fmt === 'american'
            ? (row.fairAmerican != null ? `${row.fairAmerican > 0 ? '+' : ''}${row.fairAmerican}` : '-')
            : (row.fairDecimal != null ? Number(row.fairDecimal).toFixed(2) : '-');
          const ev = Number.isFinite(row.evPct) ? `${row.evPct >= 0 ? '+' : ''}${row.evPct.toFixed(1)}%` : '-';
          lines.push(`  ${row.label}: cons ${(row.consensusProb * 100).toFixed(1)}% fair ${fair} best ${priceTxt(row.bestPrice)} ${row.bestBook} EV ${ev}`);
        }
        lines.push(bp.bestBet
          ? `Best Bet: ${bp.bestBet.label} ${priceTxt(bp.bestBet.bestPrice)}${bp.bestBet.bestBook ? ` ${bp.bestBet.bestBook}` : ''} (Bk# ${bp.bestBet.bookCount}, Hold ${Number(bp.bestBet.holdPct).toFixed(1)}%)`
          : 'Best Bet: None');
        for (const text of buildBetCommentary(bp.bestBet, bp.rows)) lines.push(text);
        lines.push('Source: The Odds API');
      } else {
        lines.push('Not pulled. Use "Pull odds" in the details pane.');
      }
      lines.push('');
    }

    if (uiSettings.showExpectedOutcome !== false) {
      lines.push('EXPECTED OUTCOME');
      if (enrichment.expectation?.found) {
        for (const market of enrichment.expectation.markets || []) {
          lines.push(`${market.market} - ${market.sourceLabel}`);
          for (const outcome of market.outcomes || []) {
            lines.push(`  ${outcome.selection}: raw ${formatPercent(outcome.rawImpliedProbability)} / normalized ${formatPercent(outcome.normalizedProbability)}`);
          }
          if (market.partial) lines.push('  Partial/incomplete market: normalized probabilities withheld.');
        }
        if (enrichment.expectation.method) lines.push(`Method: ${enrichment.expectation.method}`);
      } else lines.push('Not available.');
      lines.push('');
    }

    if (uiSettings.showBettingCommentary !== false) {
      lines.push('COMMENTARY');
      const commentaryLines = [
        ...(enrichment.commentary?.summary || []),
        ...(enrichment.commentary?.supportingFactors || []),
        ...(enrichment.commentary?.riskFactors || [])
      ].filter(Boolean);
      lines.push(...textOrUnavailable(commentaryLines));
      lines.push('');
    }

    // SOURCES is always included per spec §6 — never omit
    lines.push('SOURCES');
    const sources = [];
    if (enrichment.score?.sourceLabel) sources.push(`Score: ${enrichment.score.sourceLabel}`);
    if (enrichment.teamStats?.sourceLabel) sources.push(`Team stats: ${enrichment.teamStats.sourceLabel}`);
    if (enrichment.headToHead?.sourceLabel && enrichment.headToHead?.found) sources.push(`Head-to-head: ${enrichment.headToHead.sourceLabel}`);
    if (enrichment.betPanel?.rows?.length) sources.push('Odds analysis: The Odds API');
    if (enrichment.providersTried?.length) sources.push(`Providers tried: ${enrichment.providersTried.join(', ')}`);
    if (uiSettings.enableDebugMode && enrichment.providerErrors?.length) {
      sources.push(`Provider errors: ${enrichment.providerErrors.map(e => `${e.providerKey}: ${e.message}`).join('; ')}`);
    }
    lines.push(...textOrUnavailable(sources));
    lines.push(COPY_SEP);
    return lines.join('\n');
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Enrichment timed out')), ms))
    ]);
  }

  function areAllProvidersDisabled() {
    return Object.values(uiSettings.enabledProviders || {}).every(value => value === false);
  }

  async function copyToClipboard(text) {
    try {
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return true; }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove();
      return ok;
    }
  }

  function renderDebugReportNotice() {
    return `
      <div class="tm-bookie-debug-modal" role="dialog" aria-modal="true" aria-labelledby="tm-bookie-debug-title">
        <div class="tm-bookie-debug-title" id="tm-bookie-debug-title">Debug report copied</div>
        <div class="tm-bookie-debug-copy">
          The debug report has been copied to your clipboard. Share it only with the Live Scores Panel script developer.
        </div>
        <div class="tm-bookie-debug-copy">
          It may include browser information, script settings, enabled providers, public match and team names, timestamps, score-source errors, and sanitized request/cache details.
        </div>
        <div class="tm-bookie-debug-copy">
          It does not include passwords, Torn API keys, provider API keys or tokens, cookies, Torn account data, bet amounts, bet selections, or raw captured Torn/provider responses.
        </div>
        <div class="tm-bookie-debug-actions">
          <button class="tm-bookie-debug-close" type="button">OK</button>
        </div>
      </div>`;
  }

  function showDebugReportNotice() {
    document.getElementById(DEBUG_REPORT_NOTICE_ID)?.remove();
    const notice = document.createElement('div');
    notice.id = DEBUG_REPORT_NOTICE_ID;
    notice.innerHTML = renderDebugReportNotice();
    document.body.appendChild(notice);
    const close = () => notice.remove();
    notice.querySelector('.tm-bookie-debug-close')?.addEventListener('click', close);
    notice.addEventListener('click', event => {
      if (event.target === notice) close();
    });
  }

  // Generic informational modal. Reuses the debug-notice overlay id + CSS so only
  // one modal shows at a time. bodyHtml is caller-built; callers must escape any
  // dynamic content before passing it in.
  function showInfoModal(title, bodyHtml) {
    document.getElementById(DEBUG_REPORT_NOTICE_ID)?.remove();
    const notice = document.createElement('div');
    notice.id = DEBUG_REPORT_NOTICE_ID;
    notice.innerHTML = `
      <div class="tm-bookie-debug-modal" role="dialog" aria-modal="true" aria-labelledby="tm-bookie-info-title">
        <div class="tm-bookie-debug-title" id="tm-bookie-info-title">${escapeHtml(title)}</div>
        ${bodyHtml}
        <div class="tm-bookie-debug-actions">
          <button class="tm-bookie-debug-close" type="button">OK</button>
        </div>
      </div>`;
    document.body.appendChild(notice);
    const close = () => notice.remove();
    notice.querySelector('.tm-bookie-debug-close')?.addEventListener('click', close);
    notice.addEventListener('click', event => {
      if (event.target === notice) close();
    });
  }

  function isEsportsSportKey(sportKey) {
    return Object.prototype.hasOwnProperty.call(PANDASCORE_GAME_SLUGS, sportKey);
  }

  function isPandaScoreUsable() {
    return uiSettings.enabledProviders?.pandascore === true && hasPandaScoreToken();
  }

  function showEsportsPandaScoreNotice(sportKey) {
    const label = ESPORTS_GAME_LABELS[sportKey] || 'this esport';
    const helpUrl = 'https://greasyfork.org/scripts/torn-bookie-live-scores';
    showInfoModal('PandaScore required for esports', `
      <div class="tm-bookie-debug-copy">Live scores for <strong>${escapeHtml(label)}</strong> are provided by PandaScore, which needs its own free API token. Without it, this game's scores will not load.</div>
      <div class="tm-bookie-debug-copy">To see esports scores: enable <strong>PandaScore</strong> under Score Sources, then paste your token under <strong>Esports Scores (PandaScore)</strong> in Settings.</div>
      <div class="tm-bookie-debug-copy">Need a token or setup help? See the <a class="tm-bookie-info-link" href="${escapeHtml(helpUrl)}" target="_blank" rel="noopener noreferrer">script's GreasyFork page</a> for instructions.</div>
    `);
  }

  async function handleCopyDebugReport(button = null) {
    setButtonActionState(button, 'loading', 'Copying...');
    try {
      const reportText = JSON.stringify(buildDebugReport(), null, 2);
      const ok = await copyToClipboard(reportText);
      if (!ok) {
        setButtonActionState(button, 'error', 'Copy Failed');
        showActionNotice({
          type: 'error',
          title: 'Copy failed',
          detail: 'Clipboard blocked. Output was written to the console.'
        });
        return;
      }
      recordDebugEvent('debug-report-copied', { bytes: reportText.length });
      recordCopyReceipt({
        mode: 'Debug report',
        matchName: 'Debug report',
        characterCount: reportText.length,
        quality: 'debug'
      });
      setButtonActionState(button, 'success', 'Copied');
      showActionNotice({
        type: 'success',
        title: 'Copied debug report',
        detail: `${reportText.length.toLocaleString()} characters`
      });
      showDebugReportNotice();
    } catch (error) {
      recordDebugEvent('debug-report-copy-failed', { error });
      setButtonActionState(button, 'error', 'Copy Failed');
      showActionNotice({
        type: 'error',
        title: 'Copy failed',
        detail: 'Could not copy debug report.'
      });
    } finally {
      restoreButtonActionState(button);
    }
  }

  async function handleCopyClick(compact, button = null) {
    const active = document.querySelector('li.c-pointer.active');
    if (!active) {
      setButtonActionState(button, 'error', 'Copy Failed');
      showActionNotice({
        type: 'warning',
        title: 'No game selected',
        detail: 'Open a Torn Bookie game first.'
      });
      restoreButtonActionState(button);
      return;
    }
    setButtonActionState(button, 'loading', compact ? 'Collecting...' : 'Copying...');
    await expandExtraOdds(active);
    const game = extractActiveGame();
    if (!game || !game.matchName) {
      setButtonActionState(button, 'error', 'Copy Failed');
      showActionNotice({
        type: 'error',
        title: 'Copy failed',
        detail: 'Could not parse game details.'
      });
      restoreButtonActionState(button);
      return;
    }
    const baseText = formatGame(game, compact);

    if (!compact) {
      const ok = await copyToClipboard(baseText);
      if (ok) {
        recordCopyReceipt({
          mode: 'Full game',
          matchName: game.matchName,
          characterCount: baseText.length,
          quality: 'Torn data only'
        });
        setButtonActionState(button, 'success', 'Copied');
        showActionNotice({
          type: 'success',
          title: 'Copied full game',
          detail: game.matchName
        });
      } else {
        setButtonActionState(button, 'error', 'Copy Failed');
        showActionNotice({
          type: 'error',
          title: 'Copy failed',
          detail: 'Clipboard blocked. Output was written to the console.'
        });
        console.log(baseText);
      }
      restoreButtonActionState(button);
      return;
    }

    if (areAllProvidersDisabled()) {
      const ok = await copyToClipboard(baseText);
      if (ok) {
        recordCopyReceipt({
          mode: 'Compact fallback',
          matchName: game.matchName,
          characterCount: baseText.length,
          quality: 'fallback'
        });
        setButtonActionState(button, 'success', 'Copied');
        showActionNotice({
          type: 'warning',
          title: 'Copied compact text',
          detail: 'External analysis unavailable, original game copied'
        });
      } else {
        setButtonActionState(button, 'error', 'Copy Failed');
        showActionNotice({
          type: 'error',
          title: 'Copy failed',
          detail: 'Clipboard blocked. Output was written to the console.'
        });
        console.log(baseText);
      }
      restoreButtonActionState(button);
      return;
    }

    try {
      const panelMatch = findRenderableMatchForGame(game);
      const match = panelMatch || makeFallbackMatchFromGame(game);
      const enrichment = getEnrichment(match);
      if (panelMatch) await withTimeout(enrichMatch(match, { forPane: false }), 10000);
      computeExpectation(enrichment, match);
      buildCommentary(enrichment);
      const text = formatEnrichedGame(game, enrichment, { compact: true, match });
      const ok = await copyToClipboard(text);
      if (!ok) throw new Error('Copy failed');

      if (panelMatch && findMatchByKey(enrichment.matchKey)) {
        activeDetailsFallbackMatch = null;
        activeDetailsMatchKey = enrichment.matchKey;
        rerenderPanel();
      }
      recordCopyReceipt({
        mode: 'Compact',
        matchName: game.matchName,
        characterCount: text.length,
        quality: 'enriched'
      });
      setButtonActionState(button, 'success', 'Copied');
      showActionNotice({
        type: 'success',
        title: 'Copied compact text',
        detail: game.matchName
      });
    } catch (error) {
      const ok = await copyToClipboard(baseText);
      if (ok) {
        recordCopyReceipt({
          mode: 'Compact fallback',
          matchName: game.matchName,
          characterCount: baseText.length,
          quality: 'fallback'
        });
        setButtonActionState(button, 'success', 'Copied');
        showActionNotice({
          type: 'warning',
          title: 'Copied compact text',
          detail: 'External analysis unavailable, original game copied'
        });
      } else {
        setButtonActionState(button, 'error', 'Copy Failed');
        showActionNotice({
          type: 'error',
          title: 'Copy failed',
          detail: 'Clipboard blocked. Output was written to the console.'
        });
        console.log(baseText);
      }
      debugLog('Copy Compact enrichment unavailable', error?.message || error);
    } finally {
      restoreButtonActionState(button);
    }
  }

  function syncFallbackDetailsScore(matchKey, score) {
    if (!activeDetailsFallbackMatch || activeDetailsMatchKey !== matchKey) return false;
    activeDetailsFallbackMatch = {
      ...activeDetailsFallbackMatch,
      score: score || { found: false, detail: 'Score unavailable for selected game' }
    };
    return true;
  }

  async function enrichSelectedFallbackDetails(match) {
    const matchKey = makeMatchKey(match);
    try {
      const score = await findScoreForMatch(match);
      if (!syncFallbackDetailsScore(matchKey, score)) return;
      updateDetailsPanel();
    } catch (error) {
      if (!syncFallbackDetailsScore(matchKey, {
        found: false,
        detail: error?.message || 'Score lookup unavailable',
        unmatched: true
      })) return;
      updateDetailsPanel();
      debugLog('Selected fallback score lookup failed', error?.message || error);
    }

    const latestMatch = getActiveDetailsMatch();
    if (!latestMatch || activeDetailsMatchKey !== matchKey) return;
    await enrichMatch(latestMatch, { forPane: true });
  }

  async function handleShowSelectedDetails(button = null) {
    if (!uiSettings.showDetailsButtons || uiSettings.detailsPosition === 'off') {
      hideDetailsPanel(true);
      setButtonActionState(button, 'error', 'Could Not Open');
      showActionNotice({
        type: 'warning',
        title: 'Details unavailable',
        detail: 'Details panel is disabled in Settings.'
      });
      restoreButtonActionState(button);
      return;
    }
    const active = document.querySelector('li.c-pointer.active');
    if (!active) {
      setButtonActionState(button, 'error', 'Could Not Open');
      showActionNotice({
        type: 'warning',
        title: 'No game selected',
        detail: 'Open a Torn Bookie game first.'
      });
      restoreButtonActionState(button);
      return;
    }
    setButtonActionState(button, 'loading', 'Opening...');
    try {
      await expandExtraOdds(active);
      const game = extractActiveGame();
      if (!game || !game.matchName) {
        setButtonActionState(button, 'error', 'Could Not Open');
        showActionNotice({
          type: 'error',
          title: 'Could not open details',
          detail: 'Could not identify the selected game.'
        });
        return;
      }
      const panelMatch = findRenderableMatchForGame(game);
      const match = panelMatch || makeFallbackMatchFromGame(game);

      activeDetailsFallbackMatch = panelMatch ? null : match;
      activeDetailsMatchKey = makeMatchKey(match);
      rerenderPanel();

      if (panelMatch) {
        enrichMatch(panelMatch, { forPane: true }).catch(error => {
          debugLog('Selected details enrichment failed', error?.message || error);
        });
      } else {
        enrichSelectedFallbackDetails(match).catch(error => {
          debugLog('Selected fallback details enrichment failed', error?.message || error);
        });
      }
      setButtonActionState(button, 'success', 'Details Opened');
      showActionNotice({
        type: 'success',
        title: 'Details opened',
        detail: game.matchName
      });
    } finally {
      restoreButtonActionState(button);
    }
  }

  // -- Updated bar + refresh pill ------------------------------------------------

  function renderUpdatedBar() {
    const stateText = isRefreshingPanel
      ? '<span class="tm-bookie-updated-state tm-bookie-updated-state-refreshing" role="status" aria-live="polite">Refreshing...</span>'
      : (lastRefreshErrorMessage
        ? `<span class="tm-bookie-updated-state tm-bookie-updated-state-warning" title="${escapeHtml(lastRefreshErrorMessage)}">Refresh issue</span>`
        : '');
    return `
      <div class="tm-bookie-updated">
        <span class="tm-bookie-updated-text">Scores Updated ${escapeHtml(lastUpdatedText)} ${stateText}</span>
        <span class="tm-bookie-refresh-pill" aria-label="Score refresh interval">
          <button class="tm-bookie-refresh-mode" data-mode="10s" type="button">10s</button>
          <button class="tm-bookie-refresh-mode" data-mode="30s" type="button">30s</button>
          <button class="tm-bookie-refresh-mode" data-mode="3m"  type="button">3m</button>
          <button class="tm-bookie-refresh-mode" data-mode="MAN" type="button">MAN</button>
        </span>
      </div>`;
  }

  // -- Copy tools panel section --------------------------------------------------

  function renderCopyTools() {
    if (!uiSettings.showCopyTools) return '';
    const caret = copyToolsCollapsed ? '▸' : '▾';
    const selectedSummary = getSelectedGameSummary();
    lastCopyToolsSelectionSignature = selectedGameSummarySignature(selectedSummary);
    const selectedLines = formatSelectedGameSummary(selectedSummary);
    const copyTitle = selectedSummary ? 'Copy selected Torn Bookie game' : 'Open a Torn Bookie game first';
    const detailsTitle = selectedSummary ? 'Open details for selected Torn Bookie game' : 'Open a Torn Bookie game first';
    return `
      <div class="tm-bookie-copy-group">
        <button class="tm-bookie-copy-header" type="button">
          <span class="tm-bookie-copy-left">
            <span class="tm-bookie-caret">${caret}</span>
            <span class="tm-bookie-copy-name">Tools</span>
          </span>
          <span class="tm-bookie-copy-hint">${selectedSummary ? 'selected game' : 'no selection'}</span>
        </button>
        ${copyToolsCollapsed ? '' : `
          <div class="tm-bookie-copy-body">
            ${selectedSummary ? `
              <div class="tm-bookie-selected-summary">
                <div class="tm-bookie-selected-label">Selected</div>
                <div class="tm-bookie-selected-name" title="${escapeHtml(selectedLines.primary)}">${escapeHtml(selectedLines.primary)}</div>
                <div class="tm-bookie-selected-meta" title="${escapeHtml(selectedLines.secondary)}">${escapeHtml(selectedLines.secondary)}</div>
              </div>` : `
              <div class="tm-bookie-selected-summary tm-bookie-selected-empty">
                <div class="tm-bookie-selected-label">No game selected</div>
                <div class="tm-bookie-selected-empty-text">Open a Torn Bookie game to enable copy and details actions.</div>
              </div>`}
            <div class="tm-bookie-copy-buttons">
              <button class="tm-bookie-copy-btn" type="button" data-copy-mode="full" title="${escapeHtml(copyTitle)}">Copy Full Game</button>
              <button class="tm-bookie-copy-btn" type="button" data-copy-mode="details" title="${escapeHtml(detailsTitle)}">Show Game Details</button>
            </div>
            <div class="tm-bookie-copy-receipt-slot">${renderCopyReceipt()}</div>
          </div>`}
      </div>`;
  }

  // -- Settings panel section ----------------------------------------------------

  function getThemeDisplayName(theme) {
    const labels = {
      default: 'Default Dark',
      bloody: 'Bloody Bets',
      cyberpunk: 'Things',
      light: 'Sleek Light',
      c64: 'C64 Retro'
    };
    return labels[theme] || labels.default;
  }

  function getLayoutDisplayName(layoutSide) {
    return layoutSide === 'left' ? 'left' : 'right';
  }

  function renderSettingsTools() {
    const caret = settingsCollapsed ? '▸' : '▾';
    const settingsHint = `${getThemeDisplayName(uiSettings.theme)} - ${getLayoutDisplayName(uiSettings.layoutSide)}`;
    const pinnedCount = pinnedLiveMatchKeys.length;
    const unpinTitle = pinnedCount
      ? `Clear ${pinnedCount} pinned live ${pinnedCount === 1 ? 'game' : 'games'}`
      : 'No pinned live games';
    return `
      <div class="tm-bookie-settings-group">
        <button class="tm-bookie-settings-header" type="button">
          <span class="tm-bookie-settings-left">
            <span class="tm-bookie-caret">${caret}</span>
            <span class="tm-bookie-settings-name">Settings</span>
          </span>
          <span class="tm-bookie-settings-hint">${escapeHtml(settingsHint)}</span>
        </button>
        ${settingsCollapsed ? '' : `
          <div class="tm-bookie-settings-body">
            <div class="tm-bookie-settings-grid">

              <div class="tm-bookie-setting-row">
                <label for="tm-bookie-theme">Theme</label>
                <select id="tm-bookie-theme" data-setting-key="theme">
                  <option value="default"   ${uiSettings.theme === 'default'   ? 'selected' : ''}>Default Dark</option>
                  <option value="bloody"    ${uiSettings.theme === 'bloody'    ? 'selected' : ''}>Bloody Bets</option>
                  <option value="cyberpunk" ${uiSettings.theme === 'cyberpunk' ? 'selected' : ''}>Things</option>
                  <option value="light"     ${uiSettings.theme === 'light'     ? 'selected' : ''}>Sleek Light</option>
                  <option value="c64"       ${uiSettings.theme === 'c64'       ? 'selected' : ''}>C64 Retro</option>
                </select>
              </div>

              <div class="tm-bookie-setting-row">
                <label for="tm-bookie-layout">Layout</label>
                <select id="tm-bookie-layout" data-setting-key="layoutSide">
                  <option value="right" ${uiSettings.layoutSide === 'right' ? 'selected' : ''}>Right Side</option>
                  <option value="left"  ${uiSettings.layoutSide === 'left'  ? 'selected' : ''}>Left Side</option>
                </select>
              </div>

              <div class="tm-bookie-setting-row">
                <label for="tm-bookie-details-position">Details</label>
                <select id="tm-bookie-details-position" data-setting-key="detailsPosition">
                  <option value="adjacent"   ${uiSettings.detailsPosition === 'adjacent'    ? 'selected' : ''}>Beside Panel</option>
                  <option value="screen-edge"${uiSettings.detailsPosition === 'screen-edge' ? 'selected' : ''}>Screen Edge</option>
                  <option value="off"        ${uiSettings.detailsPosition === 'off'         ? 'selected' : ''}>Off</option>
                </select>
              </div>

              <div class="tm-bookie-setting-row">
                <label for="tm-bookie-scoreboard-style">Scoreboard</label>
                <select id="tm-bookie-scoreboard-style" data-setting-key="scoreboardStyle">
                  <option value="compact" ${uiSettings.scoreboardStyle === 'compact' ? 'selected' : ''}>Large</option>
                  <option value="classic" ${uiSettings.scoreboardStyle === 'classic' ? 'selected' : ''}>Classic</option>
                  <option value="minimal" ${uiSettings.scoreboardStyle === 'minimal' ? 'selected' : ''}>Minimal</option>
                </select>
              </div>

              <div>
                <div class="tm-bookie-settings-label">Display</div>
                <div class="tm-bookie-checkbox-grid">
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showLive"               ${uiSettings.showLive               ? 'checked' : ''}> Live scores</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showUpcoming"           ${uiSettings.showUpcoming           ? 'checked' : ''}> Upcoming</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showCopyTools"          ${uiSettings.showCopyTools          ? 'checked' : ''}> Copy tools</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showPoweredBy"          ${uiSettings.showPoweredBy          ? 'checked' : ''}> Powered by</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showSourceInRows"       ${uiSettings.showSourceInRows       ? 'checked' : ''}> Row sources</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showBetAmount"          ${uiSettings.showBetAmount          ? 'checked' : ''}> Bet amount</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showDetailsButtons"     ${uiSettings.showDetailsButtons     ? 'checked' : ''}> Details panel</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="hideUnmatchedGames"     ${uiSettings.hideUnmatchedGames     ? 'checked' : ''}> Hide unmatched</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="autoCollapseUpcoming"   ${uiSettings.autoCollapseUpcoming   ? 'checked' : ''}> Collapse upcoming</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="enableDebugMode"        ${uiSettings.enableDebugMode        ? 'checked' : ''}> Debug mode</label>
                  ${uiSettings.enableDebugMode ? `
                    <div class="tm-bookie-debug-report-row">
                      <button class="tm-bookie-debug-report-btn" type="button">Copy Debug Report</button>
                    </div>
                  ` : ''}
                </div>
              </div>

              <div class="tm-bookie-settings-sports">
                <div class="tm-bookie-settings-label">Score Sources</div>
                <div class="tm-bookie-checkbox-grid">
                  ${SUPPORTED_PROVIDER_SETTINGS.map(([key, label]) => `
                    <label class="tm-bookie-check">
                      <input type="checkbox" data-provider-key="${escapeHtml(key)}" ${uiSettings.enabledProviders?.[key] !== false ? 'checked' : ''}>
                      ${escapeHtml(label)}
                    </label>`).join('')}
                </div>
              </div>

              <div class="tm-bookie-settings-sports">
                <div class="tm-bookie-settings-label">Sports</div>
                <div class="tm-bookie-checkbox-grid">
                  ${SUPPORTED_SPORT_SETTINGS.map(([key, label]) => `
                    <label class="tm-bookie-check">
                      <input type="checkbox" data-sport-key="${escapeHtml(key)}" ${uiSettings.enabledSports?.[key] !== false ? 'checked' : ''}>
                      ${escapeHtml(label)}
                    </label>`).join('')}
                </div>
              </div>

              <div>
                <div class="tm-bookie-settings-label">Details Pane Sections</div>
                <div class="tm-bookie-checkbox-grid">
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showTeamStats"         ${uiSettings.showTeamStats         !== false ? 'checked' : ''}> Team stats</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showMarketConsensus"   ${uiSettings.showMarketConsensus   !== false ? 'checked' : ''}> Odds analysis</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showBettingCommentary" ${uiSettings.showBettingCommentary !== false ? 'checked' : ''}> Commentary</label>
                  <label class="tm-bookie-check"><input type="checkbox" data-setting-key="showSourceList"        ${uiSettings.showSourceList        !== false ? 'checked' : ''}> Source list</label>
                </div>
              </div>

              <div class="tm-bookie-settings-odds-block">
                <div class="tm-bookie-settings-label">API-Sports Scores (soccer / rugby / AFL)</div>
                <div class="tm-bookie-settings-note">Optional BYOK provider for soccer, rugby, and AFL (fallback after ESPN). Free tier: 100 requests/day. Keys are private; do not enable on shared browsers. Each refetch uses 1 of your 100 daily free requests.</div>
                ${uiSettings.enabledProviders?.apisports === true ? `
                  <div class="tm-bookie-odds-key-row">
                    ${hasApiSportsKey() ? `
                      <span class="tm-bookie-odds-key-masked">${escapeHtml(maskApiSportsKey(getApiSportsKey()))}</span>
                      <button class="tm-bookie-apisports-remove-btn" type="button">Remove Key</button>
                    ` : `
                      <input type="password" class="tm-bookie-apisports-key-input" placeholder="Paste API-Sports key..." autocomplete="off">
                      <button class="tm-bookie-apisports-save-btn" type="button">Save Key</button>
                    `}
                  </div>
                  ${hasApiSportsKey() ? renderByokQuotaBlock(['apifootball', 'apisports'], 'Not pulled yet') : ''}
                  <div class="tm-bookie-apisports-mode-row">
                    <span class="tm-bookie-apisports-mode-label">Refresh</span>
                    <span class="tm-bookie-apisports-mode-pill" aria-label="API-Sports refresh mode">
                      <button class="tm-bookie-apisports-mode${uiSettings.apiSportsRefreshMode === 'auto' ? ' is-active' : ''}" data-apisports-mode="auto" type="button">Auto</button>
                      <button class="tm-bookie-apisports-mode${uiSettings.apiSportsRefreshMode !== 'auto' ? ' is-active' : ''}" data-apisports-mode="manual" type="button">Manual-only</button>
                    </span>
                  </div>
                  <div class="tm-bookie-settings-note">Manual-only: api-sports refetches only when you click Refresh now (1 request per sport, per the free 100/day cap).</div>
                ` : `
                  <div class="tm-bookie-settings-note">Enable API-Sports under Score Sources to configure a key.</div>
                `}
              </div>

              <div class="tm-bookie-settings-odds-block">
                <div class="tm-bookie-settings-label">Esports Scores (PandaScore)</div>
                <div class="tm-bookie-settings-note">Optional BYOK provider for Counter-Strike, League of Legends, Dota 2, and Valorant. PandaScore tokens are private; do not enable this on shared browsers.</div>
                ${uiSettings.enabledProviders?.pandascore === true ? `
                  <div class="tm-bookie-odds-key-row">
                    ${hasPandaScoreToken() ? `
                      <span class="tm-bookie-odds-key-masked">${escapeHtml(maskPandaScoreToken(getPandaScoreToken()))}</span>
                      <button class="tm-bookie-pandascore-remove-btn" type="button">Remove Token</button>
                    ` : `
                      <input type="password" class="tm-bookie-pandascore-token-input" placeholder="Paste PandaScore token..." autocomplete="off">
                      <button class="tm-bookie-pandascore-save-btn" type="button">Save Token</button>
                    `}
                  </div>
                  ${hasPandaScoreToken() ? renderByokQuotaBlock('pandascore', 'Not pulled yet') : ''}
                ` : `
                  <div class="tm-bookie-settings-note">Enable PandaScore under Score Sources to configure a token.</div>
                `}
              </div>

              <div class="tm-bookie-settings-odds-block">
                <div class="tm-bookie-settings-label">External Odds (The Odds API)</div>
                <div class="tm-bookie-checkbox-grid">
                  <label class="tm-bookie-check">
                    <input type="checkbox" data-setting-key="enableExternalOdds" ${uiSettings.enableExternalOdds ? 'checked' : ''}>
                    Enable external odds (BYOK)
                  </label>
                </div>
                ${uiSettings.enableExternalOdds ? `
                  <div class="tm-bookie-odds-key-row">
                    ${hasOddsApiKey() ? `
                      <span class="tm-bookie-odds-key-masked">${escapeHtml(maskOddsApiKey(getOddsApiKey()))}</span>
                      <button class="tm-bookie-odds-remove-btn" type="button">Remove Key</button>
                    ` : `
                      <input type="password" class="tm-bookie-odds-key-input" placeholder="Paste API key…" autocomplete="off">
                      <button class="tm-bookie-odds-save-btn" type="button">Save Key</button>
                    `}
                  </div>
                  <div class="tm-bookie-setting-row" style="margin-top:6px">
                    <label for="tm-bookie-odds-region">Region</label>
                    <select id="tm-bookie-odds-region" data-setting-key="oddsRegion">
                      <option value="us"  ${getOddsRegion() === 'us'  ? 'selected' : ''}>US</option>
                      <option value="us2" ${getOddsRegion() === 'us2' ? 'selected' : ''}>US2</option>
                      <option value="uk"  ${getOddsRegion() === 'uk'  ? 'selected' : ''}>UK</option>
                      <option value="eu"  ${getOddsRegion() === 'eu'  ? 'selected' : ''}>EU</option>
                      <option value="au"  ${getOddsRegion() === 'au'  ? 'selected' : ''}>AU</option>
                    </select>
                  </div>
                  <div class="tm-bookie-setting-row">
                    <label for="tm-bookie-odds-markets">Odds detail</label>
                    <select id="tm-bookie-odds-markets" data-setting-key="oddsMarketsMode">
                      <option value="moneyline" ${getOddsMarketsMode() === 'moneyline' ? 'selected' : ''}>Moneyline only</option>
                      <option value="full"      ${getOddsMarketsMode() === 'full'      ? 'selected' : ''}>Full markets (h2h + spreads + totals)</option>
                    </select>
                  </div>
                  <div class="tm-bookie-settings-note">Each pull uses ${getOddsPullCost()} credit${getOddsPullCost() === 1 ? '' : 's'} (markets × 1 region). Spreads and totals are mainly available for US sports and books.</div>
                  ${hasOddsApiKey() ? renderByokQuotaBlock('theoddsapi', 'Not pulled yet') : ''}
                ` : ''}
              </div>

              <div class="tm-bookie-settings-actions">
                <button class="tm-bookie-unpin-all-btn" type="button" ${pinnedCount ? '' : 'disabled'} title="${escapeHtml(unpinTitle)}">Unpin all</button>
                <button class="tm-bookie-reset-btn" type="button">Reset UI Settings</button>
              </div>
            </div>
          </div>`}
      </div>`;
  }

  // -- Panel render + error ------------------------------------------------------

  function isSportGroupCollapsed(sectionType, sportKey) {
    const section = collapsedSportGroups[sectionType] || {};
    if (Object.prototype.hasOwnProperty.call(section, sportKey)) return Boolean(section[sportKey]);
    return sectionType === 'upcoming' && uiSettings.autoCollapseUpcoming !== false;
  }

  function renderPanel(liveMatches, upcomingMatches) {
    lastUpdatedText = new Date().toLocaleTimeString();
    lastRefreshErrorMessage = '';
    latestRenderableMatches = [...liveMatches, ...upcomingMatches];
    rerenderPanel();
  }

  function getByokMissingProviders() {
    const missing = [];
    if (uiSettings.enabledProviders?.apisports === true && !hasApiSportsKey()) missing.push('API-Sports key missing');
    if (uiSettings.enabledProviders?.pandascore === true && !hasPandaScoreToken()) missing.push('PandaScore token missing');
    return missing;
  }

  function renderEmptyState(title, detail) {
    return `
      <div class="tm-bookie-empty tm-bookie-empty-block">
        <div class="tm-bookie-empty-title">${escapeHtml(title)}</div>
        ${detail ? `<div class="tm-bookie-empty-detail">${escapeHtml(detail)}</div>` : ''}
      </div>`;
  }

  function renderLiveEmptyState(upcomingCount) {
    const missingByok = getByokMissingProviders();
    if (upcomingCount > 0) {
      return renderEmptyState('No live bets to show', 'Upcoming games are still available below.');
    }
    if (uiSettings.hideUnmatchedGames) {
      return renderEmptyState('No live games match the current display settings', 'Turn off Hide unmatched in Settings to show all live bets.');
    }
    if (missingByok.length) {
      return renderEmptyState('No live bets available from enabled sources', `Check provider keys in Settings: ${missingByok.join(', ')}.`);
    }
    return renderEmptyState('No live supported bets right now', 'Try Refresh now or review provider and sport settings.');
  }

  function renderUpcomingEmptyState(liveCount) {
    if (liveCount > 0) {
      return renderEmptyState('No upcoming bets to show', 'Live games are still available above.');
    }
    return renderEmptyState('No upcoming supported bets right now', 'Check disabled sports or providers in Settings.');
  }

  function renderGlobalHiddenState() {
    return renderEmptyState('No games match the current display settings', 'Enable Live or Upcoming in Settings to restore the list.');
  }

  function renderRefreshWarning() {
    if (!lastRefreshErrorMessage || isRefreshingPanel) return '';
    return `<div class="tm-bookie-refresh-warning" role="status" aria-live="polite">${escapeHtml(lastRefreshErrorMessage)} Using the last successful scores. Click Refresh now to retry.</div>`;
  }

  function rerenderPanel() {
    const panel   = getOrCreatePanel();
    const content = panel.querySelector('.tm-bookie-content');
    const liveMatches = latestRenderableMatches.filter(match => match.sectionType === 'live');
    const upcomingMatches = latestRenderableMatches.filter(match => match.sectionType === 'upcoming');
    const selectedSummary = getSelectedGameSummary();

    updateHeaderSources(getActiveSources(liveMatches, upcomingMatches));
    updatePanelHiddenState();

    const liveHtml = uiSettings.showLive
      ? renderSportGroups('live', 'Live', liveMatches, match => renderLiveMatch(match, selectedSummary))
      : '';
    const upcomingHtml = uiSettings.showUpcoming
      ? renderSportGroups('upcoming', 'Upcoming', upcomingMatches, match => renderUpcomingMatch(match, selectedSummary))
      : '';

    content.innerHTML = `
      ${renderUpdatedBar()}
      ${renderRefreshWarning()}
      ${uiSettings.showLive     ? liveHtml     || `<div class="tm-bookie-section-title">Live</div>${renderLiveEmptyState(upcomingMatches.length)}`     : ''}
      ${uiSettings.showUpcoming ? upcomingHtml || `<div class="tm-bookie-section-title">Upcoming</div>${renderUpcomingEmptyState(liveMatches.length)}` : ''}
      ${!uiSettings.showLive && !uiSettings.showUpcoming ? renderGlobalHiddenState() : ''}
      ${renderCopyTools()}
      ${renderSettingsTools()}`;

    bindRefreshModeButtons();
    bindSportGroupButtons();
    bindCopyTools();
    bindSettingsTools();
    bindLivePinButtons();
    updateRefreshButtons();
    bindDetailsButtons();
    updateDetailsPanel();
  }

  // Renders the error body. Dynamic error text is always escaped; only the known
  // capture-wait message is emitted as markup (its parts are static literals) so
  // the "select YOUR BETS" call to action can sit on its own bold line.
  function renderErrorBody(error) {
    const message = error?.message || String(error);
    if (message.includes('Be sure you have selected YOUR BETS.')) {
      return 'Waiting for Torn Bookie data capture.<br><strong>Be sure you have selected YOUR BETS.</strong><br>Refresh the Bookie page if this persists.';
    }
    return escapeHtml(message);
  }

  function getRefreshErrorSummary(error) {
    const message = String(error?.message || error || 'Unknown error');
    const lower = message.toLowerCase();
    if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
      return 'Network issue while contacting score providers.';
    }
    if (lower.includes('api-sports') && lower.includes('key')) {
      return 'API-Sports key is missing or unavailable.';
    }
    if (lower.includes('pandascore') && lower.includes('token')) {
      return 'PandaScore token is missing or unavailable.';
    }
    return 'Refresh failed.';
  }

  function renderError(error) {
    const panel   = getOrCreatePanel();
    const content = panel.querySelector('.tm-bookie-content');
    const summary = getRefreshErrorSummary(error);
    const detail = renderErrorBody(error);
    const action = 'Try Refresh now. Check source settings and keys if this continues.';
    clearActiveDetails();
    latestRenderableMatches = [];
    const det = document.getElementById(DETAILS_ID);
    if (det) det.style.display = 'none';
    content.innerHTML = `
      <div class="tm-bookie-error">
        <div class="tm-bookie-empty-title">${escapeHtml(summary)}</div>
        <div class="tm-bookie-empty-detail">${escapeHtml(action)}</div>
        ${uiSettings.enableDebugMode ? `<div class="tm-bookie-error-debug">${detail}</div>` : ''}
      </div>
      ${renderCopyTools()}
      ${renderSettingsTools()}`;
    bindCopyTools();
    bindSettingsTools();
  }

  // -- Panel creation + full CSS -------------------------------------------------

  function getOrCreatePanel() {
    let panel = document.getElementById(PANEL_ID);

    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;

      panel.innerHTML = `
        <div class="tm-bookie-header">
          <div class="tm-bookie-title-wrap">
            <button class="tm-bookie-panel-toggle" type="button" title="Hide scores panel" aria-label="Hide scores panel">⟫</button>
            <div class="tm-bookie-header-title">Scores</div>
          </div>
          <div class="tm-bookie-powered">
            <span class="tm-bookie-powered-text">Powered by</span>
            <span class="tm-bookie-source-list">
              ${renderPoweredBySources(getInitialHeaderSources())}
            </span>
            <button class="tm-bookie-refresh" title="Refresh now">↻</button>
          </div>
        </div>
        <div class="tm-bookie-content">Waiting for Torn data...</div>
      `;
      panel.classList.toggle('tm-no-powered-sources', !getInitialHeaderSources().length);

      document.body.appendChild(panel);

      const style = document.createElement('style');
      style.textContent = `
#${PANEL_ID} {
  --tm-bg: #1f1f1f;
  --tm-bg-2: #242424;
  --tm-bg-3: #111111;
  --tm-bg-4: #191919;
  --tm-hover: #292929;
  --tm-border: #3a3a3a;
  --tm-border-2: #555555;
  --tm-text: #ffffff;
  --tm-muted: #b8b8b8;
  --tm-meta: #cfcfcf;
  --tm-accent: #cc0000;
  --tm-warn: #ffcc00;
  --tm-good: #2a6b3a;
  --tm-bad: #a33;
  --tm-success: var(--tm-good);
  --tm-success-bg: color-mix(in srgb, var(--tm-good) 22%, transparent);
  --tm-info: var(--tm-accent);
  --tm-info-bg: color-mix(in srgb, var(--tm-accent) 18%, transparent);
  --tm-warning: var(--tm-warn);
  --tm-warning-bg: color-mix(in srgb, var(--tm-warn) 16%, transparent);
  --tm-danger: var(--tm-bad);
  --tm-danger-bg: color-mix(in srgb, var(--tm-bad) 22%, transparent);
  --tm-focus: var(--tm-accent);
  --tm-card-bg: #ffffff;
  --tm-card-text: #111111;
  --tm-card-border: #e5e5e5;
  --tm-source-espn: #cc0000;
  --tm-source-sofascore: #0b7fff;
  --tm-source-livescore: #00a651;
  --tm-source-thescore: #e8142e;
  --tm-source-bbcsport: #bb1919;
  --tm-source-torn: #444444;
  --tm-font: Arial, Helvetica, sans-serif;

  position: fixed;
  top: ${PANEL_TOP}px;
  right: ${EDGE_GAP}px;
  width: ${PANEL_WIDTH}px;
  max-height: calc(100vh - 150px);
  z-index: 999999;
  display: flex;
  flex-direction: column;
  background: var(--tm-bg);
  color: var(--tm-text);
  border: 1px solid var(--tm-border);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.45);
  font-family: var(--tm-font);
  font-size: 13px;
  overflow: hidden;
}

#${PANEL_ID}.tm-layout-left {
  right: auto;
  left: ${EDGE_GAP}px;
}

#${PANEL_ID}.tm-theme-bloody {
  --tm-bg: #0a0a0b;
  --tm-bg-2: #141416;
  --tm-bg-3: #1c1b1f;
  --tm-bg-4: #2a0003;
  --tm-hover: #950606;
  --tm-border: #34272a;
  --tm-border-2: #4a0508;
  --tm-text: #f2ece8;
  --tm-muted: #b8aaa6;
  --tm-meta: #b8aaa6;
  --tm-accent: #780606;
  --tm-warn: #e3a13b;
  --tm-good: #5dba6d;
  --tm-bad: #b3262e;
  --tm-card-bg: #141416;
  --tm-card-text: #f2ece8;
  --tm-card-border: #34272a;
  --tm-source-espn: #b3262e;
  --tm-source-sofascore: #950606;
  --tm-source-livescore: #780606;
  --tm-source-thescore: #b3262e;
  --tm-source-bbcsport: #950606;
  --tm-source-torn: #4a0508;
  --tm-bloody-row-image:
    url("data:image/jpeg;base64,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") center / cover no-repeat;
  background: var(--tm-bg);
}

#${PANEL_ID}.tm-theme-bloody .tm-bookie-content {
  background: transparent;
}

#${PANEL_ID}.tm-theme-cyberpunk {
  --things-pink: #ff82b2;
  --things-teal: #3eb4bf;
  --tm-bg: #1c2127;
  --tm-bg-2: #282c34;
  --tm-bg-3: #181c20;
  --tm-bg-4: #2c313c;
  --tm-hover: #3f3f3f;
  --tm-border: #35393e;
  --tm-border-2: #555555;
  --tm-text: #dadada;
  --tm-muted: #999999;
  --tm-meta: #bababa;
  --tm-accent: #2e80f2;
  --tm-warn: #e5b567;
  --tm-good: #3eb4bf;
  --tm-bad: #e83e3e;
  --tm-card-bg: #282c34;
  --tm-card-text: #dadada;
  --tm-card-border: #35393e;
  --tm-game-header-accent: var(--things-pink);
  --tm-game-meta-accent: var(--things-teal);
  --tm-source-espn: #e83e3e;
  --tm-source-sofascore: #2e80f2;
  --tm-source-livescore: #3eb4bf;
  --tm-source-thescore: #ff82b2;
  --tm-source-bbcsport: #e87d3e;
  --tm-source-torn: #9e86c8;
}

#${PANEL_ID}.tm-theme-light {
  --tm-bg: #f6f7f9;
  --tm-bg-2: #ffffff;
  --tm-bg-3: #e9edf2;
  --tm-bg-4: #eef1f5;
  --tm-hover: #e1e7ef;
  --tm-border: #c7d0dc;
  --tm-border-2: #8896a8;
  --tm-text: #18212f;
  --tm-muted: #617083;
  --tm-meta: #455466;
  --tm-accent: #2d6cdf;
  --tm-warn: #9a6b00;
  --tm-good: #1f7a46;
  --tm-bad: #a33;
  --tm-card-bg: #ffffff;
  --tm-card-text: #18212f;
  --tm-card-border: #d7dee8;
  --tm-source-espn: #d71920;
  --tm-source-sofascore: #0b7fff;
  --tm-source-livescore: #00843d;
  --tm-source-thescore: #c00020;
  --tm-source-bbcsport: #990000;
  --tm-source-torn: #667085;
}

#${PANEL_ID}.tm-theme-c64 {
  --burnt-orange: #A94B24;
  --red: #B85C38;
  --tm-bg: #202124;
  --tm-bg-2: #313236;
  --tm-bg-3: #292A2D;
  --tm-bg-4: #3A3B3F;
  --tm-hover: #56575B;
  --tm-border: #48494D;
  --tm-border-2: #66676A;
  --tm-text: #E5E3D8;
  --tm-muted: #A3A3A0;
  --tm-meta: #C2C1BA;
  --tm-accent: #D9782D;
  --tm-warn: #E3A13B;
  --tm-good: #E5D6B0;
  --tm-bad: #B85C38;
  --tm-card-bg: #313236;
  --tm-card-text: #E5E3D8;
  --tm-card-border: #48494D;
  --tm-game-header-accent: var(--burnt-orange);
  --tm-game-meta-accent: var(--red);
  --tm-source-espn: #B85C38;
  --tm-source-sofascore: #D9782D;
  --tm-source-livescore: #E3A13B;
  --tm-source-thescore: #A94B24;
  --tm-source-bbcsport: #B85C38;
  --tm-source-torn: #838487;
  --tm-font: Arial, Helvetica, sans-serif;
}

.tm-bookie-action-notice {
  --tm-bg: #1f1f1f;
  --tm-bg-2: #242424;
  --tm-border: #3a3a3a;
  --tm-text: #ffffff;
  --tm-muted: #b8b8b8;
  --tm-accent: #cc0000;
  --tm-warn: #ffcc00;
  --tm-good: #2a6b3a;
  --tm-bad: #a33;
  --tm-success: var(--tm-good);
  --tm-success-bg: color-mix(in srgb, var(--tm-good) 22%, transparent);
  --tm-info: var(--tm-accent);
  --tm-info-bg: color-mix(in srgb, var(--tm-accent) 18%, transparent);
  --tm-warning: var(--tm-warn);
  --tm-warning-bg: color-mix(in srgb, var(--tm-warn) 16%, transparent);
  --tm-danger: var(--tm-bad);
  --tm-danger-bg: color-mix(in srgb, var(--tm-bad) 22%, transparent);
  --tm-focus: var(--tm-accent);
  position: fixed;
  bottom: 24px;
  z-index: 1000000;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  width: min(320px, calc(100vw - 24px));
  padding: 10px 12px 12px;
  color: var(--tm-text);
  background: color-mix(in srgb, var(--tm-bg-2) 96%, #000);
  border: 1px solid var(--tm-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.42);
  font-family: Arial, Helvetica, sans-serif;
  overflow: hidden;
}

.tm-bookie-action-notice.tm-layout-right {
  right: ${EDGE_GAP}px;
}

.tm-bookie-action-notice.tm-layout-left {
  left: ${EDGE_GAP}px;
}

.tm-bookie-action-notice.tm-theme-bloody {
  --tm-bg: #0a0a0b;
  --tm-bg-2: #141416;
  --tm-border: #34272a;
  --tm-text: #f2ece8;
  --tm-muted: #b8aaa6;
  --tm-accent: #780606;
  --tm-warn: #e3a13b;
  --tm-good: #5dba6d;
  --tm-bad: #b3262e;
}

.tm-bookie-action-notice.tm-theme-cyberpunk {
  --tm-bg: #1c2127;
  --tm-bg-2: #282c34;
  --tm-border: #35393e;
  --tm-text: #dadada;
  --tm-muted: #999999;
  --tm-accent: #2e80f2;
  --tm-warn: #e5b567;
  --tm-good: #3eb4bf;
  --tm-bad: #e83e3e;
}

.tm-bookie-action-notice.tm-theme-light {
  --tm-bg: #f6f7f9;
  --tm-bg-2: #ffffff;
  --tm-border: #c7d0dc;
  --tm-text: #18212f;
  --tm-muted: #617083;
  --tm-accent: #2d6cdf;
  --tm-warn: #9a6b00;
  --tm-good: #1f7a46;
  --tm-bad: #a33;
}

.tm-bookie-action-notice.tm-theme-c64 {
  --tm-bg: #202124;
  --tm-bg-2: #313236;
  --tm-border: #48494D;
  --tm-text: #E5E3D8;
  --tm-muted: #A3A3A0;
  --tm-accent: #D9782D;
  --tm-warn: #E3A13B;
  --tm-good: #E5D6B0;
  --tm-bad: #B85C38;
}

.tm-bookie-action-notice .tm-bookie-notice-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 900;
  line-height: 1;
}

.tm-bookie-action-notice.tm-notice-success .tm-bookie-notice-icon {
  color: var(--tm-success);
  background: var(--tm-success-bg);
}

.tm-bookie-action-notice.tm-notice-info .tm-bookie-notice-icon,
.tm-bookie-action-notice.tm-notice-loading .tm-bookie-notice-icon {
  color: var(--tm-info);
  background: var(--tm-info-bg);
}

.tm-bookie-action-notice.tm-notice-warning .tm-bookie-notice-icon {
  color: var(--tm-warning);
  background: var(--tm-warning-bg);
}

.tm-bookie-action-notice.tm-notice-error .tm-bookie-notice-icon {
  color: var(--tm-danger);
  background: var(--tm-danger-bg);
}

.tm-bookie-action-notice.tm-notice-loading .tm-bookie-notice-icon::before {
  content: '';
  width: 13px;
  height: 13px;
  border: 2px solid color-mix(in srgb, var(--tm-info) 35%, transparent);
  border-top-color: var(--tm-info);
  border-radius: 999px;
  animation: tm-bookie-spin 0.8s linear infinite;
}

.tm-bookie-notice-copy {
  min-width: 0;
}

.tm-bookie-notice-title {
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
}

.tm-bookie-notice-detail {
  margin-top: 2px;
  color: var(--tm-muted);
  font-size: 11px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tm-bookie-notice-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--tm-info);
  transform-origin: left center;
  animation: tm-bookie-notice-progress 2200ms linear forwards;
}

.tm-bookie-action-notice.tm-notice-success .tm-bookie-notice-progress {
  background: var(--tm-success);
}

.tm-bookie-action-notice.tm-notice-warning .tm-bookie-notice-progress {
  background: var(--tm-warning);
  animation-duration: 3500ms;
}

.tm-bookie-action-notice.tm-notice-error .tm-bookie-notice-progress {
  background: var(--tm-danger);
  animation-duration: 3500ms;
}

.tm-bookie-action-notice.tm-notice-loading .tm-bookie-notice-progress {
  animation: none;
}

@keyframes tm-bookie-spin {
  to { transform: rotate(360deg); }
}

@keyframes tm-bookie-notice-progress {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

@media (max-width: 420px) {
  .tm-bookie-action-notice.tm-layout-left,
  .tm-bookie-action-notice.tm-layout-right {
    left: 12px;
    right: 12px;
    width: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tm-bookie-action-notice.tm-notice-loading .tm-bookie-notice-icon::before,
  .tm-bookie-notice-progress,
  #${PANEL_ID} .tm-bookie-copy-btn.is-loading::before,
  #${PANEL_ID} .tm-bookie-debug-report-btn.is-loading::before {
    animation: none;
  }
}

#${PANEL_ID}.tm-bookie-panel-hidden {
  width: auto;
  max-height: none;
  right: 4px;
  left: auto;
  background: transparent;
  color: var(--tm-text);
  border: 0;
  border-radius: 0;
  box-shadow: none;
  overflow: visible;
}

#${PANEL_ID}.tm-layout-left.tm-bookie-panel-hidden {
  right: auto;
  left: 4px;
}

#${PANEL_ID} .tm-bookie-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  background: var(--tm-bg-3);
  border-bottom: 3px solid var(--tm-accent);
  flex-shrink: 0;
}

#${PANEL_ID}.tm-bookie-panel-hidden .tm-bookie-header {
  padding: 0;
  background: transparent;
  border-bottom: 0;
  justify-content: flex-end;
}

#${PANEL_ID} .tm-bookie-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

#${PANEL_ID} .tm-bookie-panel-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(17,17,17,0.72);
  color: rgba(255,255,255,0.9);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
}

#${PANEL_ID} .tm-bookie-panel-toggle:hover {
  background: rgba(40,40,40,0.88);
  border-color: var(--tm-accent);
  color: #ffffff;
}

#${PANEL_ID}.tm-bookie-panel-hidden .tm-bookie-panel-toggle {
  width: 24px;
  height: 40px;
  border-radius: 6px 0 0 6px;
  background: rgba(17,17,17,0.72);
}

#${PANEL_ID}.tm-layout-left.tm-bookie-panel-hidden .tm-bookie-panel-toggle {
  border-radius: 0 6px 6px 0;
}

#${PANEL_ID}.tm-bookie-panel-hidden .tm-bookie-header-title,
#${PANEL_ID}.tm-bookie-panel-hidden .tm-bookie-powered,
#${PANEL_ID}.tm-bookie-panel-hidden .tm-bookie-content {
  display: none;
}

#${PANEL_ID} .tm-bookie-header-title {
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.35px;
  color: var(--tm-text);
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-powered {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}

#${PANEL_ID}.tm-hide-powered .tm-bookie-powered-text,
#${PANEL_ID}.tm-hide-powered .tm-bookie-source-list,
#${PANEL_ID}.tm-no-powered-sources .tm-bookie-powered-text,
#${PANEL_ID}.tm-no-powered-sources .tm-bookie-source-list {
  display: none;
}

#${PANEL_ID} .tm-bookie-powered-text {
  color: var(--tm-muted);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18px;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-source-list {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  min-width: 0;
  flex-wrap: wrap;
}

#${PANEL_ID} .tm-bookie-source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  padding: 0 5px;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-source-icon-badge {
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  overflow: hidden;
}

#${PANEL_ID} .tm-bookie-source-icon {
  display: block;
  height: 16px;
  width: auto;
  max-width: 52px;
  object-fit: contain;
}

/* When a provider badge shows its icon, neutralize the colored text-badge styling.
   Double-class selectors out-specify the single-class colored rules below. */
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-espn,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-sofascore,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-livescore,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-thescore,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-bbcsport,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-espncricinfo,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-apisports,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-apifootball,
#${PANEL_ID} .tm-bookie-source-icon-badge.tm-bookie-source-pandascore {
  background: transparent;
  color: inherit;
  letter-spacing: 0;
  font-family: inherit;
}

#${PANEL_ID} .tm-bookie-source-espn {
  background: var(--tm-source-espn);
  color: #ffffff;
  letter-spacing: -0.3px;
  font-family: Arial Black, Arial, Helvetica, sans-serif;
}

#${PANEL_ID} .tm-bookie-source-sofascore {
  background: var(--tm-source-sofascore);
  color: #ffffff;
  font-family: Arial, Helvetica, sans-serif;
}

#${PANEL_ID} .tm-bookie-source-torn {
  background: var(--tm-source-torn);
  color: #ffffff;
  font-family: Arial, Helvetica, sans-serif;
}

#${PANEL_ID} .tm-bookie-source-livescore {
  background: var(--tm-source-livescore);
  color: #fff;
  font-family: Arial, Helvetica, sans-serif;
}

#${PANEL_ID} .tm-bookie-source-thescore {
  background: var(--tm-source-thescore);
  color: #fff;
  font-family: Arial, Helvetica, sans-serif;
}

#${PANEL_ID} .tm-bookie-source-bbcsport {
  background: var(--tm-source-bbcsport);
  color: #fff;
  font-family: Arial, Helvetica, sans-serif;
}

#${PANEL_ID} .tm-bookie-refresh {
  border: 1px solid var(--tm-border-2);
  background: var(--tm-bg-2);
  color: var(--tm-text);
  border-radius: 4px;
  cursor: pointer;
  padding: 1px 7px;
  font-size: 14px;
  line-height: 18px;
  flex-shrink: 0;
}

#${PANEL_ID} .tm-bookie-refresh:hover {
  background: var(--tm-hover);
  border-color: var(--tm-accent);
}

#${PANEL_ID} .tm-bookie-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 14px;
  box-sizing: border-box;
  background: var(--tm-bg);
  scrollbar-width: thin;
  scrollbar-color: var(--tm-accent) var(--tm-bg-3);
}

#${PANEL_ID} .tm-bookie-content::-webkit-scrollbar {
  width: 10px;
}

#${PANEL_ID} .tm-bookie-content::-webkit-scrollbar-track {
  background: var(--tm-bg-3);
}

#${PANEL_ID} .tm-bookie-content::-webkit-scrollbar-thumb {
  background: var(--tm-accent);
  border: 2px solid var(--tm-bg-3);
  border-radius: 999px;
}

#${PANEL_ID} .tm-bookie-content::-webkit-scrollbar-thumb:hover {
  background: var(--tm-hover);
}

#${PANEL_ID} .tm-bookie-updated {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  color: var(--tm-muted);
  font-size: 11px;
  border-bottom: 1px solid var(--tm-border);
  background: var(--tm-bg-4);
}

#${PANEL_ID} .tm-bookie-updated-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#${PANEL_ID} .tm-bookie-updated-state {
  margin-left: 6px;
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  vertical-align: middle;
}

#${PANEL_ID} .tm-bookie-updated-state-refreshing {
  color: var(--tm-info);
}

#${PANEL_ID} .tm-bookie-updated-state-refreshing::before {
  content: '';
  width: 8px;
  height: 8px;
  margin-right: 5px;
  border: 2px solid color-mix(in srgb, var(--tm-info) 35%, transparent);
  border-top-color: var(--tm-info);
  border-radius: 999px;
  animation: tm-bookie-spin 0.8s linear infinite;
}

#${PANEL_ID} .tm-bookie-updated-state-warning {
  color: var(--tm-warning);
}

#${PANEL_ID} .tm-bookie-refresh-pill {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  border: 1px solid var(--tm-border);
  border-radius: 999px;
  overflow: hidden;
  background: var(--tm-bg-2);
  flex-shrink: 0;
}

#${PANEL_ID} .tm-bookie-refresh-mode {
  border: 0;
  border-right: 1px solid var(--tm-border);
  background: var(--tm-bg-2);
  color: var(--tm-muted);
  cursor: pointer;
  padding: 2px 7px;
  font: inherit;
  font-size: 10px;
  line-height: 14px;
}

#${PANEL_ID} .tm-bookie-refresh-mode:last-child {
  border-right: 0;
}

#${PANEL_ID} .tm-bookie-refresh-mode:hover {
  background: var(--tm-hover);
  color: var(--tm-text);
}

#${PANEL_ID} .tm-bookie-refresh-mode.is-active {
  background: var(--tm-bg-3);
  color: var(--tm-text);
}

#${PANEL_ID} .tm-bookie-apisports-mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

#${PANEL_ID} .tm-bookie-apisports-mode-label {
  font-size: 11px;
  color: var(--tm-muted);
}

#${PANEL_ID} .tm-bookie-apisports-mode-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--tm-border);
  border-radius: 999px;
  overflow: hidden;
  background: var(--tm-bg-2);
}

#${PANEL_ID} .tm-bookie-apisports-mode {
  border: 0;
  border-right: 1px solid var(--tm-border);
  background: var(--tm-bg-2);
  color: var(--tm-muted);
  cursor: pointer;
  padding: 2px 9px;
  font: inherit;
  font-size: 10px;
  line-height: 14px;
}

#${PANEL_ID} .tm-bookie-apisports-mode:last-child {
  border-right: 0;
}

#${PANEL_ID} .tm-bookie-apisports-mode:hover {
  background: var(--tm-hover);
  color: var(--tm-text);
}

#${PANEL_ID} .tm-bookie-apisports-mode.is-active {
  background: var(--tm-bg-3);
  color: var(--tm-text);
}

#${PANEL_ID} .tm-bookie-section-title {
  padding: 8px 12px;
  background: var(--tm-bg-3);
  color: var(--tm-text);
  font-weight: 800;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border-top: 1px solid var(--tm-border);
  border-bottom: 1px solid var(--tm-border);
}

#${PANEL_ID} .tm-bookie-sport-group,
#${PANEL_ID} .tm-bookie-copy-group,
#${PANEL_ID} .tm-bookie-settings-group {
  border-bottom: 1px solid var(--tm-border);
}

#${PANEL_ID} .tm-bookie-sport-header,
#${PANEL_ID} .tm-bookie-copy-header,
#${PANEL_ID} .tm-bookie-settings-header {
  width: 100%;
  border: 0;
  background: var(--tm-bg-2);
  color: var(--tm-text);
  cursor: pointer;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: var(--tm-font);
  text-align: left;
}

#${PANEL_ID} .tm-bookie-sport-header:hover,
#${PANEL_ID} .tm-bookie-copy-header:hover,
#${PANEL_ID} .tm-bookie-settings-header:hover {
  background: var(--tm-hover);
}

#${PANEL_ID} .tm-bookie-sport-left,
#${PANEL_ID} .tm-bookie-copy-left,
#${PANEL_ID} .tm-bookie-settings-left {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

#${PANEL_ID} .tm-bookie-caret {
  color: var(--tm-muted);
  font-size: 11px;
  width: 10px;
  text-align: center;
  flex-shrink: 0;
}

#${PANEL_ID} .tm-bookie-sport-name,
#${PANEL_ID} .tm-bookie-copy-name,
#${PANEL_ID} .tm-bookie-settings-name {
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.25px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#${PANEL_ID} .tm-bookie-sport-count,
#${PANEL_ID} .tm-bookie-copy-hint,
#${PANEL_ID} .tm-bookie-settings-hint {
  color: var(--tm-muted);
  font-size: 11px;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-row {
  padding: 10px 12px;
  border-bottom: 1px solid var(--tm-border);
  background: var(--tm-bg-2);
  position: relative;
}

#${PANEL_ID} .tm-bookie-row:nth-child(even) {
  background: var(--tm-bg);
}

#${PANEL_ID} .tm-bookie-row > * {
  position: relative;
  z-index: 1;
}

#${PANEL_ID} .tm-bookie-row.tm-row-selected {
  background: color-mix(in srgb, var(--tm-info-bg) 54%, var(--tm-bg-2));
  box-shadow: inset 3px 0 0 var(--tm-info);
}

#${PANEL_ID} .tm-bookie-row.tm-row-details-active {
  background: color-mix(in srgb, var(--tm-info-bg) 68%, var(--tm-bg-2));
  box-shadow: inset 4px 0 0 var(--tm-accent);
}

#${PANEL_ID} .tm-bookie-row.tm-row-pinned {
  box-shadow: inset 3px 0 0 var(--tm-warning);
}

#${PANEL_ID} .tm-bookie-row.tm-row-pinned.tm-row-selected,
#${PANEL_ID} .tm-bookie-row.tm-row-pinned.tm-row-details-active {
  box-shadow: inset 4px 0 0 var(--tm-accent), inset 7px 0 0 color-mix(in srgb, var(--tm-warning) 46%, transparent);
}

#${PANEL_ID} .tm-bookie-row.tm-row-selected.tm-row-details-active {
  box-shadow: inset 4px 0 0 var(--tm-accent), inset 7px 0 0 color-mix(in srgb, var(--tm-info) 46%, transparent);
}

#${PANEL_ID} .tm-bookie-row.tm-row-unmatched {
  background: color-mix(in srgb, var(--tm-warning-bg) 42%, var(--tm-bg-2));
}

#${PANEL_ID}.tm-theme-bloody .tm-bookie-live-row {
  background: var(--tm-bg);
  overflow: hidden;
}

#${PANEL_ID}.tm-theme-bloody .tm-bookie-live-row:nth-child(even) {
  background: var(--tm-bg);
}

#${PANEL_ID}.tm-theme-bloody .tm-bookie-live-row::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(rgba(10,10,11,0.52), rgba(10,10,11,0.72)),
    var(--tm-bloody-row-image);
}

#${PANEL_ID}.tm-theme-bloody .tm-bookie-row.tm-row-selected::before,
#${PANEL_ID}.tm-theme-bloody .tm-bookie-row.tm-row-details-active::before {
  background:
    linear-gradient(rgba(10,10,11,0.38), rgba(10,10,11,0.62)),
    var(--tm-bloody-row-image);
}

#${PANEL_ID} .tm-bookie-row:last-child {
  border-bottom: none;
}

#${PANEL_ID} .tm-bookie-title {
  font-weight: 700;
  line-height: 1.25;
  margin-bottom: 7px;
  color: var(--tm-text);
}

#${PANEL_ID}.tm-theme-cyberpunk .tm-bookie-title,
#${PANEL_ID}.tm-theme-c64 .tm-bookie-title {
  color: var(--tm-game-header-accent);
}

#${PANEL_ID} .tm-bookie-live-title {
  font-weight: 400;
  font-size: 11px;
  line-height: 1.15;
  margin-bottom: 5px;
  color: var(--tm-muted);
}

#${PANEL_ID} .tm-bookie-title-stack {
  flex: 1 1 auto;
  min-width: 0;
}

#${PANEL_ID} .tm-bookie-row-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 6px;
  min-height: 17px;
}

#${PANEL_ID} .tm-bookie-row-pill {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 15px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--tm-muted) 34%, transparent);
  border-radius: 999px;
  color: var(--tm-muted);
  background: color-mix(in srgb, var(--tm-bg-3) 82%, transparent);
  font-size: 9px;
  font-weight: 800;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-row-pill.tm-pill-live {
  color: var(--tm-success);
  border-color: color-mix(in srgb, var(--tm-success) 44%, transparent);
  background: var(--tm-success-bg);
}

#${PANEL_ID} .tm-bookie-row-pill.tm-pill-upcoming {
  color: var(--tm-info);
  border-color: color-mix(in srgb, var(--tm-info) 44%, transparent);
  background: var(--tm-info-bg);
}

#${PANEL_ID} .tm-bookie-row-pill.tm-pill-unmatched {
  color: var(--tm-warning);
  border-color: color-mix(in srgb, var(--tm-warning) 48%, transparent);
  background: var(--tm-warning-bg);
}

#${PANEL_ID} .tm-bookie-row-pill.tm-pill-source,
#${PANEL_ID} .tm-bookie-row-pill.tm-pill-confidence {
  max-width: 132px;
}

#${PANEL_ID}.tm-theme-cyberpunk .tm-bookie-live-title,
#${PANEL_ID}.tm-theme-c64 .tm-bookie-live-title {
  color: var(--tm-game-header-accent);
}

#${PANEL_ID} .tm-bookie-scoreboard,
#${PANEL_ID} .tm-bookie-upcoming-box {
  margin: 6px 0 7px;
  border: 1px solid var(--tm-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--tm-card-bg);
  color: var(--tm-card-text);
}

#${PANEL_ID} .tm-bookie-scoreboard-compact {
  background: var(--tm-bg-3);
  color: var(--tm-text);
  border-color: var(--tm-border);
}

#${PANEL_ID} .tm-bookie-scoreboard-classic {
  background: var(--tm-card-bg);
  color: var(--tm-card-text);
  border-color: var(--tm-border);
}

#${PANEL_ID} .tm-bookie-scoreboard-minimal {
  background: var(--tm-bg-3);
  color: var(--tm-text);
  border-color: var(--tm-border);
  padding: 5px 7px;
}

#${PANEL_ID} .tm-bookie-team-row,
#${PANEL_ID} .tm-bookie-upcoming-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--tm-card-border);
}

#${PANEL_ID} .tm-bookie-scoreboard-compact .tm-bookie-team-row {
  border-bottom: 1px solid var(--tm-border);
  padding: 7px 8px;
}

#${PANEL_ID} .tm-bookie-scoreboard-classic .tm-bookie-team-row {
  border-bottom: 1px solid var(--tm-card-border);
}

#${PANEL_ID} .tm-bookie-team-row:last-child,
#${PANEL_ID} .tm-bookie-upcoming-row:last-child {
  border-bottom: none;
}

#${PANEL_ID} .tm-bookie-team-name,
#${PANEL_ID} .tm-bookie-upcoming-team {
  font-weight: 400;
  line-height: 1.2;
  color: var(--tm-card-text);
}

#${PANEL_ID} .tm-bookie-scoreboard-compact .tm-bookie-team-name {
  color: var(--tm-text);
  font-weight: 700;
}

#${PANEL_ID} .tm-bookie-scoreboard-classic .tm-bookie-team-name {
  color: var(--tm-card-text);
}

#${PANEL_ID} .tm-bookie-team-score {
  min-width: 30px;
  text-align: right;
  font-size: 18px;
  font-weight: 400;
  color: var(--tm-card-text);
}

#${PANEL_ID} .tm-bookie-scoreboard-compact .tm-bookie-team-score {
  min-width: 34px;
  padding: 2px 8px;
  background: var(--tm-accent);
  color: #ffffff;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 800;
  text-align: center;
}

#${PANEL_ID} .tm-bookie-scoreboard-classic .tm-bookie-team-score {
  color: var(--tm-card-text);
}

#${PANEL_ID} .tm-bookie-minimal-score-line {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
  color: var(--tm-text);
  font-weight: 800;
  line-height: 1.1;
  text-align: center;
  min-height: 20px;
}

#${PANEL_ID} .tm-bookie-minimal-team:first-child {
  text-align: right;
}

#${PANEL_ID} .tm-bookie-minimal-team:last-child {
  text-align: left;
}

#${PANEL_ID} .tm-bookie-minimal-score {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--tm-accent);
  color: #ffffff;
  font-size: 12px;
  line-height: 16px;
  flex-shrink: 0;
}

#${PANEL_ID} .tm-bookie-minimal-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 11px;
}

#${PANEL_ID} .tm-bookie-minimal-status {
  color: var(--tm-muted);
}

#${PANEL_ID} .tm-bookie-minimal-bet {
  color: var(--tm-muted);
  font-weight: 600;
  text-align: right;
}

#${PANEL_ID} .tm-bookie-upcoming-label {
  color: var(--tm-muted);
  font-size: 11px;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-meta {
  color: var(--tm-meta);
  font-size: 12px;
  margin-bottom: 5px;
}

#${PANEL_ID} .tm-bookie-status-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

#${PANEL_ID} .tm-bookie-status {
  color: var(--tm-text);
  font-weight: 700;
}

#${PANEL_ID} .tm-bookie-amount {
  color: var(--tm-text);
  font-weight: 700;
  text-align: right;
  white-space: nowrap;
}

#${PANEL_ID}.tm-theme-cyberpunk .tm-bookie-status,
#${PANEL_ID}.tm-theme-cyberpunk .tm-bookie-amount,
#${PANEL_ID}.tm-theme-cyberpunk .tm-bookie-minimal-status,
#${PANEL_ID}.tm-theme-cyberpunk .tm-bookie-minimal-bet,
#${PANEL_ID}.tm-theme-c64 .tm-bookie-status,
#${PANEL_ID}.tm-theme-c64 .tm-bookie-amount,
#${PANEL_ID}.tm-theme-c64 .tm-bookie-minimal-status,
#${PANEL_ID}.tm-theme-c64 .tm-bookie-minimal-bet {
  color: var(--tm-game-meta-accent);
}

#${PANEL_ID} .tm-bookie-bet-label {
  color: var(--tm-muted);
  font-weight: 400;
}

#${PANEL_ID} .tm-bookie-unmatched {
  color: var(--tm-warn);
  font-size: 12px;
  margin: 6px 0 7px;
}

#${PANEL_ID} .tm-bookie-copy-body,
#${PANEL_ID} .tm-bookie-settings-body {
  padding: 10px 12px 12px;
  background: var(--tm-bg-2);
  border-top: 1px solid var(--tm-border);
}

#${PANEL_ID} .tm-bookie-copy-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
}

#${PANEL_ID} .tm-bookie-copy-btn {
  flex: 1;
  padding: 9px 10px;
  color: var(--tm-text);
  background: var(--tm-bg-2);
  border: 1px solid var(--tm-border-2);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-family: var(--tm-font);
  box-shadow: 0 2px 8px rgba(0,0,0,0.35);
  min-height: 34px;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

#${PANEL_ID} .tm-bookie-copy-btn:hover:not(:disabled) {
  filter: brightness(1.16);
}

#${PANEL_ID} .tm-bookie-selected-summary {
  padding: 8px 9px;
  background: color-mix(in srgb, var(--tm-bg-3) 78%, transparent);
  border: 1px solid var(--tm-border);
  border-radius: 6px;
  min-width: 0;
}

#${PANEL_ID} .tm-bookie-selected-empty {
  border-style: dashed;
}

#${PANEL_ID} .tm-bookie-selected-label,
#${PANEL_ID} .tm-bookie-copy-receipt-top {
  color: var(--tm-muted);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

#${PANEL_ID} .tm-bookie-selected-name,
#${PANEL_ID} .tm-bookie-copy-receipt-name {
  margin-top: 4px;
  color: var(--tm-text);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-selected-meta,
#${PANEL_ID} .tm-bookie-selected-empty-text {
  margin-top: 3px;
  color: var(--tm-muted);
  font-size: 10px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-selected-empty-text {
  white-space: normal;
}

#${PANEL_ID} .tm-bookie-copy-receipt-slot:empty {
  display: none;
}

#${PANEL_ID} .tm-bookie-copy-receipt {
  margin-top: 9px;
  padding: 8px 9px;
  background: var(--tm-info-bg);
  border: 1px solid color-mix(in srgb, var(--tm-info) 34%, var(--tm-border));
  border-radius: 6px;
  min-width: 0;
}

#${PANEL_ID} .tm-bookie-copy-receipt-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

#${PANEL_ID} .tm-bookie-copy-chip {
  max-width: 100%;
  padding: 2px 6px;
  color: var(--tm-info);
  background: color-mix(in srgb, var(--tm-info-bg) 72%, var(--tm-bg-2));
  border: 1px solid color-mix(in srgb, var(--tm-info) 28%, transparent);
  border-radius: 999px;
  font-size: 9px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#${PANEL_ID} .tm-bookie-copy-btn.is-loading,
#${PANEL_ID} .tm-bookie-debug-report-btn.is-loading {
  cursor: wait;
  color: var(--tm-info);
  border-color: var(--tm-info);
  background: var(--tm-info-bg);
}

#${PANEL_ID} .tm-bookie-copy-btn.is-success,
#${PANEL_ID} .tm-bookie-debug-report-btn.is-success {
  color: var(--tm-success);
  border-color: var(--tm-success);
  background: var(--tm-success-bg);
}

#${PANEL_ID} .tm-bookie-copy-btn.is-error,
#${PANEL_ID} .tm-bookie-debug-report-btn.is-error {
  color: var(--tm-danger);
  border-color: var(--tm-danger);
  background: var(--tm-danger-bg);
}

#${PANEL_ID} .tm-bookie-copy-btn.is-disabled,
#${PANEL_ID} .tm-bookie-debug-report-btn.is-disabled,
#${PANEL_ID} .tm-bookie-copy-btn:disabled,
#${PANEL_ID} .tm-bookie-debug-report-btn:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

#${PANEL_ID} .tm-bookie-copy-btn.is-loading::before,
#${PANEL_ID} .tm-bookie-debug-report-btn.is-loading::before {
  content: '';
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 6px;
  border: 2px solid color-mix(in srgb, var(--tm-info) 35%, transparent);
  border-top-color: var(--tm-info);
  border-radius: 999px;
  vertical-align: -1px;
  animation: tm-bookie-spin 0.8s linear infinite;
}

#${PANEL_ID} .tm-bookie-copy-note {
  margin-top: 8px;
  color: var(--tm-muted);
  font-size: 8px;
  line-height: 1.3;
  white-space: normal;
}

#${PANEL_ID} .tm-bookie-settings-grid {
  display: grid;
  gap: 9px;
}

#${PANEL_ID} .tm-bookie-setting-row {
  display: grid;
  grid-template-columns: 105px 1fr;
  align-items: center;
  gap: 8px;
}

#${PANEL_ID} .tm-bookie-setting-row label,
#${PANEL_ID} .tm-bookie-settings-label {
  color: var(--tm-muted);
  font-size: 10px;
  text-transform: uppercase;
  font-weight: 800;
  letter-spacing: 0.35px;
}

#${PANEL_ID} .tm-bookie-setting-row select {
  width: 100%;
  border: 1px solid var(--tm-border);
  background: var(--tm-bg-3);
  color: var(--tm-text);
  border-radius: 6px;
  padding: 5px 7px;
  font-size: 11px;
  font-family: var(--tm-font);
}

#${PANEL_ID} .tm-bookie-checkbox-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 8px;
}

#${PANEL_ID} .tm-bookie-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--tm-text);
  font-size: 11px;
  line-height: 1.2;
}

#${PANEL_ID} .tm-bookie-check input {
  accent-color: var(--tm-accent);
}

#${PANEL_ID} .tm-bookie-debug-report-row {
  grid-column: 1 / -1;
  margin-top: -2px;
}

#${PANEL_ID} .tm-bookie-debug-report-btn {
  width: 100%;
  border: 1px solid var(--tm-border-2);
  background: var(--tm-bg-3);
  color: var(--tm-text);
  border-radius: 6px;
  cursor: pointer;
  padding: 6px 9px;
  font-size: 11px;
  font-family: var(--tm-font);
  min-height: 30px;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

#${PANEL_ID} .tm-bookie-debug-report-btn:hover {
  background: var(--tm-hover);
  border-color: var(--tm-accent);
}

#${PANEL_ID} .tm-bookie-settings-sports {
  margin-top: 4px;
}

#${PANEL_ID} .tm-bookie-settings-note {
  color: var(--tm-meta);
  font-size: 10px;
  line-height: 1.35;
  margin-top: 4px;
}

#${PANEL_ID} .tm-bookie-settings-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 2px;
}

#${PANEL_ID} .tm-bookie-reset-btn,
#${PANEL_ID} .tm-bookie-unpin-all-btn {
  border: 1px solid var(--tm-border-2);
  background: var(--tm-bg-3);
  color: var(--tm-text);
  border-radius: 6px;
  cursor: pointer;
  padding: 6px 9px;
  font-size: 11px;
  font-family: var(--tm-font);
}

#${PANEL_ID} .tm-bookie-reset-btn:hover:not(:disabled),
#${PANEL_ID} .tm-bookie-unpin-all-btn:hover:not(:disabled) {
  background: var(--tm-hover);
  border-color: var(--tm-accent);
}

#${PANEL_ID} .tm-bookie-unpin-all-btn:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

#${DEBUG_REPORT_NOTICE_ID} {
  position: fixed;
  inset: 0;
  z-index: 1000002;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(0, 0, 0, 0.55);
  font-family: var(--tm-font, Arial, Helvetica, sans-serif);
}

#${DEBUG_REPORT_NOTICE_ID} .tm-bookie-debug-modal {
  width: min(420px, calc(100vw - 36px));
  background: var(--tm-bg, #1f1f1f);
  color: var(--tm-text, #fff);
  border: 1px solid var(--tm-border-2, #555);
  border-radius: 8px;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
  padding: 14px;
}

#${DEBUG_REPORT_NOTICE_ID} .tm-bookie-debug-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 8px;
}

#${DEBUG_REPORT_NOTICE_ID} .tm-bookie-debug-copy {
  color: var(--tm-meta, #cfcfcf);
  font-size: 12px;
  line-height: 1.4;
  margin-top: 7px;
}

#${DEBUG_REPORT_NOTICE_ID} .tm-bookie-info-link {
  color: var(--tm-accent, #cc0000);
  text-decoration: underline;
}

#${DEBUG_REPORT_NOTICE_ID} .tm-bookie-debug-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

#${DEBUG_REPORT_NOTICE_ID} .tm-bookie-debug-close {
  border: 1px solid var(--tm-border-2, #555);
  background: var(--tm-bg-3, #111);
  color: var(--tm-text, #fff);
  border-radius: 6px;
  cursor: pointer;
  padding: 6px 12px;
  font-size: 12px;
  font-family: var(--tm-font, Arial, Helvetica, sans-serif);
}

#${DEBUG_REPORT_NOTICE_ID} .tm-bookie-debug-close:hover {
  background: var(--tm-hover, #292929);
  border-color: var(--tm-accent, #cc0000);
}

#${PANEL_ID} .tm-bookie-empty,
#${PANEL_ID} .tm-bookie-error {
  padding: 12px;
  color: var(--tm-meta);
}

#${PANEL_ID} .tm-bookie-empty-title {
  color: var(--tm-text);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
}

#${PANEL_ID} .tm-bookie-empty-detail {
  margin-top: 4px;
  color: var(--tm-meta);
  font-size: 11px;
  line-height: 1.35;
}

#${PANEL_ID} .tm-bookie-refresh-warning {
  margin: 8px 12px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, var(--tm-warning) 42%, var(--tm-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--tm-warning-bg) 72%, var(--tm-bg-2));
  color: var(--tm-meta);
  font-size: 10px;
  line-height: 1.35;
}

#${PANEL_ID} .tm-bookie-error-debug {
  margin-top: 6px;
  color: var(--tm-muted);
  font-size: 10px;
  line-height: 1.35;
  word-break: break-word;
}

#${PANEL_ID} .tm-bookie-error {
  color: var(--tm-bad);
}

/* Title row with details button */
#${PANEL_ID} .tm-bookie-title-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  justify-content: space-between;
  margin-bottom: 3px;
}

#${PANEL_ID} .tm-bookie-title-row .tm-bookie-title,
#${PANEL_ID} .tm-bookie-title-row .tm-bookie-live-title {
  min-width: 0;
  margin-bottom: 0;
}

#${PANEL_ID} .tm-bookie-row-actions {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
}

#${PANEL_ID} .tm-bookie-details-btn,
#${PANEL_ID} .tm-live-pin-btn {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--tm-border);
  border-radius: 4px;
  color: var(--tm-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 1px 5px 2px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

#${PANEL_ID} .tm-live-pin-btn {
  width: 23px;
  min-width: 23px;
  height: 20px;
  padding: 0;
  font-size: 12px;
  opacity: 0.72;
}

#${PANEL_ID} .tm-bookie-details-btn:hover,
#${PANEL_ID} .tm-bookie-details-btn.tm-details-active,
#${PANEL_ID} .tm-live-pin-btn:hover,
#${PANEL_ID} .tm-live-pin-btn.is-pinned {
  background: var(--tm-accent);
  border-color: var(--tm-accent);
  color: #fff;
  opacity: 1;
}

#${PANEL_ID} .tm-row-details-active .tm-bookie-details-btn.tm-details-active {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--tm-accent) 28%, transparent);
}

#${PANEL_ID} .tm-bookie-details-btn:focus-visible,
#${PANEL_ID} .tm-live-pin-btn:focus-visible,
#${PANEL_ID} .tm-bookie-copy-btn:focus-visible,
#${PANEL_ID} .tm-bookie-debug-report-btn:focus-visible,
#${PANEL_ID} .tm-bookie-unpin-all-btn:focus-visible,
#${PANEL_ID} .tm-bookie-sport-header:focus-visible,
#${PANEL_ID} .tm-bookie-copy-header:focus-visible,
#${PANEL_ID} .tm-bookie-settings-header:focus-visible {
  outline: 2px solid var(--tm-focus);
  outline-offset: 2px;
}
      `;

      document.head.appendChild(style);

      // Inject details panel styles separately so they survive panel removal
      const detStyle = document.createElement('style');
      detStyle.textContent = `
.tm-bookie-details {
  position: fixed;
  top: ${PANEL_TOP}px;
  width: ${DETAILS_WIDTH}px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--tm-accent, #6ea3d0) var(--tm-bg-3, #111);
  background: var(--tm-bg, #1f1f1f);
  border: 1px solid var(--tm-border, #333);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  color: var(--tm-text, #e0e0e0);
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  z-index: 1000000;
  display: none;
}

.tm-bookie-details::-webkit-scrollbar,
.tm-bookie-details .tm-det-bet-panel::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.tm-bookie-details::-webkit-scrollbar-track,
.tm-bookie-details .tm-det-bet-panel::-webkit-scrollbar-track {
  background: var(--tm-bg-3, #111);
}

.tm-bookie-details::-webkit-scrollbar-thumb,
.tm-bookie-details .tm-det-bet-panel::-webkit-scrollbar-thumb {
  background: var(--tm-accent, #6ea3d0);
  border: 2px solid var(--tm-bg-3, #111);
  border-radius: 999px;
}

.tm-bookie-details::-webkit-scrollbar-thumb:hover,
.tm-bookie-details .tm-det-bet-panel::-webkit-scrollbar-thumb:hover {
  background: var(--tm-hover, var(--tm-accent, #6ea3d0));
}

.tm-bookie-details.tm-details-overlay {
  left: 50%;
  right: auto;
  top: auto;
  bottom: 12px;
  width: min(${DETAILS_WIDTH}px, calc(100vw - ${EDGE_GAP * 2}px));
  max-height: calc(100vh - 120px);
  transform: translateX(-50%);
}

/* Copy theme variables from panel to details */
.tm-bookie-details.tm-theme-default { --tm-bg:#1f1f1f;--tm-bg-2:#242424;--tm-bg-3:#111;--tm-bg-4:#2f2f2f;--tm-hover:#333;--tm-text:#e0e0e0;--tm-muted:#a0a0a0;--tm-border:#333;--tm-border-2:#4a4a4a;--tm-accent:#6ea3d0;--tm-good:#5dba6d;--tm-bad:#e06060;--tm-meta:#8a8a8a; }
.tm-bookie-details.tm-theme-bloody { --tm-bg:#0a0a0b;--tm-bg-2:#141416;--tm-bg-3:#1c1b1f;--tm-bg-4:#2a0003;--tm-hover:#950606;--tm-text:#f2ece8;--tm-muted:#b8aaa6;--tm-border:#34272a;--tm-border-2:#4a0508;--tm-accent:#b3262e;--tm-good:#5dba6d;--tm-bad:#b3262e;--tm-meta:#b8aaa6; }
.tm-bookie-details.tm-theme-cyberpunk { --things-pink:#ff82b2;--things-teal:#3eb4bf;--tm-bg:#1c2127;--tm-bg-2:#282c34;--tm-bg-3:#181c20;--tm-bg-4:#2c313c;--tm-hover:#3f3f3f;--tm-text:#dadada;--tm-muted:#999999;--tm-border:#35393e;--tm-border-2:#555555;--tm-accent:#2e80f2;--tm-good:#3eb4bf;--tm-bad:#e83e3e;--tm-meta:#bababa;--tm-game-header-accent:var(--things-pink);--tm-game-meta-accent:var(--things-teal); }
.tm-bookie-details.tm-theme-light { --tm-bg:#f5f5f5;--tm-bg-2:#ebebeb;--tm-bg-3:#ddd;--tm-bg-4:#eef1f5;--tm-hover:#e1e7ef;--tm-text:#1a1a1a;--tm-muted:#555;--tm-border:#ccc;--tm-border-2:#8896a8;--tm-accent:#1a6eb5;--tm-good:#2a7a35;--tm-bad:#b52020;--tm-meta:#666; }
.tm-bookie-details.tm-theme-c64 { --burnt-orange:#A94B24;--red:#B85C38;--tm-bg:#202124;--tm-bg-2:#313236;--tm-bg-3:#292A2D;--tm-bg-4:#3A3B3F;--tm-hover:#56575B;--tm-text:#E5E3D8;--tm-muted:#A3A3A0;--tm-border:#48494D;--tm-border-2:#66676A;--tm-accent:#D9782D;--tm-good:#E5D6B0;--tm-bad:#B85C38;--tm-meta:#C2C1BA;--tm-game-header-accent:var(--burnt-orange);--tm-game-meta-accent:var(--red); }

.tm-det-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--tm-border);
  background: var(--tm-bg-2);
  position: sticky;
  top: 0;
  z-index: 2;
  border-radius: 10px 10px 0 0;
}

.tm-det-heading {
  flex: 1;
  min-width: 0;
}

.tm-det-eyebrow {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--tm-muted);
  margin-bottom: 3px;
}

.tm-det-title {
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--tm-text);
  overflow-wrap: anywhere;
}

.tm-det-header-meta,
.tm-det-header-source,
.tm-det-source-line {
  font-size: 10px;
  line-height: 1.35;
  color: var(--tm-meta);
}

.tm-det-header-source {
  display: inline-block;
  margin-left: 4px;
  color: var(--tm-accent);
}

.tm-det-header-source-link {
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}

.tm-det-header-source-link:hover,
.tm-det-header-source-link:focus {
  color: var(--tm-text);
}

.tm-det-commentary {
  flex: 1;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--tm-text);
}

.tm-det-close {
  background: none;
  border: none;
  color: var(--tm-muted);
  cursor: pointer;
  font-size: 13px;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
}

.tm-det-close:hover { color: var(--tm-bad); }

.tm-det-summary-strip {
  padding: 7px 10px;
  border-bottom: 1px solid var(--tm-border);
  background: color-mix(in srgb, var(--tm-bg-3) 86%, transparent);
}

.tm-det-summary-score {
  color: var(--tm-text);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
}

.tm-det-summary-meta {
  margin-top: 2px;
  color: var(--tm-meta);
  font-size: 10px;
  line-height: 1.35;
}

.tm-det-venue { font-size: 10.5px; color: var(--tm-meta); }
.tm-det-status { font-size: 10.5px; color: var(--tm-accent); }
.tm-det-no-score { font-size: 10.5px; color: var(--tm-muted); }

.tm-det-body {
  padding: 8px 10px 12px;
}

.tm-det-section {
  border-bottom: 1px solid var(--tm-border);
  padding: 8px 0;
}

.tm-det-section:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

.tm-det-section-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--tm-muted);
  margin-bottom: 6px;
}

.tm-bookie-details.tm-theme-cyberpunk .tm-det-section-title,
.tm-bookie-details.tm-theme-c64 .tm-det-section-title {
  color: var(--tm-game-header-accent);
}

.tm-det-section-body {
  font-size: 11px;
  line-height: 1.45;
}

.tm-det-status-note {
  color: var(--tm-meta);
  font-size: 11px;
}

.tm-det-skeleton {
  display: grid;
  gap: 5px;
  margin: 1px 0;
}

.tm-det-skeleton-row {
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--tm-bg-3) 82%, var(--tm-border)) 20%, color-mix(in srgb, var(--tm-hover) 58%, var(--tm-bg-3)) 50%, color-mix(in srgb, var(--tm-bg-3) 82%, var(--tm-border)) 80%);
  background-size: 220% 100%;
  animation: tm-det-skeleton-shimmer 1.2s ease-in-out infinite;
}

@keyframes tm-det-skeleton-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .tm-det-skeleton-row {
    animation: none;
  }
}

.tm-det-list {
  margin: 0;
  padding-left: 16px;
  color: var(--tm-text);
}

.tm-det-list li {
  margin-bottom: 3px;
}

.tm-det-list li.tm-det-fact-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.tm-det-fact-source {
  flex: none;
  white-space: nowrap;
  color: var(--tm-accent);
  text-decoration: none;
  font-size: 10px;
}

.tm-det-fact-source:hover {
  text-decoration: underline;
}

.tm-det-bet-panel {
  margin: 0 0 6px;
  padding: 0;
  font-family: ui-monospace, Consolas, "Courier New", monospace;
  font-size: 11px;
  line-height: 1.25;
  white-space: pre;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--tm-accent) var(--tm-bg-3);
  color: var(--tm-text);
}

.tm-det-bet-best {
  font-weight: 700;
  color: var(--tm-text);
}

.tm-det-bet-meta {
  color: var(--tm-muted);
  font-size: 11px;
  margin-top: 2px;
}

.tm-det-bet-commentary {
  margin-top: 6px;
  font-size: 11px;
  color: var(--tm-meta);
}

.tm-det-bet-commentary div {
  margin-bottom: 2px;
}

.tm-det-bet-pull {
  margin-top: 8px;
  padding: 5px 10px;
  font-size: 11px;
  cursor: pointer;
  color: var(--tm-text);
  background: var(--tm-bg-2);
  border: 1px solid var(--tm-border-2);
  border-radius: 4px;
}

.tm-det-bet-pull:hover {
  background: var(--tm-hover);
}

.tm-det-commentary-group {
  margin-bottom: 8px;
}

.tm-det-commentary-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--tm-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
}

.tm-det-row {
  margin-bottom: 6px;
  color: var(--tm-text);
}

.tm-det-score-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  margin: 6px 0 8px;
}

.tm-det-team { flex: 1; font-size: 11px; font-weight: 400; }
.tm-det-team-r { text-align: right; }
.tm-det-score-val { font-size: 16px; font-weight: 700; color: var(--tm-accent); min-width: 20px; text-align: center; }
.tm-det-dash { color: var(--tm-muted); }

.tm-det-info-row, .tm-det-starts-row {
  font-size: 10px;
  color: var(--tm-meta);
}

.tm-det-divider {
  height: 1px;
  background: var(--tm-border);
  margin: 8px 0;
}

.tm-det-bets-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--tm-muted);
  margin-bottom: 6px;
}

.tm-det-no-bets { font-size: 11px; color: var(--tm-meta); }

.tm-det-bet-block {
  background: var(--tm-bg-2);
  border: 1px solid var(--tm-border);
  border-radius: 5px;
  padding: 6px 8px;
  margin-bottom: 6px;
}

.tm-det-bet-market {
  font-size: 10px;
  color: var(--tm-muted);
  margin-bottom: 2px;
}

.tm-det-bet-sel {
  font-size: 12px;
  font-weight: 600;
  color: var(--tm-text);
}

.tm-det-odds {
  font-weight: 400;
  font-size: 10.5px;
  color: var(--tm-meta);
}

.tm-det-prob-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
}

.tm-det-prob-label { font-size: 10px; color: var(--tm-meta); flex: 1; }
.tm-det-prob-pct { font-size: 10px; color: var(--tm-accent); min-width: 28px; text-align: right; }

.tm-det-prob-bar-bg {
  width: 100%;
  height: 4px;
  background: var(--tm-bg-3);
  border-radius: 2px;
  margin-top: 2px;
  overflow: hidden;
  flex: none;
  display: none;
}

.tm-det-prob-bar-fill {
  height: 100%;
  background: var(--tm-accent);
  border-radius: 2px;
  transition: width 0.4s;
}

.tm-det-empty {
  padding: 16px;
  color: var(--tm-muted);
  font-size: 11px;
  text-align: center;
}
      `;
      document.head.appendChild(detStyle);

      panel
        .querySelector('.tm-bookie-refresh')
        .addEventListener('click', () => refreshPanel({ manual: true }));

      panel
        .querySelector('.tm-bookie-panel-toggle')
        .addEventListener('click', () => togglePanelHidden());

      updatePanelHiddenState();
    }

    applyPanelClasses();
    return panel;
  }

  // -- Bind functions ------------------------------------------------------------

  function bindRefreshModeButtons() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.querySelectorAll('.tm-bookie-refresh-mode').forEach(button => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';

      button.addEventListener('click', () => {
        setRefreshMode(button.dataset.mode);
        if (button.dataset.mode !== 'MAN') refreshPanel();
      });
    });
  }

  function bindSportGroupButtons() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.querySelectorAll('.tm-bookie-sport-header').forEach(button => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';

      button.addEventListener('click', () => {
        const sectionType = button.dataset.sectionType;
        const sportKey    = button.dataset.sportKey;

        if (!collapsedSportGroups[sectionType]) collapsedSportGroups[sectionType] = {};
        collapsedSportGroups[sectionType][sportKey] = !isSportGroupCollapsed(sectionType, sportKey);

        rerenderPanel();
      });
    });
  }

  function bindCopyTools() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const header = panel.querySelector('.tm-bookie-copy-header');
    if (header && header.dataset.bound !== '1') {
      header.dataset.bound = '1';
      header.addEventListener('click', () => {
        copyToolsCollapsed = !copyToolsCollapsed;
        rerenderPanel();
      });
    }

    panel.querySelectorAll('.tm-bookie-copy-btn').forEach(button => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (button.dataset.copyMode === 'details') {
          handleShowSelectedDetails(button).catch(error => {
            debugLog('Show selected details failed', error?.message || error);
            toast('Could not open selected game details.', true);
          });
        } else {
          handleCopyClick(button.dataset.copyMode === 'compact', button);
        }
      });
    });
  }

  function bindSettingsTools() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const header = panel.querySelector('.tm-bookie-settings-header');
    if (header && header.dataset.bound !== '1') {
      header.dataset.bound = '1';
      header.addEventListener('click', () => {
        settingsCollapsed = !settingsCollapsed;
        rerenderPanel();
      });
    }

    panel.querySelectorAll('[data-setting-key]').forEach(input => {
      if (input.dataset.bound === '1') return;
      input.dataset.bound = '1';
      input.addEventListener('change', () => {
        const key   = input.dataset.settingKey;
        const value = input.type === 'checkbox' ? input.checked : input.value;
        updateUiSetting(key, value);
      });
    });

    panel.querySelectorAll('[data-sport-key]').forEach(input => {
      if (input.dataset.bound === '1') return;
      input.dataset.bound = '1';
      input.addEventListener('change', () => {
        const sportKey = input.dataset.sportKey;
        updateSportEnabled(sportKey, input.checked);
        if (input.checked && isEsportsSportKey(sportKey) && !isPandaScoreUsable()) {
          showEsportsPandaScoreNotice(sportKey);
        }
      });
    });

    panel.querySelectorAll('[data-provider-key]').forEach(input => {
      if (input.dataset.bound === '1') return;
      input.dataset.bound = '1';
      input.addEventListener('change', () => {
        updateProviderEnabled(input.dataset.providerKey, input.checked);
      });
    });

    const debugReportBtn = panel.querySelector('.tm-bookie-debug-report-btn');
    if (debugReportBtn && debugReportBtn.dataset.bound !== '1') {
      debugReportBtn.dataset.bound = '1';
      debugReportBtn.addEventListener('click', () => {
        handleCopyDebugReport(debugReportBtn);
      });
    }

    const saveKeyBtn = panel.querySelector('.tm-bookie-odds-save-btn');
    if (saveKeyBtn && saveKeyBtn.dataset.bound !== '1') {
      saveKeyBtn.dataset.bound = '1';
      saveKeyBtn.addEventListener('click', () => {
        const input = panel.querySelector('.tm-bookie-odds-key-input');
        const raw = (input?.value || '').trim();
        if (!raw) return;
        setOddsApiKey(raw);
        input.value = '';
        rerenderPanel();
      });
    }

    const removeKeyBtn = panel.querySelector('.tm-bookie-odds-remove-btn');
    if (removeKeyBtn && removeKeyBtn.dataset.bound !== '1') {
      removeKeyBtn.dataset.bound = '1';
      removeKeyBtn.addEventListener('click', () => {
        removeOddsApiKey();
        rerenderPanel();
      });
    }

    const savePandaScoreBtn = panel.querySelector('.tm-bookie-pandascore-save-btn');
    if (savePandaScoreBtn && savePandaScoreBtn.dataset.bound !== '1') {
      savePandaScoreBtn.dataset.bound = '1';
      savePandaScoreBtn.addEventListener('click', () => {
        const input = panel.querySelector('.tm-bookie-pandascore-token-input');
        const raw = (input?.value || '').trim();
        if (!raw) return;
        setPandaScoreToken(raw);
        input.value = '';
        rerenderPanel();
      });
    }

    const removePandaScoreBtn = panel.querySelector('.tm-bookie-pandascore-remove-btn');
    if (removePandaScoreBtn && removePandaScoreBtn.dataset.bound !== '1') {
      removePandaScoreBtn.dataset.bound = '1';
      removePandaScoreBtn.addEventListener('click', () => {
        removePandaScoreToken();
        rerenderPanel();
      });
    }

    const saveApiSportsBtn = panel.querySelector('.tm-bookie-apisports-save-btn');
    if (saveApiSportsBtn && saveApiSportsBtn.dataset.bound !== '1') {
      saveApiSportsBtn.dataset.bound = '1';
      saveApiSportsBtn.addEventListener('click', () => {
        const input = panel.querySelector('.tm-bookie-apisports-key-input');
        const raw = (input?.value || '').trim();
        if (!raw) return;
        setApiSportsKey(raw);
        input.value = '';
        rerenderPanel();
      });
    }

    const removeApiSportsBtn = panel.querySelector('.tm-bookie-apisports-remove-btn');
    if (removeApiSportsBtn && removeApiSportsBtn.dataset.bound !== '1') {
      removeApiSportsBtn.dataset.bound = '1';
      removeApiSportsBtn.addEventListener('click', () => {
        removeApiSportsKey();
        rerenderPanel();
      });
    }

    panel.querySelectorAll('.tm-bookie-apisports-mode').forEach(button => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => {
        updateUiSetting('apiSportsRefreshMode', button.dataset.apisportsMode);
      });
    });

    const resetButton = panel.querySelector('.tm-bookie-reset-btn');
    if (resetButton && resetButton.dataset.bound !== '1') {
      resetButton.dataset.bound = '1';
      resetButton.addEventListener('click', () => resetUiSettings());
    }

    const unpinAllButton = panel.querySelector('.tm-bookie-unpin-all-btn');
    if (unpinAllButton && unpinAllButton.dataset.bound !== '1') {
      unpinAllButton.dataset.bound = '1';
      unpinAllButton.addEventListener('click', () => {
        const clearedCount = clearPinnedLiveMatches();
        rerenderPanel();
        if (clearedCount) {
          showActionNotice({
            type: 'success',
            title: 'Live pins cleared',
            detail: `Unpinned ${clearedCount} live ${clearedCount === 1 ? 'game' : 'games'}.`
          });
        }
      });
    }
  }

  function bindLivePinButtons() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.querySelectorAll('.tm-live-pin-btn').forEach(button => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';
      button.addEventListener('click', event => {
        event.stopPropagation();
        const result = toggleLiveMatchPin(button.dataset.matchKey);
        if (!result) return;
        rerenderPanel();
        showActionNotice({
          type: result.pinned ? 'success' : 'info',
          title: result.pinned ? 'Live game pinned' : 'Live game unpinned',
          detail: result.match?.name || 'Live game'
        });
      });
    });
  }

  function bindDetailsButtons() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    panel.querySelectorAll('.tm-bookie-details-btn').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const key = btn.dataset.matchKey;
        const opening = activeDetailsMatchKey !== key;
        activeDetailsFallbackMatch = null;
        activeDetailsMatchKey = opening ? key : null;
        rerenderPanel();
        if (opening) {
          const match = findMatchByKey(key);
          if (match) {
            enrichMatch(match, { forPane: true }).catch(error => {
              debugLog('Details enrichment failed', error?.message || error);
            });
          }
        }
      });
    });
  }

  // -- refreshPanel --------------------------------------------------------------

  async function refreshPanel({ manual = false } = {}) {
    const refreshContext = { manualRefresh: manual === true };
    const hadRenderableData = latestRenderableMatches.length > 0;
    // A manual refresh clears the api-sports date keys once up-front so the next
    // fetch per sport/date hits the network exactly once (later same-date matches
    // then dedup on the freshly-cached board). Auto/interval refreshes leave the
    // cache intact and are served cache-only while in manual mode.
    if (manual) {
      for (const key of Array.from(providerCache.keys())) {
        if (key.startsWith('apisports:') || key.startsWith('apifootball:')) providerCache.delete(key);
      }
    }
    isRefreshingPanel = true;
    if (hadRenderableData) rerenderPanel();
    let shouldKeepErrorPanel = false;
    try {
      getOrCreatePanel();

      const tornData = await fetchBookieData();

      const liveBets     = uiSettings.showLive     ? extractLiveBets(tornData)     : [];
      const upcomingBets = uiSettings.showUpcoming ? extractUpcomingBets(tornData) : [];

      // Staged fallback: fetch providers lazily per match in parallel across matches
      const enrichedLiveBets = await Promise.all(
        liveBets.map(async match => ({ ...match, score: await findScoreForMatch(match, refreshContext) }))
      );

      const visibleLiveBets = uiSettings.hideUnmatchedGames
        ? enrichedLiveBets.filter(match => match.score?.found)
        : enrichedLiveBets;

      renderPanel(visibleLiveBets, upcomingBets);
    } catch (error) {
      recordDebugEvent('refresh-panel-error', { error });
      console.warn('[Torn Bookie Live Scores Panel]', error.message || error);
      if (hadRenderableData) {
        lastRefreshErrorMessage = getRefreshErrorSummary(error);
        rerenderPanel();
      } else {
        shouldKeepErrorPanel = true;
        renderError(error);
      }
    } finally {
      isRefreshingPanel = false;
      if (!shouldKeepErrorPanel && latestRenderableMatches.length) rerenderPanel();
    }
  }

  // -- Bootstrap -----------------------------------------------------------------

  whenBodyReady(() => {
    getOrCreatePanel();
    installCopyToolsSelectionWatcher();
    setTimeout(refreshPanel, 1500);
    setRefreshMode('30s');
  });

})();
