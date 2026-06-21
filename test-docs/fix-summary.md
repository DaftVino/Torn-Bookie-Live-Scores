# fix-summary.md — Torn Bookie Live Scores (`Torn_Bookie_Live_Scores.js` `@version 2.5.3`)

**Scope:** All actionable bugs, stale code, and hygiene issues confirmed across PRODUCTION_VALIDATION, FIX_PLAN, NETWORK_AUDIT, RUNTIME_AUDIT, SECURITY_AUDIT, plus cross-checks against ARCHITECTURE and OVERNIGHT_AUDIT. Severity as-sourced: **Medium / Low / Plausible Risk / Informational**.  
**No Critical or High defects exist.** Status-classification edge cases (B-1, B-2) and design-limitation notes (I-1–I-5, N-1, N-3, N-4) are excluded from the fix list — those are deliberate trade-offs or live-data-dependent notes, not current action items.  
**Source-of-truth note:** PRODUCTION_VALIDATION supersedes the earlier OVERNIGHT_AUDIT where they differ: final suite size is **149 tests** (not 130), and the confirmed unpruned-cache finding covers **providerCache + enrichmentCache only**. `resolvedEventCache` self-evicts on expired access.  
**Recommended execution order (from FIX_PLAN):** `L-4 → L-2 → L-5 → L-3 → L-1 → N-2 → M-1`

---

## M-1 — Containment matcher over-matches contained team names *(Medium)*

**File/lines:** `Torn_Bookie_Live_Scores.js:1270-1276` (`calcTeamMatchScore`, containment branch)

**Bug:** The containment branch's only guard is "both normalized names ≥ 5 chars." Any name ≥ 6 chars that is a raw substring of a longer name returns `80`, which meets or exceeds `CONFIDENCE_THRESHOLD (60)` and can attach the **wrong fixture's score**. The inline comment at `:1270` explicitly claims the `mexico`/`new mexico` case is prevented — it is not.

```js
// Containment with minimum-length guard (prevents "mexico" matching "new mexico")  ← FALSE
const MIN_LEN = 5;
if (na.length >= MIN_LEN && nb.length >= MIN_LEN) {
  const shorter = na.length <= nb.length ? na : nb;
  const longer  = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter)) return 80;   // ← fires for "mexico" ⊂ "new mexico"
}
```

**Reproduction:** `calcTeamMatchScore('Mexico', 'New Mexico') === 80`; same for `('Arsenal', 'Arsenal Reserves')`, `('United', 'Manchester United')`.

**Characterization test (currently pinning buggy behavior):** `tests/matching.test.js` → `"DEFECT: containment heuristic over-matches contained names"`. A correct fix flips this assertion.

**Preferred fix:** Require whole-word-boundary containment. Split `longer` into words; accept (`return 80`) only if `shorter` equals one of `longer`'s word tokens **and** the extra words are not disqualifying qualifier terms (`new`, `reserves`, `reserve`, `u21`, `u23`, `u19`, `b`, `ii`, `women`, `w`). Otherwise fall through to the existing Jaccard branch.

**Lower-risk alternative:** Keep `includes` but return a sub-threshold score (e.g., `55`) so the containment signal only confirms via time + competition bonuses, never on name alone.

**Tests that must flip to green after fix:**
- `calcTeamMatchScore('Mexico','New Mexico') < CONFIDENCE_THRESHOLD` (was `=== 80`)
- `calcTeamMatchScore('Arsenal','Arsenal Reserves') < CONFIDENCE_THRESHOLD`
- `matchTeamPair({team1:'Mexico',team2:'USA'},'New Mexico','USA').confidence < 60`

**Tests that must stay green:** "min-length guard catches short containment (York/New York)", all `calcTeamMatchScore` exact/alias/Jaccard cases, all candidate-scoring/plan tests.

**Regression risk:** Medium. `calcTeamMatchScore` is the core of all score matching; add a positive regression test proving a legitimate aliased pair (e.g., `Barcelona` / `FC Barcelona`) still resolves via alias table or Jaccard before shipping.

**Stored-data impact:** None — pure in-memory matching logic, no settings/cache/storage schema change.

---

## L-1 — `providerCache` / `enrichmentCache` never pruned *(Low)*

**File/lines:** `providerCache.set` at `:1720`, `:1728` inside `fetchWithCache:1704`; `enrichmentCache.set` at `:1192` inside `getEnrichment:1189`. Declarations at `:523`, `:524`.

**Bug:** Neither `Map` has any `.delete`/`.clear`/sweep path. Entries persist for the entire page session. `grep` over the full source confirms zero `.delete`/`.clear` on either Map. (`resolvedEventCache` at `:525` already self-evicts at `:1622`; `inFlightRequests` at `:527` cleans on settle; the odds-analysis `localStorage` cache is size-capped via `ODDS_ANALYSIS_CACHE_LIMIT` at `:3031` — only these two Maps are unguarded.)

**Evidence:** `tests/runtime.test.js` — "providerCache grows monotonically … NOT auto-pruned on expiry": 25 distinct keys → size 25; +10 min past all TTLs → still 25. "enrichmentCache grows one entry per distinct match key and is never pruned": 15 → 15 after a simulated day.

**Impact:** A Bookie tab open for hours/days with auto-refresh accumulates one small entry per distinct `(match × provider × date-window)` key and per match key. Not a crash risk; a slow, monotonic, session-bounded hygiene issue.

**Fix — `providerCache`:** sweep expired entries on each `refreshPanel` call, guarded by size threshold to cap the sweep cost:
```js
// At top of fetchWithCache, or once per refreshPanel:
const now = Date.now();
if (providerCache.size > 200) {
  for (const [k, v] of providerCache) if (v.expiry < now) providerCache.delete(k);
}
```

**Fix — `enrichmentCache`:** after each `renderPanel`, drop keys absent from `latestRenderableMatches` (the only matches that can re-request enrichment), or apply a simple size-capped FIFO/LRU eviction.

**Tests that must flip:** `tests/runtime.test.js` → "providerCache grows monotonically … NOT auto-pruned on expiry" and "enrichmentCache grows one entry per distinct match key and is never pruned" — update to assert that size shrinks after expiry sweep or cap is applied.

**Tests that must stay green:** all `tests/cache.test.js` TTL-hit/expiry, coalescing, error-caching, and in-flight-cleanup tests. Eviction must never touch unexpired entries or `inFlightRequests`.

**Stored-data impact:** None — both Maps are in-memory only.

---

## L-2 — `SCRIPT_VERSION` constant disagrees with `@version` *(Low / Stale constant)*

**File/lines:** `:4` `// @version 2.5.3`; `:68` `const SCRIPT_VERSION = '2.1.0';`; consumed by `buildDebugReport:659` (`version: SCRIPT_VERSION`).

**Bug:** Version was bumped in the metadata header but not in the constant. Every user-submitted debug report shows `2.1.0` regardless of the installed version — misleads triage.

**Characterization test:** `tests/metadata.test.js` → `"DEFECT: SCRIPT_VERSION constant disagrees with @version header"`.

**Fix (self-syncing):**
```js
const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '2.5.3';
```
The literal fallback keeps test harness runs deterministic (harness has no `GM_info`). If adopting this form, add a `GM_info` stub to `tests/load-userscript.js` or rely on the fallback — either is acceptable.

**Simpler alternative:** set the literal to `'2.5.3'`, accepting that it will drift again on the next version bump.

**Tests that must flip:** `tests/metadata.test.js` → update to assert `SCRIPT_VERSION === '2.5.3'` (or `=== GM_info.script.version`).

**Regression risk:** None — only affects the debug report string. `GM_info` is implicitly available in Tampermonkey; no `@grant` needed.

---

## L-3 — `abbreviateSelection` leaks filler word + trailing space *(Low)*

**File/lines:** `Torn_Bookie_Live_Scores.js:3213-3222`.

**Bug:** When the filler-word filter (`the|fc|sc|cf|of|and|&`) reduces the word count to <2, the fallback uses `clean.slice(0, 3)` of the **original** unfiltered string, re-introducing the stripped filler token.

```js
// Current (buggy) fallback path:
const remainder = words.join(' ').trim() || clean;
return clean.slice(0, 3).toUpperCase();  // ← should be remainder.slice(0, 3)
```

**Evidence:** `tests/odds-math.test.js` → `"DEFECT: abbreviateSelection leaks filler word + trailing space"`:
- `abbreviateSelection('FC Barcelona') === 'FC '` (trailing space, should be `'BAR'`)
- `abbreviateSelection('The Rock') === 'THE'` (should be `'ROC'`)

**Fix:**
```js
const remainder = words.join(' ').trim() || clean;
return remainder.slice(0, 3).toUpperCase();
```

**Tests that must flip:** `tests/odds-math.test.js` → update to assert `'BAR'` and `'ROC'` (no trailing space).

**Tests that must stay green:** `abbreviateBook` and all odds-row/commentary tests. Purely cosmetic — only affects label strings in the odds-analysis panel, no numeric or matching effect.

---

## L-4 — `@homepage` `hhttps://` typo *(Low / Stale metadata)*

**File/lines:** `Torn_Bookie_Live_Scores.js:24`.

```js
// @homepage     hhttps://greasyfork.org/en/scripts/583676-torn-bookie-live-scores
//               ^--- extra leading 'h'
```

**Bug:** Leading `h` typo produces an invalid URL scheme. The Homepage link in the userscript manager is broken. (`@supportURL` at `:25` is valid and unaffected.)

**Characterization test:** `tests/metadata.test.js` → `"DEFECT: @homepage has a 'hhttps' typo"`.

**Fix:**
```js
// @homepage     https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores
```

**Regression risk:** None. Metadata only; does not affect execution. Release as a standard version bump — Greasy Fork re-parses the header on publish.

---

## L-5 — README references a non-existent filename *(Low / Stale docs)*

**File/lines:** `README.md:16`.

**Bug:** Installation instructions read `"Open Live_Scores_Panel.js"`. The actual production file is `Torn_Bookie_Live_Scores.js`. New installers look for a file that does not exist.

**Fix:** Replace `Live_Scores_Panel.js` with `Torn_Bookie_Live_Scores.js` in `README.md:16`.

**Regression risk:** None — documentation only, no code change.

---

## N-2 — No `GM_xmlhttpRequest` timeout; `ontimeout` handlers are dead code *(Plausible Risk)*

**File/lines:** `gmFetchJson:955-976` (`:957` option object, `:973` `ontimeout`); `gmFetchJsonWithMeta:988-1010` (`:990` option object, `:1007` `ontimeout`). Score-lookup path `findScoreForMatch:3465` also lacks a `withTimeout` wrapper (enrichment at `:4988` does have one).

**Bug:** The `timeout` property is never passed to `GM_xmlhttpRequest`, so Tampermonkey's script-level timeout never fires. The `ontimeout` reject branches at `:973` and `:1007` are **unreachable dead code** as written. `grep` confirms: only `ontimeout:` lines exist, no `timeout:` key.

**Plausible consequence (not locally verifiable):** If a provider connection stalls without the browser surfacing `onerror`, the in-flight promise for that `cacheKey` never settles. `fetchWithCache` retains it in `inFlightRequests` (`:1712-1716`); every subsequent `refreshPanel` coalesces onto the unresolved promise, so that match never updates until page reload. Per-key isolation means other matches are unaffected. The stall trigger is browser/Tampermonkey socket-default dependent — not a confirmed failure, but a confirmed dead-code path.

**Secondary effect (from RUNTIME_AUDIT §6):** `setInterval(refreshPanel, ms)` fires regardless of whether the previous run settled. Under a stall, successive `refreshPanel` calls each hold a `Promise.all` over all matches; network is still coalesced, but **pending-promise accumulation** occurs until the underlying request settles or the page is reloaded.

**Fix — activate `ontimeout`:**
```js
// In both gmFetchJson (:957) and gmFetchJsonWithMeta (:990) option objects:
GM_xmlhttpRequest({
  method: 'GET',
  url,
  headers,
  timeout: 12000,   // ← add this; activates existing ontimeout reject paths
  onload(resp) { ... },
  onerror(err) { ... },
  ontimeout() { reject(new Error('timeout')); }  // ← already present, now reachable
});
```

**Optional defense-in-depth:** wrap `findScoreForMatch` provider calls in `withTimeout(…, 15000)` as `getEnrichmentData` at `:4988` already does.

**Tests:** keep `tests/cache.test.js` → "a rejected fetch never leaks an in-flight entry" green (the `ontimeout` reject must flow through the same cleanup). Recommended add: stub `GM_xmlhttpRequest` to honor `timeout`/`ontimeout` in the test harness and assert that a timed-out fetch (a) rejects, (b) caches the safe empty shape, and (c) clears `inFlightRequests`.

**Caution:** choose a timeout value comfortably above the slowest provider's response latency (TheScore windowed feed, BBC). A value that is too short converts slow-but-valid responses into 15 s error-cache entries. Too-long is harmless (preserves current behavior).

---

## Runtime hygiene — Unhandled rejection on capture-path `clone().text()` failure *(Low)*

**File/lines:** `Torn_Bookie_Live_Scores.js:896-898`.

**Bug:** The fetch intercept path is:
```js
response.clone().text().then(text => tryParseBookieResponse(text, url))
// ← no .catch()
```
If `response.clone().text()` rejects, the rejection is unhandled at the Promise level. It is caught by the global `unhandledrejection` handler at `:917` and logged via `recordDebugEvent`, so it is never user-visible — but it adds noise to the debug log and is a hygiene gap.

**Fix:**
```js
response.clone().text()
  .then(text => tryParseBookieResponse(text, url))
  .catch(() => {});  // clone/text failures are non-fatal; swallow silently
```

**Regression risk:** None. `tryParseBookieResponse` already swallows parse errors at `:882`.

---

## Excluded / Watchlist Items

These are documented in the audit set but are **not** current fixes without real provider/Torn payload evidence.

### B-1 — Non-`inprogress` / non-`notstarted` Torn bet statuses are dropped *(Informational)*

**File/lines:** `extractLiveBets:1928-1935`, `extractUpcomingBets:1937-1945`.

**Behavior:** only `inprogress` bets appear as live and only `notstarted` bets appear as upcoming. Other Torn bet statuses would be absent from the panel.

**Why excluded:** whether Torn emits other statuses for held `your-bets` rows is unverified offline. Do not change until a real `sid=bookieApi` payload shows such a status.

### B-2 — `delayed` / `abandoned` / `suspended` not classified in any status set *(Informational)*

**File/lines:** `LIVE_STATUS_VALUES` / `NON_LIVE_STATUS_VALUES` / `FINAL_STATUS_VALUES` at `:1322-1324`.

**Issue:** These three statuses appear in neither set. A provider candidate marked `abandoned` or `suspended` is not treated as final, so `resolvedEventCache` retains the longer active TTL (5 min vs. 2 min final) and the UI does not show a completed state for that fixture.

**Evidence:** `tests/states.test.js` → `"isFinalStatus: … abandoned/suspended/delayed are NOT"` and `"BEHAVIOR: delayed/abandoned/suspended are neither live nor final nor non-live"`.

**Possible future fix:** add `abandoned`, `suspended`, `delayed` to `FINAL_STATUS_VALUES` if provider data confirms these are terminal states, or add a dedicated `SUSPENDED_STATUS_VALUES` set and handle in `scoreCandidate`/`resolvedEventCache` invalidation logic accordingly. **Do not change without a confirmed real-world provider payload showing one of these statuses** — the current behavior is neutral (longer cache TTL) rather than wrong.

---

## Test Harness — Characterization Tests to Flip on Fix

The following tests are currently **green** asserting the *buggy* behavior (prefixed `DEFECT:` / `BEHAVIOR:`). Each fix must update the corresponding assertion to the corrected expectation, then verify all 149 (+ any new) tests pass:

| Test file | Test name (current) | Expected assertion after fix |
|---|---|---|
| `tests/matching.test.js` | `DEFECT: containment heuristic over-matches contained names` | `calcTeamMatchScore('Mexico','New Mexico') < 60` |
| `tests/metadata.test.js` | `DEFECT: SCRIPT_VERSION constant disagrees with @version header` | `SCRIPT_VERSION === '2.5.3'` (or `=== GM_info.script.version`) |
| `tests/metadata.test.js` | `DEFECT: @homepage has a 'hhttps' typo` | `@homepage` starts with `https://` |
| `tests/odds-math.test.js` | `DEFECT: abbreviateSelection leaks filler word + trailing space` | `abbreviateSelection('FC Barcelona') === 'BAR'`; no trailing space |
| `tests/runtime.test.js` | `providerCache grows monotonically … NOT auto-pruned on expiry` | size decreases after sweep of expired entries |
| `tests/runtime.test.js` | `enrichmentCache grows one entry per distinct match key and is never pruned` | size caps or drops stale keys |

**Invariant:** all other tests (currently 149 pass) must remain green after each fix. Run full suite + shuffled-order + concurrency stress before releasing any change to matching, caching, or network logic.
