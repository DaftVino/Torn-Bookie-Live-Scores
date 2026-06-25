# Changelog

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

- Torn PDA is not supported.
- Some provider sport feeds are intentionally disabled where their public endpoints returned unreliable 404 responses in this version.
- The Odds API analysis is limited to mapped sports/leagues: MLB, NBA, WNBA, NHL, NFL, CFL, AFL, NRL, and MLS.
- PandaScore only covers the mapped esports listed above and requires a user-provided token.
