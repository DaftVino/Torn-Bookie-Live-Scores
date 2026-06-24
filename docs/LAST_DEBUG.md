# Last Debug Capture

Source attachment:

`C:\Users\jm3ak\.codex\attachments\15222201-26db-475d-85d1-be1d104916dd\pasted-text.txt`

Generated at: `2026-06-24T13:16:34.326Z`

Script: `Torn Bookie Live Scores Panel` `2.5.7`

Viewport: `1080x1751`, timezone `America/New_York`

## Panel State

- Panel hidden: `false`
- Settings collapsed: `false`
- Tools collapsed: `false`
- Details open: `true`
- Active details match: `Paul Jubb v Tomas Barrios`
- Live rows: `16`
- Upcoming rows: `11`
- Total rows: `27`

Step 1 has been completed and is intentionally left unchanged in the plan below.

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

- Found scores: `9`
- Unmatched live scores: `7`
- Rows with no score lookup yet: `11` upcoming rows
- Resolved events:
  - `sofascore:daniel michalski|jelle sels|tennis|plovdiv 2026(challenger)|1782306300000`
  - `sofascore:dane sweeny|darwin blanch|tennis|wimbledon, qualification atp 2026(grand slam)|1782306900000`
  - `sofascore:mackenzie mcdonald|roberto carballes baena|tennis|wimbledon, qualification atp 2026(grand slam)|1782306900000`
  - `sofascore:alina korneeva|andrea lazaro garcia|tennis|wimbledon, qualification wta 2026(grand slam)|1782306900000`
  - `sofascore:lorenzo angelini|dali blanch|tennis|plovdiv 2026(challenger)|1782304800000`
  - `sofascore:julia riera|fiona crawley|tennis|wimbledon, qualification wta 2026(grand slam)|1782306900000`
  - `sofascore:kaitlin quevedo|claire liu|tennis|wimbledon, qualification wta 2026(grand slam)|1782306000000`
  - `sofascore:erika andreeva|kayla day|tennis|wimbledon, qualification wta 2026(grand slam)|1782306900000`
  - `sofascore:ugo humbert|jenson brooksby|tennis|lexus eastbourne open 2026(atp)|1782306300000`

## Live Match Outcomes

| Match | Status | Score result | Detail |
|---|---|---|---|
| Dodoma Jiji FC v JKT Tanzania | `Not started` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, API-Football parser failed, BBC football events found but no confident match |
| Fountain Gate FC v Mashujaa | `Not started` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, API-Football parser failed, BBC football events found but no confident match |
| Young Africans v Azam FC | `Not started` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, API-Football parser failed, BBC football events found but no confident match |
| Kinondoni MC v Namungo FC | `Not started` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, API-Football parser failed, BBC football events found but no confident match |
| Pamba Jiji v Mbeya City | `Not started` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, API-Football parser failed, BBC football events found but no confident match |
| Mathys Erhard v Inaki Montes | `2nd Set` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, LiveScore/TheScore/BBC tennis 404 |
| Paul Jubb v Tomas Barrios | `1st Set` / `inprogress` | Not found | ESPN no events, SofaScore events found but no confident match, LiveScore/TheScore/BBC tennis 404 |
| Daniel Michalski v Jelle Sels | `1st Set` / `inprogress` | Found via SofaScore | Score `0-0`, detail `1st set` |
| Dane Sweeny v Darwin Blanch | `1st Set` / `inprogress` | Found via SofaScore | Score `0-0`, detail `1st set` |
| Mackenzie McDonald v Roberto Carballes Baena | `1st Set` / `inprogress` | Found via SofaScore | Score `0-0`, detail `1st set` |
| Alina Korneeva v Andrea Lazaro Garcia | `Not started` / `inprogress` | Found via SofaScore | Detail `scheduled`, no set score values |
| Lorenzo Angelini v Dali Blanch | `2nd Set` / `inprogress` | Found via SofaScore | Score `0-1`, detail `2nd set` |
| Julia Riera v Fiona Crawley | `1st Set` / `inprogress` | Found via SofaScore | Score `0-0`, detail `1st set` |
| Kaitlin Quevedo v Claire Liu | `1st Set` / `inprogress` | Found via SofaScore | Score `0-0`, detail `1st set` |
| Erika Andreeva v Kayla Day | `Not started` / `inprogress` | Found via SofaScore | Detail `scheduled`, no set score values |
| Ugo Humbert v Jenson Brooksby | `1st Set` / `inprogress` | Found via SofaScore | Score `0-0`, detail `1st set` |

Two SofaScore-resolved live rows still look suspicious because Torn marks them `inprogress` while provider detail is `scheduled` and the display status is `Not started`. Keep this as a status-normalization/match-state follow-up, separate from the provider lookup failure.

## Network Summary

| Host | Last status | OK count | Error count | Notes |
|---|---:|---:|---:|---|
| `site.api.espn.com` | 200 | 18 | 0 | ESPN itself is reachable but current tennis ID coverage misses some rows; Tanzania football still falsely routes to `soccer_eng_pl` |
| `www.sofascore.com` | 200 | 6 | 0 | Tennis and football boards reachable |
| `prod-public-api.livescore.com` | 404 | 0 | 6 | Tennis date endpoint is failing |
| `api.thescore.com` | 404 | 0 | 2 | Tennis events endpoint is failing |
| `www.bbc.com` | 404 | 3 | 6 | Football pages worked, tennis score pages failed |

## Provider Findings

### Tennis

The latest capture refines the tennis diagnosis:

- ESPN tennis endpoint calls return HTTP 200, but the current hard-coded tournament ID list still returns no events for the queried tennis rows.
- SofaScore now resolves most live tennis rows: 9 live tennis rows are matched from SofaScore.
- SofaScore still does not confidently match `Mathys Erhard v Inaki Montes` or `Paul Jubb v Tomas Barrios`.
- LiveScore tennis endpoint returns 404 for `24/06/2026`, `23/06/2026`, and `25/06/2026`.
- TheScore tennis endpoint returns 404 for the queried date window.
- BBC tennis score pages return 404 for `2026-06-24`, `2026-06-23`, and `2026-06-25`.
- Two SofaScore tennis matches resolve to provider status `scheduled` while Torn marks them live: `Alina Korneeva v Andrea Lazaro Garcia` and `Erika Andreeva v Kayla Day`.

Observed competitions that matter for tennis repair:

- `Plovdiv 2026(Challenger)`
- `Lexus Eastbourne Open 2026(ATP)`
- `Wimbledon, Qualification ATP 2026(Grand Slam)`
- `Wimbledon, Qualification WTA 2026(Grand Slam)`

Repair direction:

1. Add sanitized candidate diagnostics when a provider reports events but no confident match. Include top candidate names, provider start time, tournament, status, confidence, and rejection reason.
2. Add or verify ESPN tennis IDs for Plovdiv Challenger, Eastbourne, and Wimbledon qualifying events.
3. Keep SofaScore early for tennis while ESPN ID coverage is incomplete; it is currently the only provider producing most live tennis scores in this capture.
4. Disable or suppress LiveScore/TheScore/BBC tennis retries after known 404s unless those endpoints are re-probed and remapped.
5. Add status diagnostics for Torn-live/provider-scheduled contradictions.

### Football

Tanzania Premier League rows are assigned ESPN because the current soccer league matcher treats generic `Premier League` as English Premier League. The capture shows ESPN `soccer_eng_pl` requests for football rows whose competition is `Premier League 2025/2026(Tanzania 1)`.

New context from the latest capture:

- All five Tanzania Premier League live rows remain unmatched.
- API-Football is attempted for all five rows but reports `parser failed for 2026-06-24, 2026-06-23, 2026-06-25`.
- SofaScore football boards are reachable and return events, but no candidate passes confidence matching for these rows.
- BBC football pages are reachable and return events, but no candidate passes confidence matching for these rows.
- The debug report does not include enough API-Football response-shape detail to tell whether the parser failure is due to API errors, quota response body, empty response, or a shape change.

Repair direction:

1. Tighten ESPN soccer mapping so `english premier` or an explicit England/ENG context is required for `soccer_eng_pl`.
2. Route unmapped soccer leagues to SofaScore and API-Football rather than ESPN.
3. Add API-Football parser diagnostics: response type, top-level keys, `results`, `errors` keys, candidate count, and quota-header presence.
4. Add candidate diagnostics for SofaScore/BBC football "events found; no confident team match" so the mismatch can be distinguished from provider coverage failure.
5. Add a regression test for `Premier League 2025/2026(Tanzania 1)` so it does not map to `soccer_eng_pl`.

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
- The latest debug report still shows `apiSportsQuota: {}` even after API-Football was attempted and reported parser failures, so quota display cannot depend only on successful parsed boards.

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

The latest capture refines:

- ESPN tennis endpoint calls return HTTP 200 but current hard-coded tournament IDs still return no events for the queried rows.
- SofaScore resolves most live tennis rows in this capture: 9 live tennis rows matched through SofaScore.
- The remaining live tennis lookup misses are `Mathys Erhard v Inaki Montes` and `Paul Jubb v Tomas Barrios`; both have SofaScore events available but no confident candidate match.
- LiveScore, TheScore, and BBC tennis endpoints are producing repeated 404s.
- `Alina Korneeva v Andrea Lazaro Garcia` and `Erika Andreeva v Kayla Day` resolve through SofaScore, but provider status is `scheduled` while Torn marks them live.

Repair direction:

1. Add sanitized candidate diagnostics when a provider reports events but no confident match. Include top candidate names, provider start time, tournament, status, confidence, and rejection reason.
2. Add or verify ESPN tennis IDs for Plovdiv Challenger, Eastbourne, and Wimbledon qualifying events.
3. Keep SofaScore early for tennis while ESPN ID coverage is incomplete, because it is currently the only provider resolving most live tennis rows.
4. Disable or suppress LiveScore/TheScore/BBC tennis retries after known 404s unless those endpoints are re-probed and remapped.
5. Add status diagnostics for Torn-live/provider-scheduled contradictions.
6. Add fixture tests for the observed competitions listed above.

### Step 5 - Football Provider Routing

The latest capture shows Tanzania Premier League rows routed to ESPN English Premier League (`soccer_eng_pl`). That is a false mapping caused by the generic `Premier League` text.

Additional latest-report context:

- All five Tanzania Premier League live rows remain unmatched.
- API-Football is attempted but reports parser failures for `2026-06-24`, `2026-06-23`, and `2026-06-25`.
- SofaScore and BBC football both return events, but no candidate passes confidence matching.
- The debug report does not yet expose enough API-Football response-shape detail to distinguish API errors, quota responses, empty bodies, and parser drift.

Repair direction:

1. Tighten ESPN soccer mapping so English Premier League requires `english premier`, `england`, `eng.1`, or another explicit England context.
2. Route unmapped soccer leagues to SofaScore and API-Football rather than ESPN.
3. Add API-Football parser diagnostics: response type, top-level keys, `results`, `errors` keys, candidate count, and quota-header presence.
4. Add candidate diagnostics for SofaScore/BBC football "events found; no confident team match."
5. Add a regression test for `Premier League 2025/2026(Tanzania 1)` so it does not map to `soccer_eng_pl`.

### Step 6 - Debug Report Improvements

Repair direction:

1. Add scroll metrics: panel/content dimensions, `scrollTop`, `scrollHeight`, `clientHeight`, and settings offset.
2. Add provider candidate diagnostics for "events found; no confident team match."
3. Add parser-failure diagnostics for provider responses: response type, top-level keys, result counts, error-key presence, and provider name.
4. Add quota metadata for each BYOK provider without exposing keys/tokens, including whether quota headers were absent.
5. Keep provider raw responses out of the debug report.

### Step 7 - Verification

Minimum verification after implementation:

1. Run `node --check ../Torn_Bookie_Live_Scores.js`.
2. Run the full test suite from `tests`.
3. Browser-smoke a 25 to 30 row panel with live/upcoming rows, details open, tools expanded, and settings expanded.
4. Verify the bottom of Settings is reachable by scrolling.
5. Verify Powered By never shows Torn.
6. Verify quota displays are clear before and after each BYOK provider has been used.
