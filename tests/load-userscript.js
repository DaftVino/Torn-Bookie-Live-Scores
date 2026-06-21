'use strict';

/*
 * Non-invasive test harness for Torn_Bookie_Live_Scores.js
 * --------------------------------------------------------
 * The production userscript is a single IIFE that keeps every helper private.
 * To exercise those helpers deterministically from Node without touching the
 * production file on disk, we:
 *   1. Read the production source verbatim.
 *   2. Inject (IN MEMORY ONLY) an export statement immediately before the final
 *      `})();` so the IIFE publishes its internal functions/state to the sandbox
 *      global. The file on disk is never written to.
 *   3. Run the (modified-in-memory) source inside a `vm` context whose globals
 *      are mocked: a controllable clock, in-memory GM_* storage, localStorage,
 *      a stubbed window/document/XMLHttpRequest, and no-op timers (so the
 *      bootstrap never builds DOM or schedules real work).
 *
 * The clock is controlled by setNow(ms); the production code's Date.now() and
 * `new Date()` (no-arg) both read it. Provider/enrichment caches are exposed so
 * tests can clear them between runs and prove there is no state leakage.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.TZ = 'UTC'; // deterministic local-time parsing (buildSelectedStartTimestamp uses local Date)

const SOURCE_PATH = path.join(__dirname, '..', 'Torn_Bookie_Live_Scores.js');

// Names we want to pull out of the IIFE scope. Every name is a hoisted function
// declaration or a const/let in scope at the end of the IIFE.
const EXPORT_NAMES = [
  // string / format utils
  'clean', 'parseMult', 'normalizeName', 'slugify', 'escapeHtml', 'formatMoney',
  'formatStartTime', 'roundNumber',
  // match key / enrichment
  'makeMatchKey', 'makeEnrichment', 'getEnrichment', 'isFresh', 'syncEnrichmentFromMatch',
  // timestamps / dates
  'isPlausibleTimestampMs', 'normalizeTimestampMs', 'getDateFormatterMs',
  'startOfUtcDay', 'endOfUtcDay', 'addUtcDays', 'formatProviderDate',
  'dateForEspn', 'dateForSofascore', 'dateForLivescore', 'dateForIso',
  'parseLivescoreStartMs',
  'inferSelectedDateParts', 'buildSelectedStartTimestamp', 'parseSelectedGameStartTimestamp',
  // status
  'normalizeStatusToken', 'getStatusTokens', 'isActuallyLive', 'isFinalStatus',
  'getMatchAnchorMs', 'getLiveRecoveryMs',
  // team matching
  'calcTeamMatchScore', 'matchTeamPair', 'scoreTeamOrientation',
  // candidate scoring / selection
  'isGlobalDateSport', 'isCricketMatch', 'hasCompetitionCompatibility',
  'isCandidateTimeCompatible', 'scoreCandidate', 'selectBestCandidate',
  'makeCandidateDedupKey', 'dedupeCandidates',
  // lookup plans
  'buildLookupStep', 'dedupeLookupPlan', 'buildOffsetPlan',
  'buildSofascoreLookupPlan', 'buildDateBucketPlan', 'buildTheScorePlan',
  'buildPandaScorePlan', 'buildNhlScorePlan',
  // resolved-event cache
  'resolvedEventCacheKey', 'putResolvedEvent', 'getResolvedEvent',
  // provider results
  'makeProviderResult', 'mergeProviderResults', 'summarizeProviderResult',
  'scoreFromResolution', 'resolveProviderMatch',
  // provider/sport routing
  'detectEsportsGameKey', 'isExcludedSport', 'getSportLabel', 'getSportKey',
  'chooseScoreSource', 'getEspnKey', 'isProviderSupportedForSport',
  'getProviderPriority', 'isNhlMatch', 'getStatsProviderPriority',
  // bet extraction
  'normalizeBetMatch', 'extractLiveBets', 'extractUpcomingBets',
  'groupMatchesBySport', 'getActiveSources', 'getInitialHeaderSources',
  'hasUsableBookieData', 'getYourBetsMatches',
  // odds math
  'americanToImpliedProb', 'decimalToImpliedProb', 'oddsToImpliedProb',
  'probToAmerican', 'probToDecimal', 'americanProfitPer1', 'decimalProfitPer1',
  'profitPer1', 'calcNoVigPair', 'calcEvPct', 'pickBestPrice',
  'abbreviateBook', 'abbreviateSelection', 'formatSpreadPoint', 'findBookMarket',
  'computePairRows', 'buildMoneylineRows', 'buildSpreadRows', 'buildTotalRows',
  'buildBetRows', 'stripMarketSuffix', 'buildBetCommentary',
  'getBetImpliedOutcomes', 'parseOddsToDecimal', 'parseGameTeams',
  // url safety
  'safeExternalSourceUrl', 'firstSafeSourceUrl', 'candidateUrlFields',
  'buildEspnSourceUrl', 'buildBbcSourceUrl', 'buildScoreSourceUrl',
  // DOM-free HTML render helpers (return strings; exercised headlessly)
  'renderScoreboard', 'renderCompactScoreboard', 'renderClassicScoreboard',
  'renderMinimalScoreboard', 'renderLiveMatch', 'renderUpcomingMatch',
  'renderSportGroups', 'renderErrorBody', 'isSportGroupCollapsed',
  'formatGame', 'compactMarkets',
  // settings / debug
  'deepMergeSettings', 'isRenderOnlySetting',
  'sanitizeDebugText', 'sanitizeDebugValue', 'isSensitiveDebugKey', 'limitDebugString',
  'escapeRegExp',
  // caching primitives
  'fetchWithCache',
  // shared mutable state / constants
  'providerCache', 'inFlightRequests', 'resolvedEventCache', 'enrichmentCache',
  'uiSettings', 'DEFAULT_UI_SETTINGS', 'CONFIDENCE_THRESHOLD',
  'DAY_MS', 'HOUR_MS', 'MINUTE_MS', 'TTL_SUCCESS', 'TTL_ERROR',
  'TEAM_ALIASES', 'PROVIDER_PRIORITY',
  'SOFASCORE_SPORT_SLUGS', 'LIVESCORE_SPORT_SLUGS', 'THESCORE_SPORT_SLUGS',
  'BBC_SPORT_PATHS', 'PANDASCORE_GAME_SLUGS', 'ESPN_ENDPOINTS'
];

function buildInstrumentedSource() {
  const original = fs.readFileSync(SOURCE_PATH, 'utf8');
  const marker = '})();';
  const idx = original.lastIndexOf(marker);
  if (idx === -1) throw new Error('Could not find IIFE close marker in production source');
  const exportObj = EXPORT_NAMES.map(n => `${JSON.stringify(n)}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(', ');
  const injection = `\n;try { globalThis.__TBLS__ = { ${exportObj} }; } catch (e) { globalThis.__TBLS_ERR__ = e; }\n`;
  return original.slice(0, idx) + injection + original.slice(idx);
}

function makeSandbox() {
  let currentNow = Date.UTC(2026, 5, 20, 12, 0, 0); // fixed default "now": 2026-06-20T12:00:00Z

  class MockDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(currentNow);
      else super(...args);
    }
    static now() { return currentNow; }
  }

  const gmStore = new Map();
  const lsStore = new Map();

  const noopTimer = () => 0;

  const xhrProto = { open() {}, send() {}, addEventListener() {}, setRequestHeader() {} };
  function XMLHttpRequestStub() {}
  XMLHttpRequestStub.prototype = xhrProto;

  const listeners = {};
  const windowStub = {
    fetch: async () => ({ clone: () => ({ text: async () => '' }), text: async () => '' }),
    XMLHttpRequest: XMLHttpRequestStub,
    addEventListener: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); },
    removeEventListener: () => {},
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    location: { origin: 'https://www.torn.com', pathname: '/page.php', href: 'https://www.torn.com/page.php?sid=bookie' }
  };

  const documentStub = {
    body: null, // null => whenBodyReady installs a (no-op) interval and never builds DOM
    readyState: 'loading',
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], remove() {} }),
    head: { appendChild: () => {} }
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date: MockDate,
    Math, JSON, Object, Array, String, Number, Boolean, RegExp, Map, Set, Symbol,
    Promise, Error, TypeError, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent,
    decodeURIComponent, URL, Intl,
    setTimeout: noopTimer, clearTimeout: () => {}, setInterval: noopTimer, clearInterval: () => {},
    window: windowStub,
    document: documentStub,
    navigator: { userAgent: 'node-test', language: 'en-US', languages: ['en-US'], platform: 'test', cookieEnabled: true, onLine: true },
    location: windowStub.location,
    localStorage: {
      getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v)),
      removeItem: k => lsStore.delete(k),
      clear: () => lsStore.clear()
    },
    GM_getValue: (k, d) => (gmStore.has(k) ? gmStore.get(k) : d),
    GM_setValue: (k, v) => gmStore.set(k, v),
    GM_deleteValue: k => gmStore.delete(k),
    GM_xmlhttpRequest: () => {},
    GM_setClipboard: () => {},
    globalThis: null
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  return {
    sandbox,
    control: {
      setNow: ms => { currentNow = ms; },
      getNow: () => currentNow,
      gmStore,
      lsStore,
      listeners
    }
  };
}

function loadUserscript() {
  const { sandbox, control } = makeSandbox();
  const context = vm.createContext(sandbox);
  const src = buildInstrumentedSource();
  vm.runInContext(src, context, { filename: 'Torn_Bookie_Live_Scores.instrumented.js' });
  if (sandbox.__TBLS_ERR__) throw sandbox.__TBLS_ERR__;
  const api = sandbox.__TBLS__;
  if (!api) throw new Error('Export injection failed: __TBLS__ not present');

  // Helper to reset all shared mutable caches so a test never inherits state.
  api.__resetCaches = function resetCaches() {
    api.providerCache.clear();
    api.inFlightRequests.clear();
    api.resolvedEventCache.clear();
    api.enrichmentCache.clear();
  };
  api.__control = control;
  return api;
}

module.exports = { loadUserscript, EXPORT_NAMES };
