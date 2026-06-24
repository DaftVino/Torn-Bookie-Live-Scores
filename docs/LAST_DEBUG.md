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

## Refined Step 1: Panel Scrolling

Do not cap the number of matches as a product behavior. The UI should support all rows returned by Torn and expose the full controls through scrolling.

The intended repair is not "show fewer matches." It is to fix the scroll container contract:

1. Keep the fixed panel bounded to the viewport.
2. Make the panel a vertical flex container.
3. Keep the header outside the scrolling area.
4. Make `.tm-bookie-content` the only vertical scroll container.
5. Give `.tm-bookie-content` `flex: 1`, `min-height: 0`, and `overflow-y: auto`.
6. Remove the competing hard-coded content `max-height` that can stop before Settings.
7. Add bottom padding inside the scroll area so the final settings controls are not flush against the viewport edge.

This should let any number of rows scroll to the full UI without a match count limit. A practical visual/regression test should use 25 to 30 rows because that reproduces the bug, but that test size is only a fixture size, not a runtime cap.

If the Torn page itself injects an ancestor or overlay that traps wheel events, add wheel handling only on the panel content to keep scroll deltas inside `.tm-bookie-content`. That is a fallback, not the first fix.

## Logo Findings

Current provider icon coverage from code review:

- Has image icon: ESPN, SofaScore, LiveScore, TheScore, BBC Sport, PandaScore.
- Text fallback today: ESPNcricinfo, API-Sports, API-Football, Torn.

Repair direction:

1. Point `espncricinfo` at the existing ESPN icon.
2. Add API-Sports and API-Football image assets once available.
3. Leave Torn as a text badge unless a local logo asset is intentionally added.

## Other Follow-ups

- Add scroll metrics to debug reports: panel/content dimensions, `scrollTop`, `scrollHeight`, `clientHeight`, and settings offset.
- Add provider candidate diagnostics to debug reports for "events found; no confident team match."
- Keep provider raw responses out of the debug report.
