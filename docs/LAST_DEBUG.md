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

Completed on branch `bug-fix-testing-phase-2`.

Verified:

- `node --check Torn_Bookie_Live_Scores.js` passed.
- `npm.cmd test` passed: 238 tests passing.

Summary:

- The fixed panel is now a vertical flex container bounded to the viewport.
- The header stays outside the scrolling area.
- `.tm-bookie-content` is the only vertical scroll container, with `flex: 1`, `min-height: 0`, `overflow-y: auto`, and bottom padding.
- The competing hard-coded content `max-height` was removed.

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

Completed:

- `espncricinfo` now reuses the existing ESPN image badge.
- `apisports` and `apifootball` now use the requested API-Sports/API-Football image URL.
- `torn` is filtered out of Powered By rendering, and empty real-source sets hide the Powered By source list instead of falling back to Torn.
- Torn odds/Bookie data references were left intact outside the Powered By source list.

Verified:

- `node --check Torn_Bookie_Live_Scores.js`
- `npm.cmd test` from `tests` passed: `239/239`.

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

Completed:

- Added a shared BYOK quota/usage display path for API-Sports/API-Football, PandaScore, and The Odds API.
- Added a rolling 24-hour local usage ledger in userscript storage that records only real provider network requests, not cache hits, coalesced requests, or API-Sports manual-mode skips.
- Provider headers now populate per-family quota rows where available; missing headers fall back to local usage counts.
- The Odds API display now shows remaining, used, last request credit cost, and local 24-hour credits when available, with `Not pulled yet` before first use.
- Explicit exhaustion from HTTP `429`, zero remaining quota headers, or quota/rate-limit error text now displays `Out of Tokens`.
- Exhausted score-provider families skip automatic retries while still allowing manual refresh probes for reset checks.
- Debug reports now include sanitized BYOK quota state and local 24-hour usage totals without exposing keys or tokens.

Verified:

- `node --check Torn_Bookie_Live_Scores.js` passed.
- `npm.cmd test` from `tests` passed: `246/246`.

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

Completed:

- Tennis provider priority now tries SofaScore before ESPN while ESPN tournament-ID coverage remains incomplete.
- LiveScore, TheScore, and BBC Sport tennis support is suppressed so the known 404 endpoints are not retried until they are re-probed/remapped.
- Provider misses now record sanitized top-candidate diagnostics: candidate teams, provider start time, tournament, status, confidence, component team scores, overall score, and rejection reason.
- Torn-live/provider-scheduled contradictions now emit sanitized status diagnostics and carry through to score/debug report data.
- ESPN tennis IDs were rechecked against the 2026-06-24 tennis/all board: Wimbledon qualifying, Eastbourne, Mallorca, and Bad Homburg are covered by the existing IDs; Plovdiv Challenger was not present, so SofaScore remains first for tennis.
- Added regression tests for tennis provider ordering/suppression, candidate diagnostics, and provider-scheduled status contradictions.

Verified:

- `node --check Torn_Bookie_Live_Scores.js` passed.
- `npm.cmd test` from `tests` passed: `249/249`.

Summary:

- Step 4 is complete. The next debug report should stop showing repeated LiveScore/TheScore/BBC tennis 404 retries and should include actionable candidate/status diagnostics for remaining SofaScore/ESPN tennis misses.

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

Completed:

- ESPN soccer mapping now requires explicit England context before routing `Premier League` to `soccer_eng_pl`.
- Tanzania `Premier League 2025/2026(Tanzania 1)` no longer maps to ESPN English Premier League and instead falls through to football fallbacks such as SofaScore and API-Football when available.
- API-Football parser diagnostics now report sanitized response shape, top-level keys, `results`, error keys, candidate count, and quota-header presence without raw provider response bodies.
- Football candidate diagnostics now cover provider boards that return events but no confident team match.
- Added regression coverage for Tanzania Premier League routing, API-Football parser diagnostics, and football no-confident-match candidate diagnostics.

Verified:

- `node --check Torn_Bookie_Live_Scores.js` passed.
- `npm.cmd test` from `tests` passed: `252/252`.

Summary:

- Step 5 is complete. The next debug report should stop showing Tanzania Premier League rows routed to `soccer_eng_pl` and should include actionable API-Football parser/candidate diagnostics for remaining football misses.

### Step 6 - Debug Report Improvements

Repair direction:

1. Add scroll metrics: panel/content dimensions, `scrollTop`, `scrollHeight`, `clientHeight`, and settings offset.
2. Add provider candidate diagnostics for "events found; no confident team match."
3. Add parser-failure diagnostics for provider responses: response type, top-level keys, result counts, error-key presence, and provider name.
4. Add quota metadata for each BYOK provider without exposing keys/tokens, including whether quota headers were absent.
5. Keep provider raw responses out of the debug report.

Completed:

- Debug reports now include scroll metrics for the panel, scrollable content area, and settings section, including dimensions, `scrollTop`, `scrollHeight`, `clientHeight`, and settings offset.
- Provider candidate diagnostics remain included for "events found; no confident team match" cases.
- API-Football/API-Sports parser diagnostics now include provider identity, response type, top-level keys, result counts, error-key presence, candidate count, and quota-header presence.
- API-Football/API-Sports provider-error responses now carry sanitized parser diagnostics instead of losing response-shape context.
- BYOK quota metadata and local 24-hour usage totals remain present in debug reports without exposing keys/tokens.
- Raw provider response bodies remain excluded from debug reports.

Verified:

- `node --check ../Torn_Bookie_Live_Scores.js` passed from `tests`.
- `npm.cmd test` from `tests` passed: `254/254`.

Summary:

- Step 6 is complete. The next copied debug report should include actionable scroll metrics plus sanitized provider parser/candidate/quota diagnostics.

### Step 7 - Verification

Minimum verification after implementation:

1. Run `node --check ../Torn_Bookie_Live_Scores.js`.
2. Run the full test suite from `tests`.
3. Browser-smoke a 25 to 30 row panel with live/upcoming rows, details open, tools expanded, and settings expanded.
4. Verify the bottom of Settings is reachable by scrolling.
5. Verify Powered By never shows Torn.
6. Verify quota displays are clear before and after each BYOK provider has been used.

Completed:

- Ran the required syntax check.
- Ran the full test suite from `tests`.
- Added/verified regression coverage for scroll metrics in the debug report.
- Verified Powered By does not render Torn through existing render-state coverage.
- Verified BYOK quota display states through existing quota coverage: no quota yet, provider headers present, headers missing after use, local 24-hour fallback, and out-of-token state.

Verified:

- `node --check ../Torn_Bookie_Live_Scores.js` passed.
- `npm.cmd test` from `tests` passed: `254/254`.
- Browser smoke was attempted through the in-app browser connector and local Chrome/Edge headless runs, but this environment would not expose a usable browser session/output. The same scroll/settings/source/quota invariants are covered by the passing headless regression tests.

Summary:

- Step 7 verification is complete except for visual browser confirmation, which was blocked by browser tooling in this environment and documented above.

### Step 8 - Post-Step-5 Follow-Up Corrections

Latest source attachment:

`C:\Users\jm3ak\.codex\attachments\93b04940-7123-40ff-a2eb-1e62cd02b942\pasted-text.txt`

Generated at: `2026-06-24T14:41:34.653Z`

Important confirmation from the new capture:

- Step 4 changes are active: tennis provider priority is now `SofaScore -> ESPN`, and LiveScore/TheScore/BBC tennis 404 retries are gone.
- Step 5 changes are active: Tanzania Premier League rows no longer route to ESPN `soccer_eng_pl`; their provider priority is now `SofaScore -> API-Football -> BBC Sport`.
- The remaining football misses are no longer caused by the original ESPN English Premier League false mapping.

New findings:

- Tennis miss: `Paul Jubb v Tomas Barrios` has a real SofaScore top candidate, `Paul Jubb v Tom\u00e1s Barrios Vera`, but confidence is only `47`. This points to player-name normalization, not provider coverage.
- The current `normalizeName()` diacritic-stripping regex appears mojibaked in source and should be replaced with a literal Unicode combining-mark range, for example `/[\u0300-\u036f]/g`, after `normalize('NFD')`.
- Tennis player matching should allow safe extra trailing surname tokens for individual sports when the shorter normalized player name appears as a contiguous token sequence inside the longer provider name. Example: `tomas barrios` should confidently match `tomas barrios vera`.
- Football miss: SofaScore and BBC Sport return events, but the top candidates are unrelated international fixtures (`Czechia v Mexico`, `Panama v Croatia`) at confidence `0`. That indicates those free boards do not cover the Tanzania Premier League rows in this capture.
- API-Football is still not providing useful results, but the latest report shows no `v3.football.api-sports.io` host entry, empty `apiSportsQuota`, empty `byokQuota`, and empty `byokLocalUsage24h`. That means no real API-Football network request was recorded in this capture, despite the row detail saying `API-Football: parser failed`.
- The API-Football path has a likely diagnostic bug: the API error branch references `parserDiagnostic` before it is initialized. If the provider returns an `errors` object, this can convert a normal API/quota error into an unhelpful parser failure.
- API-Football manual/cache-only skips are currently summarized too generically as `parser failed`. That hides the difference between "manual mode skipped the request", "provider returned an API error", "provider returned no fixtures", and "parser shape drift".

Repair direction:

1. Fix `normalizeName()` diacritic stripping so accented provider names normalize correctly.
2. Add individual-sport player-name containment scoring for tennis, with regression coverage for `Tomas Barrios` vs `Tom\u00e1s Barrios Vera`.
3. Initialize API-Football parser diagnostics before the API error branch and include those diagnostics whenever API-Football returns provider errors.
4. Split API-Football failure summaries into distinct messages:
   - manual mode/cache-only skip with no cached board,
   - provider API/quota error,
   - empty provider response,
   - parser shape failure.
5. In debug reports, include whether API-Football was actually requested on the network for each queried date and whether manual BYOK mode suppressed the request.
6. For Tanzania Premier League football, verify API-Football with a manual refresh using the BYOK key. The free SofaScore/BBC boards in this capture appear to lack the needed league coverage.
7. If API-Football returns the Tanzania fixtures only when league/season parameters are supplied, add a league mapping for `Premier League 2025/2026(Tanzania 1)` to the API-Football Tanzania Premier League ID instead of relying only on the all-fixtures date endpoint.

Regression tests to add:

1. `normalizeName('Tom\u00e1s Barrios Vera')` should preserve `tomas barrios vera` without splitting the accented character into `toma s`.
2. Tennis matching should accept `Paul Jubb v Tomas Barrios` against `Paul Jubb v Tom\u00e1s Barrios Vera`.
3. API-Football provider-error responses should not throw or collapse into generic parser failure.
4. API-Football manual-mode cache skips should report `manual mode` or `not requested` rather than `parser failed`.
5. A football debug fixture with no API-Football network request should expose that absence explicitly in diagnostics.

Completed:

- Added a correct Unicode combining-mark normalization pass so accented provider names like `Tom\u00e1s Barrios Vera` normalize to `tomas barrios vera`.
- Added tennis-specific player-name scoring for safe extra trailing surname tokens, allowing `Tomas Barrios` to match `Tom\u00e1s Barrios Vera` without loosening club/team containment rules.
- API-Football/API-Sports manual cache-only skips now carry diagnostics showing `networkRequested: false`, `manualSuppressed: true`, and the skip reason.
- API-Football provider API/quota errors, empty provider responses, and response-shape failures now produce distinct summaries instead of collapsing into generic `parser failed`.
- API-Football parser diagnostics now include provider date, network-request status, cache-hit status, manual-suppression status, and skip reason without raw provider response bodies.

Verified:

- `node --check Torn_Bookie_Live_Scores.js` passed.
- `node --test tests/matching.test.js tests/apifootball.test.js` passed: `44/44`.
- `npm.cmd test` from `tests` passed: `258/258`.

Summary:

- Step 8 is complete. The next debug report should distinguish API-Football no-network/manual-skip cases from real provider errors or parser drift, and the `Paul Jubb v Tom\u00e1s Barrios Vera` SofaScore candidate should clear tennis matching confidence.

### Step 9 - Tennis Name-Order Follow-Up

Latest source attachment:

`C:\Users\jm3ak\.codex\attachments\53689892-c38d-4623-b2a5-50027cb8973d\pasted-text.txt`

Generated at: `2026-06-24T18:33:26.982Z`

Important confirmation from the new capture:

- The user confirmed the additional tennis matcher change fixed the remaining issue.
- SofaScore tennis score boards are reachable and resolving live tennis rows again. The report shows `score-found` events for `Andrej Nedic v Sebastian Gima`, `Bianca Andreescu v Jil Teichmann`, `Ashlyn Krueger v Mai Hontama`, and other tennis rows through SofaScore.
- The active details match `Bianca Andreescu v Jil Teichmann` is resolved via SofaScore with score `1-1` and detail `3rd set`.
- The only repeated SofaScore errors visible in this capture are `/h2h/events` 404s from details enrichment. These are not main score lookup failures.
- The report no longer shows the earlier `Soon-Woo Kwon v Arthur Gea` unmatched score failure. That is consistent with the tennis name-order fix.

New finding:

- Step 8 fixed accented trailing-surname variants such as `Tomas Barrios` vs `Tom\u00e1s Barrios Vera`, but the next miss was a different tennis naming pattern: provider family-name-first and collapsed hyphen spacing, for example Torn `Soon-Woo Kwon` vs provider `Kwon Soonwoo` / `Kwon Soon-woo`.

Completed:

- Removed the duplicate mojibaked diacritic-stripping regex from `normalizeName()`, leaving the explicit Unicode combining-mark range after `normalize('NFD')`.
- Extended tennis-only individual-name matching to accept provider family-name-first order.
- Extended tennis-only individual-name matching to accept adjacent-token collapse from hyphen spacing differences, such as `Soon Woo` vs `Soonwoo`.
- Kept the broader club/team matcher unchanged so football/baseball/etc. containment remains conservative.
- Added regression coverage for `Soon-Woo Kwon v Arthur Gea` matching provider `Kwon Soonwoo v Arthur Gea` with no Torn start timestamp, matching the debug-log live-recovery path.

Verified:

- `node --check Torn_Bookie_Live_Scores.js` passed.
- `node --test tests\matching.test.js` passed: `27/27`.
- `npm.cmd test` from `tests` passed: `259/259`.

Summary:

- Step 9 is complete. Tennis matching now covers the observed provider name variants: accented trailing surnames, family-name-first ordering, and collapsed hyphen/given-name spacing, while keeping non-tennis team matching strict.

### Step 10 - Tennis Provider Endpoint/Parser Follow-Up

Latest source attachment:

`C:\Users\jm3ak\.codex\attachments\222493b8-2195-4c3d-8d31-9b2facada0a9\pasted-text.txt`

Generated at: `2026-06-25T11:56:53.807Z`

Baseline verification before changes:

- `npm.cmd run test:syntax` from `tests` passed.
- `npm.cmd test` from `tests` passed: `260/260`.

Important confirmation from the new capture:

- The panel now has 15 rows: 7 live tennis, 5 upcoming tennis, 1 upcoming football, 1 upcoming League of Legends, and 1 upcoming baseball.
- All 7 live tennis rows are unmatched with the same provider detail:
  `SofaScore: fetch error for 2026-06-25, 2026-06-24, 2026-06-26 [HTTP 404] | ESPN: no events for 20260625, 20260624, 20260626`.
- Affected live tennis competitions include:
  - `Mallorca Championships 2026(ATP)`
  - `Plovdiv 2026(Challenger)`
  - `Bad Homburg Open 2026(WTA)`
  - `Lexus Eastbourne Open 2026(WTA)`
  - `Lexus Eastbourne Open 2026(ATP)`
  - `Wimbledon, Qualification ATP 2026(Grand Slam)`
- SofaScore made 3 network requests and all returned HTTP `404` from:
  `/api/v1/sport/tennis/scheduled-events/YYYY-MM-DD`
- ESPN made 15 tennis scoreboard requests and all returned HTTP `200`; each recent response was about `1.43 MB`.
- ESPN requests are being coalesced correctly by cache key, so the request fan-out is not the immediate issue.
- No resolved events were recorded for the tennis rows in this capture.
- There is no active details match in this capture, so the failure is visible directly in the live-row score path rather than only details enrichment.

New finding:

- This is no longer a tennis name-matching problem. Step 8 and Step 9 addressed the observed provider-name variants, but this capture fails before any SofaScore candidates can be scored.
- The SofaScore tennis scheduled-events endpoint appears broken or no longer valid for tennis on these dates. Because the response is HTTP `404`, this is not a token-refresh problem.
- ESPN is reachable and returning large successful JSON bodies, but `_findEspnTennis()` still reports `no events`. That points to one of two likely issues:
  1. the current hard-coded `TENNIS_LEAGUE_IDS` list does not include the relevant current tournament/event IDs, or
  2. ESPN is returning useful data in a shape other than the currently parsed `board.events` container.
- The current ESPN tennis path remains too brittle because it only probes five tournament IDs: Wimbledon, Eastbourne, Mallorca, Bad Homburg, and Berlin. Plovdiv and Targu Mures challenger rows are still outside verified ESPN coverage.

Repair direction:

1. Re-probe SofaScore tennis endpoints and identify the current public tennis schedule path, if one still exists. Do not route HTTP `404` through the token-refresh flow.
2. Add a tennis-specific SofaScore endpoint fallback only after the replacement path is verified with a real response body.
3. Capture a sanitized ESPN tennis response shape for `2026-06-25` and inspect top-level containers, because the current `board.events` parser may be missing events in a changed shape.
4. Add ESPN tennis parser diagnostics when a `200 OK` response has no parsed events, including sanitized top-level keys and candidate container counts without raw provider responses.
5. Re-check ESPN tennis IDs for the observed competitions, especially:
   - Plovdiv Challenger
   - Targu Mures Challenger
   - Wimbledon qualifying ATP
   - Eastbourne ATP/WTA
   - Mallorca ATP
   - Bad Homburg WTA
6. Update `TENNIS_LEAGUE_IDS` only with verified IDs that return useful events through the current ESPN endpoint contract.
7. If ESPN's date-only tennis board contains all events without per-tournament filtering, prefer that simpler query path or add it as a fallback after the current per-ID requests miss.
8. Keep request coalescing and cache behavior intact; the capture shows that part is working.
9. Keep tennis name-normalization changes from Steps 8 and 9 unchanged unless new candidate diagnostics prove another matching issue after endpoint/parser repair.

Regression tests to add:

1. SofaScore tennis HTTP `404` should summarize as endpoint fetch failure and should not queue token refresh.
2. `_findEspnTennis()` should parse the newly captured ESPN tennis response shape when events are not under top-level `events`.
3. `_findEspnTennis()` should report parser diagnostics for `200 OK` responses with no parsed events.
4. ESPN tennis should resolve fixture coverage for at least one observed ATP/WTA row from this capture, for example `Naomi Osaka v Ekaterina Alexandrova` or `Luciano Darderi v Nuno Borges`, using a saved fixture.
5. ESPN tennis should preserve graceful failure for uncovered challenger rows until a verified ID or fallback path is added.

Follow-up source attachment:

`C:\Users\jm3ak\.codex\attachments\e9355352-57c1-404e-b1d8-08c5332b52a1\pasted-text.txt`

Generated at: `2026-06-25T12:13:16.946Z`

Additional confirmation from the follow-up capture:

- The panel has 14 rows: 7 live tennis, 4 upcoming tennis, 1 upcoming football, 1 upcoming League of Legends, and 1 upcoming baseball.
- The same 7 live tennis rows are unmatched with the same combined detail:
  `SofaScore: fetch error for 2026-06-25, 2026-06-24, 2026-06-26 [HTTP 404] | ESPN: no events for 20260625, 20260624, 20260626`.
- SofaScore shows `errCount: 6` and no successful tennis board requests.
- ESPN shows `okCount: 15`, and the provider cache has successful tennis entries for all 5 seeded IDs across the 3-date live lookup window.
- ESPN cache hits in this capture confirm the problem is not request coalescing or cache leakage; the cached JSON was being parsed incorrectly.

Live endpoint probe results:

- ESPN date-only tennis board for `20260625` returned HTTP `200`, about `1.43 MB`, with top-level keys `leagues`, `events`, and `provider`.
- The top-level ESPN `events` are tournament containers, not match events:
  - `Lexus Eastbourne Open`
  - `Bad Homburg Open powered by Solarwatt`
  - `Vanda Pharmaceuticals Mallorca Championships`
  - `Wimbledon`
- The actual match rows are under `events[].groupings[].competitions[]`.
- The date-only ESPN board contained current rows matching observed Torn games, including:
  - `Nuno Borges v Luciano Darderi`
  - `Madison Keys v McCartney Kessler`
  - `Zizou Bergs v Jan Choinski`
  - `Dusan Lajovic v Vilius Gaubas`
  - `Kyrian Jacquet v Timofey Skatov`
  - `Rei Sakamoto v Jaime Faria`
  - `Ekaterina Alexandrova v Naomi Osaka`
- ESPN per-ID URLs returned the same useful tournament-container shape, so the date-only board is enough for covered ATP/WTA/Grand Slam rows and avoids duplicated large requests.
- A direct non-browser SofaScore probe returned HTTP `403`, while the in-browser debug reports HTTP `404`. Either way, this is not a reason to refresh the token unless the status is auth/challenge-like.

Completed:

- Added ESPN tennis parsing for the current grouped tournament shape: `events[].groupings[].competitions[]`.
- Preserved the older flat ESPN tennis shape where top-level `events[]` are direct match events.
- Changed `_findEspnTennis()` to try the ESPN date-only board first and only fall back to per-tournament `leagueId/eventId` requests when the date-only board is unavailable or has no parseable match competitions.
- Added sanitized ESPN tennis parser diagnostics for `200 OK` responses that have tournament containers but no parsed match competitions.
- Narrowed SofaScore token-rejection detection so HTTP `404` endpoint failures do not queue a background token-refresh tab.
- Left `TENNIS_LEAGUE_IDS` unchanged because the date-only ESPN board now covers the observed Eastbourne, Bad Homburg, Mallorca, and Wimbledon qualifying rows. Plovdiv/Targu Mures Challenger rows remain outside verified ESPN coverage until a provider source or ID is found.

Regression tests added:

- `_findEspnTennis: extracts matches from current grouped tournament shape`
- `_findEspnTennis: date-only grouped board resolves without per-tournament fan-out`
- `_findEspnTennis: records diagnostics when 200 response has tournament containers but no match competitions`
- `SofaScore 404 reports endpoint failure without token refresh`

Verified:

- `node --check ..\Torn_Bookie_Live_Scores.js` passed from `tests`.
- `node --test providers.test.js sofascore.test.js` passed: `38/38`.
- `npm.cmd run test:syntax` from `tests` passed.
- `npm.cmd test` from `tests` passed: `264/264`.

Summary:

- Step 10 is complete for the ESPN-covered rows. The next debug report should show ESPN resolving the covered live tennis rows from Eastbourne, Bad Homburg, Mallorca, and Wimbledon qualifying even when SofaScore tennis schedule requests fail. Challenger rows such as Plovdiv and Targu Mures may still need a separate verified provider path or tournament ID.

### Step 11 - Live Tennis Challenger Fallback

Latest source attachment:

`C:\Users\jm3ak\.codex\attachments\6c9b0394-07f3-4e20-96d6-fae092bf82b3\pasted-text.txt`

Generated at: `2026-06-25T12:37:43.935Z`

New debug confirmation:

- Step 10 resolved the ESPN-covered live tennis rows:
  - Mallorca ATP
  - Eastbourne ATP/WTA
  - Bad Homburg WTA
  - Wimbledon qualifying ATP
- Only two live tennis rows remained unmatched:
  - `Sandro Kopp v Dali Blanch` from `Plovdiv 2026(Challenger)`
  - `Andrej Nedic v Max Alcala Gurri` from `Targu Mures 2026(Challenger)`
- ESPN date-only tennis boards were healthy (`HTTP 200`) but did not include these Challenger tournaments.
- SofaScore date schedule requests still returned `HTTP 404` for tennis:
  `/api/v1/sport/tennis/scheduled-events/YYYY-MM-DD`
- Browser-side probing showed SofaScore's live tennis endpoint returns live tennis events, including Challenger tournament coverage:
  `/api/v1/sport/tennis/events/live`
- Plain PowerShell requests to SofaScore returned `HTTP 403`, matching SofaScore's browser/WAF behavior and confirming that tests should use the existing userscript GM header path rather than direct shell probes.

Completed:

- Added a tennis-only live SofaScore lookup step before the date schedule plan:
  `/api/v1/sport/tennis/events/live`
- Kept non-live tennis on the existing date schedule endpoint, so upcoming/date behavior is unchanged.
- Kept ESPN tennis behavior unchanged; the new fallback only affects the SofaScore provider path for live tennis rows.
- Added SofaScore tennis score formatting from `period1` through `period5`, including tiebreak values when present, so Challenger fallback rows show set-by-set scores instead of only set counts.

Regression tests added:

- `SofaScore live tennis uses events/live before the date schedule endpoint`
- `SofaScore non-live tennis keeps the date schedule endpoint`

Verified:

- `npm.cmd run test:syntax` from `tests` passed.
- `node --test sofascore.test.js providers.test.js` from `tests` passed: `40/40`.
- `node --test matching.test.js` from `tests` passed: `27/27`.
- `npm.cmd test` from `tests` passed: `266/266`.

Summary:

- Step 11 completes the remaining live tennis Challenger fallback without touching the working ESPN date-board parser. The two rows that were missing only because ESPN lacked Challenger coverage should now try SofaScore's live tennis feed first and render set-by-set scores when SofaScore has the event.

### Step 12 - Post-Fix Debug Confirmation And Guardrails

Latest source attachment:

`C:\Users\jm3ak\.codex\attachments\ee86b752-a4f0-4d6d-b389-d3357ed18114\pasted-text.txt`

Generated at: `2026-06-25T12:49:38.772Z`

Confirmation:

- The live tennis fix is active and working.
- Panel state showed `liveCount: 10` and `upcomingCount: 4`.
- All 10 live tennis rows resolved from SofaScore.
- The previous problem rows resolved:
  - `Sandro Kopp v Dali Blanch` via SofaScore, score `6 3` to `3 1`, detail `2nd set`.
  - `Andrej Nedic v Max Alcala Gurri` via SofaScore, score `0` to `0`, detail `1st set`.
- The remaining `score.found: false` rows were all upcoming/not-started rows, not live score failures:
  - `Hugo Gaston v Moez Echargui`
  - `Grobina v Auda`
  - `T1 v Team Liquid`
  - `Atlanta Braves v San Francisco Giants`

Network/cache evidence:

- Only one actual provider request was made for the live tennis score refresh:
  `/api/v1/sport/tennis/events/live`
- `www.sofascore.com` returned `HTTP 200`.
- Response size was about `402493` bytes.
- Nine concurrent live tennis lookups coalesced onto the same in-flight request.
- Provider cache contained only `sofascore:tennis:live` for this refresh, with `hasError: false`.
- No ESPN tennis request was needed for these live rows because the SofaScore live board resolved first.

Durable framework decision:

- Live tennis intentionally starts with SofaScore, not ESPN.
- Reason: SofaScore's live tennis board covers Challenger rows that ESPN's tennis date board did not cover in the 2026-06-25 reports.
- ESPN remains a fallback for covered ATP/WTA/Grand Slam rows and for cases where SofaScore is token-blocked or misses.
- Non-live/upcoming tennis keeps the date-based plan. Do not use the live board for upcoming rows.
- Do not treat SofaScore HTTP `404` as token rejection. `404` means endpoint/path/coverage failure. Token refresh should be reserved for `401`, `403`, `forbidden`, or challenge-like responses.
- Do not remove the ESPN tennis grouped-date parser. It is still required for ESPN-covered rows and for fallback when SofaScore does not resolve.
- Do not re-enable LiveScore/TheScore/BBC tennis without fresh probes and parser tests; those endpoints repeatedly returned 404 in the prior reports.
- Keep these tests as regression blockers:
  - `SofaScore live tennis uses events/live before the date schedule endpoint`
  - `SofaScore non-live tennis keeps the date schedule endpoint`
  - `SofaScore 404 reports endpoint failure without token refresh`
  - `_findEspnTennis: extracts matches from current grouped tournament shape`
  - `_findEspnTennis: date-only grouped board resolves without per-tournament fan-out`
  - `_findEspnTennis: records diagnostics when 200 response has tournament containers but no match competitions`

Documentation updated:

- `docs/PROVIDER_NOTES.md` now documents the live-tennis SofaScore endpoint, ESPN tennis fallback/parser shape, 404/token-refresh distinction, and regression guardrails.
- `docs/ARCHITECTURE.md` now documents the effective live-tennis provider ladder and warns not to collapse tennis back to generic ESPN-primary routing.
- `docs/TROUBLESHOOTING.md` now documents the expected healthy live-tennis debug signals and the 404/token distinction.
- `CHANGELOG.md` now includes the v2.5.8 tennis provider/parser fixes.

Remaining note:

- The debug report still reports script version `2.5.7` even though the active source metadata is `2.5.8`. The runtime behavior proves the fix is installed, but the installed userscript metadata should be refreshed/bumped before release so future debug reports align with the source version.
