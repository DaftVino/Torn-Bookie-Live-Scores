# Last Debug Capture

Source attachment:

`C:\Users\jm3ak\.codex\attachments\62e06eb2-28f2-4b46-977f-18e73ad9154e\pasted-text.txt`

Generated at: `2026-06-24T12:32:17.708Z`

Script: `Torn Bookie Live Scores Panel` `2.5.7`

Viewport: `1080x1751`, timezone `America/New_York`

## Panel State

- Panel hidden: `false`
- Settings collapsed: `false`
- Tools collapsed: `false`
- Details open: `true`
- Active details match: `Kinondoni MC v Namungo FC`
- Live rows: `3`
- Upcoming rows: `24`
- Total rows: `27`

## Match Mix

| Sport | Count |
|---|---:|
| Tennis | 20 |
| Football | 5 |
| League of Legends | 1 |
| Baseball | 1 |

Initial source assignment:

| Source | Count |
|---|---:|
| ESPN | 26 |
| PandaScore | 1 |

Score results:

- Found scores: `2`
- Unmatched live scores: `1`
- Resolved events:
  - `sofascore:lorenzo angelini|dali blanch|tennis|plovdiv 2026(challenger)|1782304200000`
  - `sofascore:ugo humbert|jenson brooksby|tennis|lexus eastbourne open 2026(atp)|1782304200000`

## Live Match Outcomes

| Match | Status | Score result | Detail |
|---|---|---|---|
| Mathys Erhard v Inaki Montes | `1st Set` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, LiveScore/TheScore/BBC tennis 404 |
| Lorenzo Angelini v Dali Blanch | `Not started` / `inprogress` | Found via SofaScore | Detail `scheduled`, no set score values |
| Ugo Humbert v Jenson Brooksby | `Not started` / `inprogress` | Found via SofaScore | Detail `scheduled`, no set score values |

The two SofaScore-resolved live rows still look suspicious because Torn marks them `inprogress` while provider detail is `scheduled` and the display status is `Not started`. Keep this as a status-normalization/match-state follow-up, separate from the provider lookup failure.

## Network Summary

| Host | Last status | OK count | Error count | Notes |
|---|---:|---:|---:|---|
| `site.api.espn.com` | 200 | 17 | 0 | ESPN itself is reachable but current tennis ID coverage misses some rows |
| `www.sofascore.com` | 200 | 6 | 0 | Tennis and football boards reachable |
| `prod-public-api.livescore.com` | 404 | 0 | 6 | Tennis date endpoint is failing |
| `api.thescore.com` | 404 | 0 | 2 | Tennis events endpoint is failing |
| `www.bbc.com` | 404 | 1 | 6 | Football page worked once, tennis score pages failed |

## Provider Findings

### Tennis

The latest capture confirms the earlier tennis diagnosis:

- ESPN tennis endpoint calls return HTTP 200, but the current hard-coded tournament ID list misses some competitions.
- SofaScore can resolve at least some tennis rows, but not `Mathys Erhard v Inaki Montes`.
- LiveScore tennis endpoint returns 404 for `24/06/2026`, `23/06/2026`, and `25/06/2026`.
- TheScore tennis endpoint returns 404 for the queried date window.
- BBC tennis score pages return 404 for `2026-06-24`, `2026-06-23`, and `2026-06-25`.

Observed competitions that matter for tennis repair:

- `Plovdiv 2026(Challenger)`
- `Lexus Eastbourne Open 2026(ATP)`
- `Wimbledon, Qualification ATP 2026(Grand Slam)`
- `Wimbledon, Qualification WTA 2026(Grand Slam)`

Repair direction:

1. Add sanitized candidate diagnostics when a provider reports events but no confident match. Include top candidate names, provider start time, tournament, status, confidence, and rejection reason.
2. Add or verify ESPN tennis IDs for Plovdiv Challenger and Wimbledon qualifying events.
3. Consider making SofaScore earlier or primary for tennis while ESPN ID coverage is incomplete.
4. Disable or suppress LiveScore/TheScore/BBC tennis retries after known 404s unless those endpoints are re-probed and remapped.

### Football

Tanzania Premier League rows are assigned ESPN because the current soccer league matcher treats generic `Premier League` as English Premier League. The capture shows ESPN `soccer_eng_pl` requests for football rows whose competition is `Premier League 2025/2026(Tanzania 1)`.

Repair direction:

1. Tighten ESPN soccer mapping so `english premier` or an explicit England/ENG context is required for `soccer_eng_pl`.
2. Route unmapped soccer leagues to SofaScore and API-Football rather than ESPN.
3. Add a regression test for `Premier League 2025/2026(Tanzania 1)` so it does not map to `soccer_eng_pl`.

## Repair Plan

Each numbered step is intended to be a focused implementation/review unit with only the related context carried forward.

### Step 1 - Panel Scrolling

Goal: no runtime max-match cap. The UI should support all rows returned by Torn and expose the full controls through scrolling.

Repair direction:

1. Keep the fixed panel bounded to the viewport.
2. Make the panel a vertical flex container.
3. Keep the header outside the scrolling area.
4. Make `.tm-bookie-content` the only vertical scroll container.
5. Give `.tm-bookie-content` `flex: 1`, `min-height: 0`, and `overflow-y: auto`.
6. Remove the competing hard-coded content `max-height` that can stop before Settings.
7. Add bottom padding inside the scroll area so the final settings controls are not flush against the viewport edge.

This should let any number of rows scroll to the full UI without a match count limit. A practical visual/regression test should use 25 to 30 rows because that reproduces the bug, but that test size is only a fixture size, not a runtime cap.

If the Torn page itself injects an ancestor or overlay that traps wheel events, add wheel handling only on the panel content to keep scroll deltas inside `.tm-bookie-content`. That is a fallback, not the first fix.

### Step 2 - Powered By Sources And Logos

Current provider icon coverage from code review:

- Has image icon: ESPN, SofaScore, LiveScore, TheScore, BBC Sport, PandaScore.
- Text fallback today: ESPNcricinfo, API-Sports, API-Football, Torn.

User decisions:

1. `espncricinfo` should use the existing ESPN image.
2. `apisports` and `apifootball` should use this image: `https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS3ctH13s5tLNx9ie7nSukNeA5UdxCK8ttBRPVKFgT1aQ&s`
3. `Torn` should not be shown as a Powered By source because Torn does not provide live scores.

Verification from code:

- `getActiveSources()` already ignores `torn` when a real score source or supported provider exists.
- `getActiveSources()` currently adds `torn` only when no other source keys are available.
- `getInitialHeaderSources()` currently returns `['torn']` only when no enabled provider source exists.
- Therefore, showing `Torn` is only a fallback edge case. It can be removed without changing score fetching or match routing.

Repair direction:

1. Add `SOURCE_ICONS.espncricinfo = SOURCE_ICONS.espn`.
2. Add the API-Sports/API-Football image URL for both `apisports` and `apifootball`.
3. Remove `torn` from Powered By fallback behavior. If no real source is available, show no badge or hide the source list.
4. Keep Torn odds/Bookie data references in details where they are relevant; only remove Torn from the Powered By source list.

### Step 3 - BYOK Quota And Token Usage Display

Current behavior from code:

- API-Sports/API-Football captures per-sport headers when a board request succeeds:
  - `x-ratelimit-requests-remaining` as daily remaining.
  - `x-ratelimit-remaining` as per-minute remaining.
- PandaScore captures `x-rate-limit-remaining` as hourly remaining when a PandaScore request succeeds.
- The Odds API captures:
  - `x-requests-remaining`
  - `x-requests-used`
  - `x-requests-last`
- The Odds API quota display currently only shows `Remaining quota`, and it can show an empty/placeholder value before any successful odds pull or when the provider omits the header.

User requirement:

Each BYOK provider should have an individual display for usage/quota where available. If the provider does not report remaining tokens, the script should still count script-made requests in the last 24 hours. If the API reports quota exhaustion, the display should change to `Out of Tokens`.

Best approach:

Use a layered quota model:

1. Provider-reported quota is authoritative when present.
2. A local rolling 24-hour usage counter is always maintained as a fallback and sanity check.
3. Explicit quota exhaustion wins over both and displays `Out of Tokens`.

This is better than relying only on local counting because users may spend the same API key outside this script, in another browser, or before this page session started. It is better than relying only on provider headers because some providers omit quota headers or only report hourly/rate-limit data.

Repair direction:

1. Build one shared quota-display helper for settings rows.
2. Add a small local usage ledger in userscript storage for BYOK providers. Store timestamp, provider key, API family/sport, request cost, and outcome. Prune entries older than 24 hours.
3. Count only real network requests, not provider-cache hits, request coalescing duplicates, or API-Sports manual-mode skips.
4. API-Sports/API-Football: show one row per captured sport/API family, for example `Football`, `Rugby`, `AFL`, with provider-reported daily remaining and per-minute remaining when headers exist. Also show local requests used in the last 24 hours.
5. The Odds API: show provider-reported remaining, used, and last request credit cost when headers exist. Also show local credits used in the last 24 hours. If no successful pull has happened, show `Not pulled yet` instead of a blank/em dash.
6. PandaScore: show provider-reported hourly remaining when present and label it as hourly. Also show local requests used in the last 24 hours. If PandaScore exposes no daily/monthly header, do not invent provider quota numbers.
7. Detect explicit exhaustion from HTTP `429`, remaining quota headers equal to `0`, or sanitized provider error text containing quota/rate-limit exhaustion. Mark that provider/API family as `Out of Tokens` with the last seen timestamp.
8. When quota is exhausted, avoid automatic retry loops for that provider/API family. Allow a manual refresh attempt so the user can test whether quota has reset.
9. Debug report should include sanitized quota metadata and local usage totals without exposing keys/tokens.
10. Add tests for "no quota yet", "headers present", "headers missing after successful request", "local 24-hour fallback count", "cache hits do not increment usage", and "explicit quota exhaustion displays Out of Tokens."

### Step 4 - Tennis Score Matching

The latest capture confirms:

- ESPN tennis endpoint calls return HTTP 200 but current hard-coded tournament IDs miss some competitions.
- SofaScore can resolve some tennis rows, but not all.
- LiveScore, TheScore, and BBC tennis endpoints are producing repeated 404s.

Repair direction:

1. Add sanitized candidate diagnostics when a provider reports events but no confident match. Include top candidate names, provider start time, tournament, status, confidence, and rejection reason.
2. Add or verify ESPN tennis IDs for Plovdiv Challenger and Wimbledon qualifying events.
3. Consider making SofaScore earlier or primary for tennis while ESPN ID coverage is incomplete.
4. Disable or suppress LiveScore/TheScore/BBC tennis retries after known 404s unless those endpoints are re-probed and remapped.
5. Add fixture tests for the observed competitions listed above.

### Step 5 - Football Provider Routing

The latest capture shows Tanzania Premier League rows routed to ESPN English Premier League (`soccer_eng_pl`). That is a false mapping caused by the generic `Premier League` text.

Repair direction:

1. Tighten ESPN soccer mapping so English Premier League requires `english premier`, `england`, `eng.1`, or another explicit England context.
2. Route unmapped soccer leagues to SofaScore and API-Football rather than ESPN.
3. Add a regression test for `Premier League 2025/2026(Tanzania 1)` so it does not map to `soccer_eng_pl`.

### Step 6 - Debug Report Improvements

Repair direction:

1. Add scroll metrics: panel/content dimensions, `scrollTop`, `scrollHeight`, `clientHeight`, and settings offset.
2. Add provider candidate diagnostics for "events found; no confident team match."
3. Add quota metadata for each BYOK provider without exposing keys/tokens.
4. Keep provider raw responses out of the debug report.

### Step 7 - Verification

Minimum verification after implementation:

1. Run `node --check ../Torn_Bookie_Live_Scores.js`.
2. Run the full test suite from `tests`.
3. Browser-smoke a 25 to 30 row panel with live/upcoming rows, details open, tools expanded, and settings expanded.
4. Verify the bottom of Settings is reachable by scrolling.
5. Verify Powered By never shows Torn.
6. Verify quota displays are clear before and after each BYOK provider has been used.
