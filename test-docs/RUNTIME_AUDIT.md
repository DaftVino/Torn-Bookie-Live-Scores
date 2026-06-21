# RUNTIME AUDIT — Torn Bookie Live Scores

**Source:** `Torn_Bookie_Live_Scores.js` `@version 2.5.3`. **Method:** static code-path analysis + deterministic tests (`tests/runtime.test.js`, `tests/cache.test.js`, `tests/render-states.test.js`, `tests/state-leakage.test.js`). The script is a single IIFE injected once per page load at `@run-at document-start`.

---

## 1. Timers inventory (8 sites) — all bounded

| Site | Kind | Purpose | Cleanup | Leak? |
|---|---|---|---|---|
| `:873-874` `lastRenderTimer` | `setTimeout` 250 ms | capture→refresh debounce | `clearTimeout` before each set | No — singleton |
| `:948-949` | `setInterval` 50 ms | poll for `document.body` | `clearInterval(timer)` once body exists | No — self-clears |
| `:3578-3580` `refreshIntervalId` | `setInterval` (10s/30s/3m) | refresh loop | cleared before re-set (`:3578`); `MAN` clears and sets none | No — **singleton** |
| `:3604` | `setTimeout` 2.5 s | toast auto-remove | element self-removes | No — one-shot |
| `:4374-4375` `detailsResizeTimer` | `setTimeout` 150 ms | resize debounce | `clearTimeout` before set | No — singleton |
| `:4470` | `setTimeout` 250 ms (await) | odds-expand pacing | one-shot await | No |
| `:4835` | `setTimeout` (in `withTimeout`) | enrichment timeout race | one-shot; loses the race or rejects | No |
| `:7104` | `setTimeout` 1.5 s | first paint | one-shot | No |

**No duplicate intervals.** The refresh loop is the only repeating timer and is a strict singleton: `setRefreshMode:3575` always `clearInterval(refreshIntervalId)` before assigning a new one. Switching refresh modes repeatedly cannot accumulate intervals.

---

## 2. Event listeners — no accumulation

| Listener | Site | Binding frequency | Guard |
|---|---|---|---|
| `window 'error'` | `:907` | once (IIFE top level) | runs once per page load |
| `window 'unhandledrejection'` | `:917` | once | runs once per page load |
| `window 'resize'` | `:4373` | once | `detailsResizeListenerBound` flag (`:4371`) |
| header `↻` refresh / hide toggle | `:6862-6868` | once | inside `if (!panel)` creation block |
| content buttons (refresh-mode, sport headers, copy/settings/details) | `:6883-7072` | per `rerenderPanel` | bound to **fresh** nodes after `content.innerHTML` replace; `dataset.bound==='1'` guard (`:6884`,`:6899`,`:6919`,`:7048`…) |
| per-request XHR `'load'` | `:933` | per intercepted XHR | scoped to one XHR instance |

**Why content re-binding does not leak:** `rerenderPanel:5350` replaces `.tm-bookie-content` via `innerHTML`. The previous children (and their listeners) are detached and garbage-collected; the bind functions then attach exactly one listener per fresh node, and the `dataset.bound` flag prevents a second bind on any node that survives. Verified indirectly by `tests/render-states.test.js` ("re-rendering the same match is idempotent — no markup drift / duplication").

---

## 3. DOM observers — none

There is **no `MutationObserver`** in the source (`grep -nE 'MutationObserver|\.observe\(' ` → no matches). SPA-removal recovery is handled by `getOrCreatePanel:5398` re-creating `#tm-bookie-live-panel` whenever it is missing (called at the top of every `refreshPanel`/`rerenderPanel`/`renderError`). Consequently there is **no observer to accumulate** across navigations.

---

## 4. Detached DOM references — none held

Module state holds **no DOM nodes**. The panel and details elements are always re-looked-up by id (`document.getElementById(PANEL_ID)` / `DETAILS_ID`) at point of use. Active-details state is a **string key** (`activeDetailsMatchKey`), not a node (`getActiveDetailsMatch:1095`, `clearActiveDetails:1103`). `latestRenderableMatches:518` holds plain data objects, replaced wholesale each render (`:5334`) and cleared on error (`:5382`). No stale-node retention path exists.

---

## 5. Memory-growth risks (confirmed)

### R-1 (Low, confirmed) — `providerCache` and `enrichmentCache` are never pruned

- **Location:** `providerCache` set at `:1720`/`:1728`, read at `:1705` — **no `.delete`/`.clear`** anywhere (verified by grep). `enrichmentCache` set at `:1192`, read at `:1194` — **no `.delete`/`.clear`**.
- **Evidence (test `tests/runtime.test.js`):**
  - "providerCache grows monotonically across distinct keys and is NOT auto-pruned on expiry" — 25 distinct keys → size 25; after advancing 10 min past every TTL the size is still 25 (expired entries remain resident; `fetchWithCache` only overwrites a key when that same key is fetched again, it never sweeps).
  - "enrichmentCache grows one entry per distinct match key and is never pruned" — 15 matches → size 15; still 15 a day later.
- **Impact:** For a Bookie tab left open for hours/days with auto-refresh, both Maps accumulate one small entry per distinct `(match × provider × date-window)` key (`providerCache`) and per distinct match key (`enrichmentCache`). Entries are small JSON objects, so growth is **slow and monotonic for the session**, bounded in practice by the (finite) set of bets and date windows the user actually holds. Not a crash risk; a long-session hygiene issue.
- **Confidence:** High (code-path + reproducible test).
- **Recommended fix:** add a lightweight sweep of expired `providerCache` entries on each `refreshPanel`, and cap `enrichmentCache` (e.g. drop entries whose match key is no longer in `latestRenderableMatches`, or simple size-capped LRU).

> By contrast, `resolvedEventCache` **does** self-evict on expired access (`:1622`; test "resolvedEventCache self-evicts a single entry on expired access"), `inFlightRequests` is cleaned on settle (test "inFlightRequests returns to empty…"), and the odds-analysis localStorage cache is size-capped via `ODDS_ANALYSIS_CACHE_LIMIT` (`:3031`). So only the two Maps above lack eviction.

---

## 6. Unhandled promises

- **`refreshPanel`** (`:7074`) is wrapped in try/catch and is the body of `setTimeout`/`setInterval` callbacks; its rejection cannot escape (it catches internally and calls `renderError`).
- **Capture path** (`:896-898`): `response.clone().text().then(text => tryParseBookieResponse(...))` has **no `.catch`**. If `clone().text()` rejects, it is an unhandled rejection — but it is caught by the global `unhandledrejection` handler (`:917`) and logged via `recordDebugEvent`, not surfaced to the user. `tryParseBookieResponse` itself swallows parse errors (`:882`). Low impact; consider adding `.catch(() => {})` for tidiness.
- **`findScoreForMatch`** / `resolveProviderMatch`: every provider and step is individually try/caught (`:3498`, `:1644`); `fetchWithCache` converts rejections to a cached error shape (`:1724`). No score-path promise rejects upward.
- **Overlap risk (ties to NETWORK_AUDIT N-2):** `setInterval(refreshPanel, ms)` fires regardless of whether the previous `refreshPanel` settled. If provider requests stall (no `timeout` configured, §N-2), successive `refreshPanel` runs can pile up, each holding a `Promise.all` over the matches. Network is still coalesced (one in-flight promise per key), so this is **pending-promise accumulation**, not request multiplication, and only under the stall scenario. Bounded per refresh by the match count; cleared if/when the underlying request settles.

---

## 7. Repeated initialization & page navigation

- **Single injection.** The userscript runs once per full page load (`@run-at document-start`, `@match` bookie page only). It is **not designed to re-initialize** within a session and does not guard against double-injection (e.g. it would re-wrap `fetch` if run twice in one realm). In normal Tampermonkey operation each full reload is a fresh realm, so double-wrapping does not occur. Confidence: design observation, not a defect.
- **Torn SPA navigation without a full reload.** The script does not re-run, but `getOrCreatePanel` rebuilds the panel if Torn's SPA tears it out, and the captured-data interceptors remain installed on the page realm. This path requires a real DOM/SPA and was **not** exercised in the Node harness — see §8.

---

## 8. Not verifiable locally

- Real-DOM panel teardown/recreate on Torn SPA navigation (`getOrCreatePanel` recreation, listener re-bind on live nodes) — requires a browser. Render idempotency is covered headlessly; live DOM churn is not.
- Actual GC of detached nodes / real memory profile over a multi-hour session — requires a browser profiler.
- Real timer accumulation under genuine async stalls (the §6 overlap path) — the harness uses no-op timers, so interval/timeout scheduling is not exercised at runtime.

---

## 9. Summary

No duplicate intervals, no accumulating observers (there are none), no duplicate event listeners, and no detached-node retention were found; these are either structurally prevented (singleton interval, bind guards, id-based lookups) or confirmed clean by test. The one confirmed runtime issue is **R-1** (two unpruned Maps → slow monotonic session memory growth, Low severity). One **plausible** runtime risk (**N-2**, pending-promise pile-up on a stalled request with no configured timeout) is documented under NETWORK_AUDIT and depends on browser behavior not reproducible offline.
