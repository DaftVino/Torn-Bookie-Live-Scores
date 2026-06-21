# ARCHITECTURE — Torn Bookie Live Scores

**Production source:** `Torn_Bookie_Live_Scores.js` (7,108 lines, ~408 KB), userscript `@version 2.5.3`.
**Form:** a single IIFE (`Torn_Bookie_Live_Scores.js:29` … `:7108`), `'use strict'`, `@run-at document-start`. Every helper is a private function declaration inside the IIFE; nothing is exported to the page.

> **Scope note.** The task brief names `FINAL.user.js` as the production file. **No file named `FINAL.user.js` exists in this repository.** The only userscript present is `Torn_Bookie_Live_Scores.js`, which carries the `==UserScript==` metadata block (`:1-27`) and is unambiguously the production artifact. This document maps that file. It was **not modified**; all line references are against the committed source.

---

## 1. Module map (top to bottom)

| Lines | Module | Key symbols |
|---|---|---|
| `1-27` | UserScript metadata | `@match`, `@grant`, `@connect`, `@run-at` |
| `29-30` | IIFE open + strict mode | |
| `32-59` | Privacy disclosure comment | |
| `61-118` | Identity & tuning constants | `PANEL_ID`, `SCRIPT_VERSION` `:68`, `REFRESH_OPTIONS` `:81`, `CONFIDENCE_THRESHOLD` `:90`, TTL constants `:94-104`, `MIN/MAX_DATE_MS` `:105-106` |
| `110-177` | BYOK key storage | `getOddsApiKey` `:120`, `setOddsApiKey` `:125`, `getPandaScoreToken` `:155`, `maskPandaScoreToken` `:170`, `hasPandaScoreToken` `:177` |
| `180-420` | Static config tables | `SOURCE_LABELS`, `SOURCE_ICONS`, provider slug maps, `safeExternalSourceUrl` `:250`, URL builders `:298-330` |
| `421-505` | Pattern/alias tables | `ESPORTS_GAME_PATTERNS` `:421`, `TEAM_ALIASES`, status sets staged near `:1322` |
| `507-535` | **Module mutable state** | `capturedBookieData` `:507`, `latestRenderableMatches` `:518`, `providerCache` `:523`, `enrichmentCache` `:524`, `resolvedEventCache` `:525`, `inFlightRequests` `:527` |
| `537-740` | Debug & sanitisation | `sanitizeDebugText` `:546`, `isSensitiveDebugKey` `:563`, `sanitizeDebugValue` `:572`, `recordDebugEvent` `:597`, `buildDebugReport` `:659` |
| `741-852` | Settings | `deepMergeSettings` `:741`, `loadUiSettings` `:762`, `saveUiSettings` `:772`, `updateUiSetting` `:797`, `resetUiSettings` `:837` |
| `859-942` | **Data capture / interception** | `hasUsableBookieData` `:861`, `saveCapturedBookieData` `:867`, fetch override `:889`, XHR override `:923-942` |
| `907-921` | **Global error recovery** | `window 'error'` `:907`, `window 'unhandledrejection'` `:917` |
| `944-1017` | Bootstrap I/O helpers | `whenBodyReady` `:946`, `gmFetchJson` `:955`, `gmFetchJsonWithMeta` `:988`, `fetchBookieData` `:1012` |
| `1019-1200` | Extraction & enrichment glue | `getYourBetsMatches` `:1019`, string utils `:1028-1080`, `makeMatchKey` `:1081`, enrichment cache `:1108-1196` |
| `1257-1313` | Team matching | `calcTeamMatchScore` `:1257`, `matchTeamPair` `:1289` |
| `1319-2158` | **DATE_MATCHING_CORE** (marked region) | status/date/candidate/plan logic — see §4 |
| `2160-2575` | Provider integrations | `_findEspn` `:2219`, `_findSofascore` `:2287`, `_findLivescore` `:2306`, `_findThescore` `:2401`, `_findBbc` `:2423`, `_findPandaScore` `:2504` |
| `2575-2950` | Enrichment providers | NHL/stats/H2H/odds fetchers |
| `3106-3395` | **ODDS_ANALYSIS_CORE** (marked region) | implied-prob/EV/no-vig/row builders — see §7 |
| `3400-3521` | Score orchestration | `pullBetPanelData` `:3400`, `handleBetPull` `:3444`, `findScoreForMatch` `:3465` |
| `3525-5365` | UI rendering | scoreboards `:3609-3668`, match rows `:3669-3720`, details pane `:3924-4465`, `renderPanel` `:5332`, `rerenderPanel` `:5338` |
| `5378-5394` | Error UI | `renderErrorBody` `:5370`, `renderError` `:5378` |
| `5398-6875` | Panel creation + full CSS | `getOrCreatePanel` `:5398` (panel/details HTML + ~1,400 lines of CSS); header listeners `:6862-6868` |
| `6879-7072` | Event binding | `bindRefreshModeButtons` `:6879`, `bindSportGroupButtons` `:6894`, `bindCopyTools` `:6914`, `bindSettingsTools` `:6944`, `bindDetailsButtons` `:7046` |
| `7074-7101` | Main loop | `refreshPanel` `:7074` |
| `7103-7108` | **Bootstrap** | `whenBodyReady(...)` → `getOrCreatePanel`, `setTimeout(refreshPanel,1500)`, `setRefreshMode('30s')` |

---

## 2. Lifecycle & entry points

1. **Document-start (`:7103`).** `whenBodyReady` (`:946`) runs the bootstrap immediately if `document.body` exists, otherwise installs a 50 ms `setInterval` that self-clears once the body appears (`:948-950`).
2. **Interception is installed eagerly at top level** (not inside `whenBodyReady`): `pageWindow.fetch` is wrapped at `:889` and `XMLHttpRequest.prototype.open/send` at `:923-942`, where `pageWindow = unsafeWindow || window` (`:887`). Both originals are preserved and always called; only responses whose URL `includes('sid=bookieApi')` are cloned/parsed (`:895`, `:932`).
3. **Global handlers** for `error` (`:907`) and `unhandledrejection` (`:917`) are registered once, funnelling into `recordDebugEvent`.
4. **First paint.** Bootstrap calls `getOrCreatePanel()` (builds DOM + CSS once), schedules `refreshPanel` after 1.5 s, and starts the 30 s refresh interval via `setRefreshMode('30s')` (`:7104-7106`).

---

## 3. Data flow

```
Torn page fetch/XHR (sid=bookieApi)
  └─ fetch override :889 / xhr 'load' :933
       └─ tryParseBookieResponse :877  → JSON.parse
            └─ saveCapturedBookieData :867  (gated by hasUsableBookieData :861)
                 ├─ capturedBookieData = data        (module memory only)
                 └─ debounce 250ms → refreshPanel    (:873-874)

refreshPanel :7074
  ├─ getOrCreatePanel :5398           (recreate panel if SPA removed it)
  ├─ fetchBookieData :1012            (returns captured snapshot or throws wait-message)
  ├─ extractLiveBets :1928 / extractUpcomingBets :1937
  │     filter status==='inprogress' / 'notstarted'; drop excluded+disabled sports
  │     → normalizeBetMatch :1898     (flatten to internal shape; sum bet amount)
  ├─ Promise.all(liveBets.map findScoreForMatch) :7084   ← provider lookups, parallel across matches
  ├─ optional hideUnmatched filter :7088
  └─ renderPanel :5332 → rerenderPanel :5338 (innerHTML + re-bind listeners)
         (errors → renderError :5378)
```

**No Torn account data leaves the browser.** Only sport ids, UTC dates, provider event/team ids, and (BYOK) user tokens are sent outbound (`:32-59`).

---

## 4. DATE_MATCHING_CORE (`:1319-2158`)

**Status classification** (`:1322-1387`):
- `LIVE_STATUS_VALUES` `:1322` = {live, inplay, inprogress, running, started, playing, halftime, intermission}
- `NON_LIVE_STATUS_VALUES` `:1323` = {scheduled, upcoming, notstarted, postponed, cancelled, canceled, finished, complete, completed, final}
- `FINAL_STATUS_VALUES` `:1324` = {finished, complete, completed, final, ft, fulltime}
- `normalizeStatusToken` `:1351`, `getStatusTokens` `:1355`, `isActuallyLive` `:1364` (structural `sectionType==='live'`/`isLive` wins over status text), `isFinalStatus` `:1376`.
- Note: `delayed`, `abandoned`, `suspended` are in **none** of the three sets (characterised in `tests/states.test.js`).

**Timestamps** (`:1326-1413`): `normalizeTimestampMs` `:1330` accepts epoch s/ms and timezone-qualified ISO only, bounded `MIN_DATE_MS..MAX_DATE_MS`. UTC arithmetic via `startOfUtcDay` `:1392`, `endOfUtcDay` `:1397`, `addUtcDays` `:1401`; `formatProviderDate` `:1405` emits ESPN/LiveScore/ISO formats in UTC.

**Candidate scoring** (`:1462-1592`): `dedupeCandidates` `:1470`, `scoreTeamOrientation` `:1488` (orientation = `min(home,away)`), `isCandidateTimeCompatible` `:1517` (live 36 h / upcoming 12 h / cricket multi-day), `scoreCandidate` `:1534` (team conf ≥ `CONFIDENCE_THRESHOLD`, then time/competition/status/anchor bonuses; **accept ≥ 75**), `selectBestCandidate` `:1569` (sorts; **flags `ambiguous` when top two are within 10 points**).

**Resolved-event cache** (`:1594-1629`): `putResolvedEvent` `:1598` keys by `provider:matchKey`, stores provider event id + identity; `getResolvedEvent` `:1617` returns within TTL (5 min active / 2 min final `:103-104`), **deletes on expired access** `:1622`, and invalidates on team-identity change or >1 h start drift.

**Provider resolution engine** (`:1631-1700`): `resolveProviderMatch` `:1631` walks a lookup plan, calls an injected `fetchStep(step, cachedResolution)` per step (try/catch per step `:1644-1648`), reuses a cached event id when present (`:1651-1668`), else `selectBestCandidate`; returns on first accepted resolution. `summarizeProviderResult` `:1680` produces the human diagnostic label (matched / invalid anchor / live-recovery / **ambiguous** / **fetch error [HTTP n]** / parser failed / no events / no confident match).

**Lookup-plan builders** (`:1983-2109`): `buildSofascoreLookupPlan` `:1987` (≤3 steps; cricket widens to ≤7), `buildDateBucketPlan` `:2009` (ESPN/LiveScore/BBC; widens ±1 day only when live or global-date upcoming), `buildTheScorePlan` `:2029` (±1 day ISO window), `buildPandaScorePlan` `:2058` (≤3 day buckets), `buildNhlScorePlan` `:2086` (adds `nhl-now` step when live).

---

## 5. Provider integrations (`:2160-2575`)

| Provider | Find fn | Plan | Host | Default |
|---|---|---|---|---|
| ESPN | `_findEspn` `:2219` | `buildDateBucketPlan(espn)` | site.api.espn.com | on |
| SofaScore | `_findSofascore` `:2287` → `resolveSofascoreMatch` `:2189` | `buildSofascoreLookupPlan` | api.sofascore.com | on |
| LiveScore | `_findLivescore` `:2306` | `buildDateBucketPlan(livescore)` | prod-public-api.livescore.com | on |
| TheScore | `_findThescore` `:2401` → `resolveThescore` `:2364` | `buildTheScorePlan` | api.thescore.com | off |
| BBC Sport | `_findBbc` `:2423` | `buildDateBucketPlan(iso)` | www.bbc.com | off |
| PandaScore | `_findPandaScore` `:2504` | `buildPandaScorePlan` | api.pandascore.co | off (BYOK) |
| NHL (enrich) | `resolveNhlGame` `:2865` | `buildNhlScorePlan` | api-web.nhle.com / api.nhle.com | enrich only |
| The Odds API (enrich) | `pullBetPanelData` `:3400` | n/a | api.the-odds-api.com | off (BYOK) |

**Routing:** `chooseScoreSource` `:1795` + `getEspnKey` `:1821` + `isProviderSupportedForSport` `:1836` + `getProviderPriority` `:1846` produce an ordered, enable-gated, sport-supported provider ladder. `findScoreForMatch` `:3465` tries each provider **sequentially**, returns the first `found`, and folds per-provider failures into a diagnostic string. All provider fetches route through `fetchWithCache` → `gmFetchJson`/`gmFetchJsonWithMeta` → `GM_xmlhttpRequest`.

---

## 6. Caching & coalescing

| Cache | Decl | Keyed by | TTL | Eviction |
|---|---|---|---|---|
| `providerCache` | `:523` | request cacheKey | 45 s ok / 15 s err (`:94-95`) | **none** (overwrite-by-key only; `set` `:1720`/`:1728`) |
| `inFlightRequests` | `:527` | request cacheKey | until settle | `delete` on resolve/reject `:1721`/`:1729` |
| `resolvedEventCache` | `:525` | `provider:matchKey` | 5 min / 2 min | `delete` on expired access `:1622` |
| `enrichmentCache` | `:524` | matchKey | per-section (`isFresh` `:1197`) | **none** (`set` `:1192` only) |
| Odds-analysis cache | localStorage | match meta | TTL by live/upcoming | validity check `isValidOddsAnalysisCacheEntry` `:3036` |

`fetchWithCache` `:1704`: serves within TTL (`:1706`), coalesces concurrent identical requests via `inFlightRequests` (`:1712-1716`), caches a **safe empty shape** `{error, events:[], Stages:[]}` on failure (`:1727`).

---

## 7. ODDS_ANALYSIS_CORE (`:3106-3395`)

Pure math: `americanToImpliedProb` `:3120`, `decimalToImpliedProb` `:3126`, `oddsToImpliedProb` `:3132`, `probToAmerican` `:3136`, `calcNoVigPair` `:3165`, `calcEvPct` `:3171`, `pickBestPrice` `:3178`. Row builders: `computePairRows` `:3238`, `buildMoneylineRows` `:3276` (skips 3-way/draw), `buildSpreadRows` `:3296`, `buildTotalRows` `:3325`, `buildBetRows` `:3350`, `buildBetCommentary` `:3370`.

---

## 8. UI rendering paths

All renderers are **pure string builders** that write through `innerHTML`; **every dynamic value passes `escapeHtml` `:1052`**.

- Scoreboards: `renderScoreboard` `:3609` → compact `:3619` / classic `:3633` / minimal `:3647`.
- Rows: `renderLiveMatch` `:3669`, `renderUpcomingMatch` `:3698`, `renderSportGroups` `:3721`.
- Details pane: `renderDetailsPanel` `:4248`, `updateDetailsPanel` `:4428`, sections `:4107-4218`, expected-outcome/commentary `:3786-4033`.
- Panel shell: `getOrCreatePanel` `:5398` builds panel + style once (recreates if Torn's SPA removes `#tm-bookie-live-panel`); `rerenderPanel` `:5338` replaces only `.tm-bookie-content` then re-binds.
- Copy/settings/debug tools: `renderCopyTools` `:5105`, `renderSettingsTools` `:5145`, `formatGame` `:4594`, `formatEnrichedGame` `:4727`.

---

## 9. Timers, listeners, observers

**Timers (8 distinct sites):**
| Site | Purpose | Cleanup |
|---|---|---|
| `:873-874` `lastRenderTimer` | 250 ms capture debounce | `clearTimeout` before each set |
| `:948-949` body poll | `setInterval(50ms)` for `document.body` | `clearInterval` on success |
| `:3578-3580` `refreshIntervalId` | refresh loop | **singleton**: cleared before re-set |
| `:3604` toast removal | one-shot 2.5 s | self-removes |
| `:4374-4375` `detailsResizeTimer` | 150 ms resize debounce | `clearTimeout` before set |
| `:4470` odds expand | 250 ms `await` sleep | one-shot |
| `:4835` `withTimeout` | enrichment timeout race | one-shot |
| `:7104` initial paint | one-shot 1.5 s | one-shot |

**Listeners:** global `error`/`unhandledrejection` bound once (`:907`,`:917`); header refresh/toggle bound once at panel creation (`:6862-6868`); `resize` bound once via `detailsResizeListenerBound` flag (`:4370-4379`); content listeners re-bound on fresh nodes each `rerenderPanel`, guarded by `dataset.bound` (`:6884`,`:6899`,`:6919`…); per-XHR `'load'` listener is per-request (`:933`).

**DOM observers:** **none.** There is **no `MutationObserver`.** SPA-removal recovery is handled by `getOrCreatePanel` re-creating the panel on each `refreshPanel`/`rerenderPanel`, not by observing the DOM.

---

## 10. Error-recovery paths

- `refreshPanel` `:7074` wraps everything in try/catch → `recordDebugEvent('refresh-panel-error')` → `renderError` `:5378`.
- `fetchBookieData` `:1012` throws a friendly "select YOUR BETS / refresh" message when no usable capture exists (fresh load / reload); `renderErrorBody` `:5370` renders it as the only non-escaped (static-literal) markup branch.
- Provider exceptions are caught **per provider** in `findScoreForMatch` `:3498` and **per step** in `resolveProviderMatch` `:1644`; failures degrade to a diagnostic label, never a thrown panel error.
- `fetchWithCache` `:1724` converts any fetch rejection into a cached safe empty shape, so a provider outage never rejects upward.
- Enrichment is time-boxed by `withTimeout(…, 10000)` `:4988`; **score lookups are not** time-boxed at the application layer and `GM_xmlhttpRequest` is called without a `timeout` option (`:957`,`:990`), so the `ontimeout` handlers (`:973`,`:1007`) are unreachable — see NETWORK_AUDIT / RUNTIME_AUDIT.
