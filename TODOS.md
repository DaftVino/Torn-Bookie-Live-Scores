# TODOS

Deferred work with rationale. Items here are consciously postponed, not forgotten.

## Mobile / Torn PDA

### Panel top offset and safe-area insets

**Deferred from:** [#1](https://github.com/DaftVino/torn-bookie-live-scores/issues/1) (Torn PDA compatibility). Background: [docs/TORN_PDA.md](docs/TORN_PDA.md).

The panel's `#${PANEL_ID}` rule hardcodes `top: ${PANEL_TOP}px` (90px, from the `PANEL_TOP` constant), which assumes the desktop Torn header height. Torn PDA's app bar is a different height, and there is no allowance for device notches. The details pane reuses the same constant.

**Why deferred:** the reporter confirmed the current position looks fine on their device. Picking a better `top` needs an on-device measurement of PDA's header height, and `env(safe-area-inset-*)` support needs testing on a device with a notch. Guessing would risk regressing a position that currently works.

**What it needs:** a device with a notch, plus a measurement of PDA's app bar height. Then either a smaller `top` under the 480px breakpoint, `env(safe-area-inset-top)`, or both.

**Blast radius if wrong:** panel sits too low or overlaps content on PDA. Cosmetic, not functional.

## Performance / robustness (unscheduled)

Raised in an external review (ChatGPT, GPT-5.6) of the v3.1 source. Only items verified against the code are kept here; see "Rejected review findings" below for the ones that were already implemented.

### Stale refreshes can clobber a newer render

`refreshPanel()` (`Torn_Bookie_Live_Scores.js`) has no re-entrancy guard. `isRefreshingPanel` is a UI spinner flag, not a generation counter, and nothing aborts in-flight provider requests. Two refreshes can overlap when provider latency exceeds the interval — plausible on the 10s setting with a slow or timing-out provider — and whichever `await Promise.all(...)` settles last wins the `renderPanel()` call. The panel can therefore show older scores than it already had.

**What it needs:** a monotonically increasing refresh generation captured at entry and re-checked before `renderPanel()`, so a superseded cycle drops its result. An `AbortController` threaded through `gmFetchJson` would also cancel the wasted requests, but the generation check alone fixes the visible bug. There is currently no `AbortController` anywhere in the source.

**Blast radius:** transient wrong scores that self-correct on the next refresh. Worst on the 10s interval.

### No negative-match cache for confidently unmatched events

`TTL_ERROR` (15s) caches provider *errors*. It does not cover the case where a provider returns a perfectly good board that simply does not contain the event. A postponed, obscure, or oddly-named Bookie event therefore walks the entire enabled provider list on every refresh, and each provider re-fetches its board once its 45s `TTL_SUCCESS` lapses — forever, for an event that will never match.

Note this is much cheaper than it first looks: boards are cached per sport/date and shared across matches, so the repeated work is mostly local re-matching rather than per-event network calls. The cost is the periodic board refresh for providers that could never resolve the event.

**What it needs:** cache a confident non-match per `(provider, event)` for 60–120s, distinct from the error TTL, and skip that provider for that event while it holds. `resolvedEventCache` already has the right key shape to model this against.

### SofaScore background token refresh has no opt-out

`refreshSofascoreToken()` calls `GM_openInTab(SOFASCORE_REFRESH_URL, { active: false })` on a 401/403/challenge response, throttled to once per `SOFASCORE_XRW_REFRESH_COOLDOWN_MS` (6h). There is no user setting gating it — the only controls are disabling the SofaScore provider entirely (`uiSettings.enabledProviders.sofascore`) or the cooldown.

This depends on undocumented SofaScore behavior, so it is the most likely thing to break, and silently opening a tab is surprising to a user who did not opt into it.

**What it needs:** a settings toggle (e.g. "Allow SofaScore background token refresh"), defaulting off, with the existing `SOFASCORE_XRW_FALLBACK` token path as the graceful degradation. Not urgent while the cooldown holds it to 4×/day worst case.

### Refresh cadence does not adapt to whether anything is live

`REFRESH_OPTIONS` offers 10s/30s/3m/manual and bootstrap defaults to `30s`, which is already sensible. What is missing is backing off when there is nothing to watch: a card of purely upcoming bets is reprocessed on the same cadence as a live one.

**What it needs:** drop to the 3m cadence when no match is live, restore on the first live event. Interacts with the negative-match cache above — do both or neither, since they share the "stop doing pointless work" motivation.

**Why unscheduled:** pure optimization; nothing is visibly wrong today.

### No cost instrumentation

The review's most actionable meta-point: none of the above can be prioritized without numbers. There is no measurement of refresh duration, providers attempted per event, cache-hit rate, request count, or DOM nodes rendered.

**What it needs:** extend the existing debug-report infrastructure (`recordDebugEvent`) with per-refresh timing and counters. This should probably land *first* — it turns the items above from plausible into measured.

## Known issues (unscheduled)

### `getRefreshErrorSummary()` mislabels capture failures

In `getRefreshErrorSummary()` (`Torn_Bookie_Live_Scores.js`), a "Waiting for Torn Bookie data capture" error does not match any of the network/key patterns, so it falls through to the generic `'Refresh failed.'` summary. A real capture failure is therefore indistinguishable from a provider or network failure in the summary line (the detail body from `renderErrorBody()` underneath does render the correct text).

**Why unscheduled:** surfaced during review of #1 but explicitly out of its scope. Once #1 lands, the panel no longer mounts off-Bookie, so the most common path to this error disappears. It remains reachable on the Bookie page itself when the `sid=bookieApi` response is never captured.
