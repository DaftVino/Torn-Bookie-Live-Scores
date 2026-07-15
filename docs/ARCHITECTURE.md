# Torn Bookie Live Scores Architecture

Last reviewed: 2026-06-25
Production source: `Torn_Bookie_Live_Scores.js`
Userscript version reviewed: `3.0.0`

## Purpose

Torn Bookie Live Scores is a single-file Tampermonkey userscript. It captures the Torn Bookie page's own `sid=bookieApi` responses, renders a compact live/upcoming bets panel, and enriches live bets with public score providers plus optional BYOK odds and esports integrations.

The deployment model is intentionally simple: one IIFE, no runtime dependencies, no build step, and no code exported to the page except the required userscript hooks.

## Bootstrap And Capture Flow

The script runs at `document-start` and first decides whether it should run at all. Two runtime context checks gate everything below them, in order:

- `isSofascoreContext()` — on SofaScore, install only the token capture and return.
- `isBookiePageContext()` — off the Torn Bookie page, return immediately.

`isBookiePageContext()` requires hostname (`www.torn.com` / `torn.com`), path (`/page.php`), and `sid=bookie` — deliberately at least as strict as the `@match`. This exists because Torn PDA does not honour `@match` and injects the script on every Torn page ([TORN_PDA.md](TORN_PDA.md)). The early return is what keeps the interceptors, listeners, panel, and timers off every page that is not the Bookie page. **Anything added above that return runs on every Torn page PDA injects into**; keep new work below it.

On the Bookie page it then installs two page-realm interceptors:

- `fetch` wrapper: watches only URLs containing `sid=bookieApi`.
- `XMLHttpRequest` wrapper: watches only URLs containing `sid=bookieApi`.

Matching Torn responses are parsed and kept in module memory as `capturedBookieData`. The capture path debounces panel refreshes so repeated Torn API responses do not force immediate repeated renders.

Bootstrap waits for `document.body`, creates the panel, schedules an initial refresh, and starts the default `30s` refresh interval. The panel is recreated if Torn's SPA removes it.

## Data Flow

```text
Torn Bookie page request
  -> fetch/XHR interceptor
  -> tryParseBookieResponse
  -> capturedBookieData
  -> refreshPanel
  -> extractLiveBets / extractUpcomingBets
  -> findScoreForMatch for live bets
  -> renderPanel
```

Only live bets receive automatic score lookups during `refreshPanel`. Upcoming bets are rendered without score lookups until details/enrichment needs them.

## Provider Model

Score providers are tried per match in priority order and stop at the first confident result. Provider failures are isolated: one provider can fail, parse badly, or return no match while later providers still run.

The raw score priority array in code is:

```text
PandaScore -> ESPN -> ESPNcricinfo -> SofaScore -> API-Football -> API-Sports -> LiveScore -> TheScore -> BBC Sport
```

That array is not the effective order for every match. `getProviderPriority()` filters it by the match's sport, enabled provider toggles, known sport mappings, and available keys. PandaScore only applies to mapped esports and is disabled by default; it is not tried for ordinary sports.

Representative effective ladders with an API-Sports key configured:

```text
Live tennis: SofaScore live board -> ESPN tennis date board
Live football: SofaScore live board -> ESPN soccer date board (if primary) -> API-Football
World Cup / mapped ESPN soccer: ESPN -> SofaScore -> API-Football
Unmapped soccer: SofaScore -> API-Football
Rugby union: SofaScore -> API-Sports -> LiveScore
AFL: ESPN -> SofaScore -> API-Sports -> LiveScore
Cricket: ESPNcricinfo -> LiveScore
Mapped esports: PandaScore, only when enabled and token-configured
```

SofaScore is still active in the current code. It uses `www.sofascore.com/api/v1/...` with a stored `x-requested-with` token and a token-refresh path. It should be treated as token-sensitive and recoverable, not removed or assumed permanently failed. ESPN is preferred where an endpoint is verified. API-Football/API-Sports are BYOK and intentionally late in the ladder to conserve quota.

Tennis is deliberately special-cased. Live tennis tries SofaScore's live board before ESPN because the ESPN date board does not cover all Challenger tournaments. ESPN remains the no-key fallback for covered ATP/WTA/Grand Slam rows and must keep its grouped date-board parser. Do not collapse tennis back to generic ESPN-primary routing without fresh debug evidence and regression tests.

Live football is also special-cased for SofaScore. It checks the SofaScore live board first, but if that board is reachable and no confident football match is found, it does not continue into SofaScore scheduled-events date boards for that same live match. Upcoming football still uses the scheduled-events date-board plan.

## Matching And Date Planning

Provider candidates are normalized into a shared candidate shape, then scored by:

- team-name confidence,
- time compatibility,
- competition/league compatibility,
- live/final status compatibility,
- cached resolved-event reuse.

`resolveProviderMatch` walks a bounded lookup plan for each provider and returns the first accepted candidate. It flags close candidates as ambiguous rather than guessing. Timestamp handling uses UTC provider dates and rejects bare ISO strings without timezone data.

Football has an extra alias/fuzzy layer that is not applied to other sports. The script bundles compact alias groups generated from `openfootball/clubs`, pinned to commit `ae3800227c449447b3a337fc0aac79a8f02f4c8b` under `CC0-1.0`. GitHub is not fetched at runtime; the bundled data is attribution and update provenance only.

The football matcher lazily expands normalized club names to alias-group IDs, rejects high-confidence matches from ambiguous one-token aliases, supports acronym/full-name bridges, and uses bounded token fuzzy matching for provider variants. Football candidate acceptance remains pair-oriented: both teams and the home/away orientation must fit, and close reverse-orientation candidates are treated as ambiguous.

## Caching And Request Control

Outbound score and enrichment requests use `fetchWithCache`, which provides:

- success TTL: 45 seconds for normal provider responses,
- error TTL: 15 seconds for provider misses/errors,
- in-flight request coalescing per cache key,
- safe error payloads instead of rejected panel paths,
- expired provider-cache sweeping once the cache grows past the size threshold.

Additional caches:

- `resolvedEventCache`: stores matched provider event identity, with shorter TTL for final events.
- `enrichmentCache`: capped in memory to avoid long-session growth.
- odds-analysis cache: stored in `localStorage`, size-limited by `ODDS_ANALYSIS_CACHE_LIMIT`.

Both `gmFetchJson` and `gmFetchJsonWithMeta` use `GM_xmlhttpRequest` with an explicit timeout. Timeout, HTTP, and network errors flow through the same cache/error path.

## API-Sports Manual-Only Mode

API-Football and API-Sports share one user-supplied API-Sports key. The default `apiSportsRefreshMode` is `manual`.

In manual-only mode:

- automatic refreshes serve existing API-Sports boards from cache only,
- no API-Sports quota is spent when there is no cached board,
- clicking `Refresh now` clears API-Sports date keys once and allows one fresh board request per sport/date,
- every other provider continues normal automatic refresh behavior.

The manual gate is passed as an explicit refresh context into `findScoreForMatch`, `_findApiFootball`, `_findApiSports`, and `fetchApiSportsBoard`. It does not rely on a mutable global manual flag, so overlapping refreshes cannot leak manual quota state across refresh contexts.

## SofaScore Token Refresh

SofaScore uses the public `www.sofascore.com/api/v1/...` API with an `x-requested-with` token. The script stores the latest observed token in userscript storage and falls back to a known public value.

When a SofaScore call appears token-blocked, the script may open a background SofaScore refresh tab at:

```text
https://www.sofascore.com/#tbls-token-refresh
```

On SofaScore pages, the script captures `x-requested-with` from XHR/fetch calls for `/api/v1/` requests, stores the fresh token, and closes the refresh tab only after this page session captures a token. Existing old token timestamps alone do not close the tab.

HTTP 404 from a SofaScore path is not a token rejection and must not open the token-refresh tab. The tennis date schedule path has returned 404 while the live tennis path succeeded, so 404s are treated as endpoint coverage/path failures.

## Details And Enrichment

The details pane is progressive. It can show:

- current score/source,
- selected Torn bets and implied probability,
- ESPN reuse data when the score came from ESPN,
- NHL/SofaScore/TheScore team snapshots where supported,
- SofaScore H2H data,
- optional The Odds API analysis,
- deterministic commentary,
- source freshness and provider diagnostics.

Enrichment is on-demand and bounded. It is not a background polling system.

## Debug Report And Privacy Boundaries

Debug mode adds a copyable JSON report for triage. The report includes:

- script/version/settings summary,
- browser/page metadata,
- current match summaries,
- provider/cache summaries,
- recent debug events,
- network per-host status and shape-only samples.

The report excludes raw Torn responses, Torn account data, bet amounts, bet selections, provider keys, bearer tokens, cookies, local/session storage dumps, and raw provider payloads. Redaction is applied recursively through `sanitizeDebugValue`.

## Testing Surface

The repository has a Node `vm` harness in `tests/load-userscript.js` that loads the real userscript and exports selected internals for deterministic tests. Current coverage focuses on:

- metadata and privacy/security,
- date and status planning,
- matching and ambiguity,
- provider routing and parser contracts,
- cache/coalescing behavior,
- API-Sports manual mode,
- SofaScore token capture,
- BBC/API-Football/ESPNcricinfo provider behavior,
- render-state safety.

Live Torn DOM behavior and real provider schema drift still require manual Tampermonkey smoke tests before release.
