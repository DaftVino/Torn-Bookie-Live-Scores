# Changelog

## Torn Bookie Live Scores v3.1.0 - 2026-07-14

### Torn PDA Compatibility

- The script now works in Torn PDA. Torn PDA does not honour `@match` ([torn-pda#314](https://github.com/Manuito83/torn-pda/issues/314)) and injects userscripts on pages the author never targeted, so the panel used to appear on other Torn sections showing "Refresh failed" and re-running a failing fetch every 30 seconds.
- Page scoping is now enforced at runtime instead of relying on the metadata block. Off the Bookie page the script returns immediately: no panel, no `fetch`/XHR interception, no refresh loop, no network requests.
- The runtime check matches the `@match` it stands in for: hostname, path, and `sid` must all line up. A URL like `torn.com/city.php?sid=bookie` does not activate the panel.
- This also reduces attack surface on desktop and in PDA. The `fetch`/`XMLHttpRequest` interception and the global error listeners now install only on the Bookie page rather than on every Torn page the script is injected into.
- Install note for PDA: enable *Settings → Advanced browser settings → enable custom user scripts*, and set **Injection time = Start**. The script intercepts network calls at `document-start` and will not capture your bets on **End**.

### Mobile Layout

- The panel now fills the screen width on phones (viewport minus a 12px gap per side) instead of staying at a fixed 360px and leaving dead space.
- Panel height now tracks the dynamic viewport (`dvh`), so it no longer runs off-screen under Torn PDA's app bar. Falls back to `vh` on engines without `dvh`.
- The collapse toggle and refresh controls now present a 44px hit area on touch devices. Desktop sizing is unchanged.

### Housekeeping

- Shortened the script description for the Greasyfork listing.
- Added `TODOS.md` to track deferred work.

## Torn Bookie Live Scores v3.0.0 - 2026-06-25

### Provider Matching Intelligence

- Added a football-only club alias and fuzzy-matching upgrade backed by a bundled compact alias list generated from `openfootball/clubs`.
- Bundled alias data is pinned to commit `ae3800227c449447b3a337fc0aac79a8f02f4c8b`, attributed under `CC0-1.0`, and is not fetched from GitHub at runtime.
- Added supplemental football alias groups for observed debug failures, including Moroccan variants such as `RSB Berkane`/`RS Berkane`, `FAR Rabat`/`AS FAR Rabat`, `Renaissance Zemamra`, `OC Safi`, `Difaa El Jadida`, `US Touarga`, `KACM`, `CODM Meknes`, and `MAS Fes`.
- Added football-only pair-level matching guardrails so weak fuzzy matches are accepted only when both teams and orientation fit, while ambiguous one-token aliases such as `united`, `city`, `rangers`, and `real` do not become high-confidence matches by themselves.
- Added acronym/full-name football matching for names such as `KACM`, `CODM Meknes`, and `MAS Fes`.
- Improved containment matcher to reject false positives (e.g., "Mexico" no longer matches "New Mexico") by validating whole-word boundaries.
- Reduced SofaScore live-football noise: after a reachable live board returns no confident football match, the script no longer continues into `scheduled-events/YYYY-MM-DD` date-board 404s for that same live match. Upcoming football still uses date boards.
- Clarified API-Sports/API-Football manual-only diagnostics and added `apiSportsRefreshMode` to debug reports.

### UI Feedback And Interaction

- Added themed action notices for copy, details, debug report, fallback, and error feedback with semantic colors and auto-dismiss.
- Added consistent loading, success, error, and disabled states for copy/details/debug buttons with visual feedback.
- Added selected-game context in Tools summary so users know exactly which Torn bet their actions affect.
- Added no-selection disabled states preventing accidental actions when no game is selected.
- Added session-only copy receipts in Tools (metadata stored locally, payload content not persisted).
- Added selected-row, details-active-row, and unmatched-row visual states with compact status/source/confidence pills.
- Improved row affordances: added selected-row visual language, confidence badges, and source indicators.
- Made "no selection" state clear with disabled-state messaging.

### Score Coverage Enhancements

- Added ESPN tennis date-board parsing for the grouped tournament shape returned under `events[].groupings[].competitions[]`.
- Changed ESPN tennis to try the date-only `tennis/all` board before falling back to verified per-tournament IDs.
- Added a live-tennis SofaScore fallback through `/api/v1/sport/tennis/events/live`, which covers Challenger matches not present in ESPN's date board.
- Added SofaScore tennis set-by-set score formatting from period fields, including tiebreak values when present.

### Error Handling And Reliability

- Prevented SofaScore HTTP 404 endpoint failures from triggering token-refresh tabs; token refresh is reserved for auth/challenge failures.
- Improved `GM_xmlhttpRequest` timeout configuration for better stalled-connection detection (default 12s timeout).
- Added cache eviction strategy for `providerCache` and `enrichmentCache` to prevent unbounded memory growth over long sessions.

### Metadata And Diagnostics

- Fixed `SCRIPT_VERSION` constant to sync automatically from `@version` header via `GM_info` with fallback.
- Fixed `@homepage` URL metadata (corrected typo from `hhttps://` to `https://`).
- Kept copy payload output unchanged; stored only receipt metadata, not copied text.
- Preserved provider ordering, Settings controls, existing details behavior, and the single-file userscript model.

### Testing And Regression Coverage

- Added comprehensive regression coverage for football alias cases, false-positive guards, SofaScore live-football no-date-board fallback, and API-Football manual-only skip wording.
- Added characterization tests for confirmed behavior changes and fixes.
- Ran full test suite (150+ tests) to verify no regressions in provider logic, matching, state extraction, or rendering.

## Torn Bookie Live Scores v2.5.8 - 2026-06-24

- Added themed action notices for copy, details, debug report, fallback, and error feedback.
- Added consistent loading, success, error, and disabled states for copy/details/debug buttons.
- Added selected-game context, no-selection disabled states, and session-only copy receipts in Tools.
- Added selected-row, details-active-row, and unmatched-row visual states with compact status/source/confidence pills.
- Added ESPN tennis date-board parsing for the grouped tournament shape returned under `events[].groupings[].competitions[]`.
- Changed ESPN tennis to try the date-only `tennis/all` board before falling back to verified per-tournament IDs.
- Added a live-tennis SofaScore fallback through `/api/v1/sport/tennis/events/live`, which covers Challenger matches not present in ESPN's date board.
- Added SofaScore tennis set-by-set score formatting from period fields, including tiebreak values when present.
- Prevented SofaScore HTTP 404 endpoint failures from triggering token-refresh tabs; token refresh is reserved for auth/challenge failures.
- Kept copy payload output unchanged and stored only receipt metadata, not copied text.
- Preserved provider ordering, Settings controls, existing details behavior, and the single-file userscript model.

## Torn Bookie Live Scores v2.5.3 Patch Notes

These notes describe the feature set present on `main` at version `2.5.3`, before the current round of testing and follow-up edits.

## Highlights

- Added a configurable Torn Bookie side panel for live and upcoming bets.
- Groups Bookie entries by sport, with collapsible sections and optional auto-collapse for upcoming games.
- Supports right-side or left-side layout, manual refresh, and automatic refresh intervals of 10 seconds, 30 seconds, or 3 minutes.
- Adds three scoreboard display modes: Large, Classic, and Minimal.
- Includes five themes: Default Dark, Bloody Bets, Things, Sleek Light, and C64 Retro.

## Score Sources

- Added staged per-match score lookup across ESPN, SofaScore, LiveScore, TheScore, BBC Sport, and optional PandaScore.
- Uses provider fallback per match instead of requiring every provider to resolve every game.
- Adds confidence-based team matching to reduce incorrect score assignments.
- Caches successful provider responses for 45 seconds and provider misses/errors for 15 seconds.
- Coalesces duplicate in-flight requests so repeated refreshes do not spam providers.
- Adds row-level source labels and a "Powered by" source summary.
- Adds safe source links where providers expose or support a usable public match page.

## Supported Sports

- Adds sport controls for American Football, Australian Football, Badminton, Baseball, Basketball, Counter-Strike, Cricket, Dota 2, Football, Hockey, League of Legends, Rugby, Rugby League, Tennis, and Valorant.
- Excludes sports that do not yet have reliable score coverage in this version, including volleyball, snooker, Overwatch, handball, horse racing, boxing, MMA/UFC, motorsports, and Formula 1.
- Adds PandaScore BYOK score support for Counter-Strike, League of Legends, Dota 2, and Valorant.

## Details Pane

- Adds per-game details buttons for live and upcoming Bookie entries.
- Details pane can appear beside the panel, at the screen edge, or be disabled.
- Shows score details, match metadata, selected bets, and implied probability from Torn odds where available.
- Adds progressive enrichment sections for team snapshot, commentary, odds analysis, and source list.
- Adds deterministic commentary that summarizes known facts, supporting factors, and risk factors without using an external AI service.
- Adds source freshness indicators for cached/fresh details data.

## External Odds

- Adds optional BYOK integration for The Odds API.
- API keys are stored locally through the userscript manager and are masked in the UI.
- Adds odds region selection for US, US2, UK, EU, and AU.
- Adds moneyline-only and full-market modes. Full-market mode pulls h2h, spreads, and totals where available.
- Shows estimated credit cost for each odds pull and tracks remaining quota when available.
- Adds an Odds Analysis panel with consensus probability, fair price, best available price, EV, and best-bet summary.
- Caches odds analysis locally per match, region, market mode, and odds format.

## Tools And Settings

- Adds copy tools for the selected Bookie game.
- Adds a "Show Game Details" tool for the selected/expanded game.
- Adds display toggles for live scores, upcoming games, copy tools, source summaries, row sources, bet amounts, details buttons, unmatched-game filtering, and upcoming auto-collapse.
- Adds provider toggles for ESPN, SofaScore, LiveScore, TheScore, BBC Sport, and PandaScore.
- Adds details-section toggles for team stats, odds analysis, commentary, and source list.
- Adds a reset action for UI settings and local integration state.

## Debugging And Privacy

- Adds debug mode with a copyable debug report for troubleshooting.
- Debug reports redact stored Odds API keys and PandaScore tokens.
- Adds a privacy disclosure in the userscript header explaining what data is and is not sent to external providers.
- Does not send Torn usernames, account data, bet amounts, bet selections, or personal information to score providers.
- Disabled providers are not contacted. PandaScore and The Odds API require user-supplied keys before use.

## Known Limitations

- Some provider sport feeds are intentionally disabled where their public endpoints returned unreliable 404 responses in this version.
- The Odds API analysis is limited to mapped sports/leagues: MLB, NBA, WNBA, NHL, NFL, CFL, AFL, NRL, and MLS.
- PandaScore only covers the mapped esports listed above and requires a user-provided token.
