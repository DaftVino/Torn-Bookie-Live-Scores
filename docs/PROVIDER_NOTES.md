# Provider Notes

Last reviewed: 2026-06-25
Userscript version reviewed: `2.5.8`

These notes preserve the current provider contracts and the still-useful findings from the local research docs. Prefer updating this file when endpoint or parser behavior changes, rather than keeping raw HARs or dated audit plans in the public repo.

## Provider Order

The raw score priority array in `PROVIDER_PRIORITY.score` is:

```text
PandaScore -> ESPN -> ESPNcricinfo -> SofaScore -> API-Football -> API-Sports -> LiveScore -> TheScore -> BBC Sport
```

Do not read that as "PandaScore is first for every sport." The effective ladder is filtered by `getProviderPriority()`:

- provider toggle must be enabled,
- the provider must support the match's sport,
- API-Sports/API-Football require the shared API-Sports key,
- PandaScore only supports mapped esports and still requires a token in `_findPandaScore`,
- a match's `sourceKey` can be promoted when it is present and supported.

Representative effective ladders with an API-Sports key configured:

```text
Live tennis: SofaScore live board -> ESPN tennis date board
Live football: SofaScore live board -> ESPN soccer date board (if primary) -> SofaScore date board -> API-Football
World Cup / mapped ESPN soccer: ESPN -> SofaScore -> API-Football
Unmapped soccer: SofaScore -> API-Football
Rugby union: SofaScore -> API-Sports -> LiveScore
AFL: ESPN -> SofaScore -> API-Sports -> LiveScore
Cricket: ESPNcricinfo -> LiveScore
Mapped esports: PandaScore, only when enabled and token-configured
```

Design rule: use ESPN first where a public endpoint and response shape are verified; use SofaScore as the free no-key/token-backed fallback; use BYOK API-Sports/API-Football late to avoid spending quota when a free source can resolve the match.

## ESPN

Standard ESPN scoreboards use:

```text
https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
```

Most team-sport boards expose:

```text
events[].competitions[0].competitors[]
competitor.homeAway
competitor.score
competitor.team.{name,displayName,shortDisplayName,abbreviation}
competitions[0].status.type.{state,description,detail,shortDetail}
```

Current verified mappings include MLB, FIFA World/Club World Cup, selected soccer leagues, AHL/NHL, NBA/WNBA, NFL/CFL, NRL, AFL, and tennis through a dedicated parser.

### Tennis

Do not use `sports/tennis/{league}/scoreboard`; those variants returned 404 during the 2026-06-22 research pass.

The current ESPN tennis implementation must try the date-only `tennis/all` board first:

```text
https://site.api.espn.com/apis/site/v2/sports/tennis/all/scoreboard?dates=YYYYMMDD
```

As of the 2026-06-25 debug cycle, this date-only board returns tournament containers, not direct match rows. The parser must preserve all of these shapes:

```text
events[].groupings[].competitions[].competitors[].athlete.*
events[].competitions[].competitors[].athlete.*
events[].competitors[].athlete.*
```

The grouped shape covered Wimbledon qualifying, Eastbourne, Mallorca, and Bad Homburg in the 2026-06-25 reports. It did not cover Challenger tournaments such as Plovdiv and Targu Mures.

Keep the verified per-tournament endpoint only as a fallback when the date-only board is missing, errored, or has no parseable match competitions:

```text
https://site.api.espn.com/apis/site/v2/sports/tennis/all/scoreboard?leagueId={leagueId}&eventId={leagueId}-{year}&dates=YYYYMMDD
```

Current static tournament IDs:

```text
188 Wimbledon
444 Eastbourne
637 Mallorca
636 Bad Homburg
635 Berlin
```

Tennis events are not standard team boards. Names are under `events[].competitors[].athlete.*`, and set scores are under `competitors[].linescores[].value`.

Do not make ESPN the first effective live-tennis provider unless Challenger coverage is re-verified. Live tennis intentionally tries SofaScore before ESPN because SofaScore's live board covered both ATP/WTA/Grand Slam rows and Challenger rows in the 2026-06-25 debug report.

### Rugby League And AFL

NRL:

```text
https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard?dates=YYYYMMDD
```

AFL:

```text
https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard?dates=YYYYMMDD
```

Both use the standard ESPN team scoreboard shape and should remain ESPN-primary.

### Rugby Union Gap

The ESPN rugby scorepanel URL returned HTTP 200 in prior research, but the JSON body was not captured:

```text
https://site.web.api.espn.com/apis/site/v2/sports/rugby/scorepanel?league=all&region=us&lang=en&contentorigin=espn&limit=200&dates=YYYYMMDD&tz=America%2FNew_York
```

Do not make rugby union ESPN-primary until a real response body is saved and mapped. Keep Torn `rugby` on API-Sports/SofaScore fallback behavior for now.

## ESPNcricinfo

Cricket uses ESPNcricinfo, not standard ESPN scoreboards.

Verified list endpoints:

```text
https://hs-consumer-api.espncricinfo.com/v1/pages/matches/live?lang=en
https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en&latest=true
https://hs-consumer-api.espncricinfo.com/v1/pages/matches/scheduled?lang=en&filterType=DATE&filterValue=DD-MM-YYYY
https://hs-consumer-api.espncricinfo.com/v1/pages/matches/result?lang=en&filterType=DATE&filterValue=DD-MM-YYYY
```

Detail endpoints worth preserving for future work:

```text
https://hs-consumer-api.espncricinfo.com/v1/pages/match/home?lang=en&seriesId=<id>&matchId=<id>
https://hs-consumer-api.espncricinfo.com/v1/pages/match/scorecard?lang=en&seriesId=<id>&matchId=<id>
```

Cricket scores can be multi-innings strings such as `158`, `162/2`, `17.4/20 ov`, or `358 & 76/2`. Preserve them as strings; do not force them into simple integer home/away score fields.

## SofaScore

Current date-board host:

```text
https://www.sofascore.com/api/v1/sport/{slug}/scheduled-events/{YYYY-MM-DD}
```

Important live-sport exception:

```text
https://www.sofascore.com/api/v1/sport/tennis/events/live
https://www.sofascore.com/api/v1/sport/football/events/live
```

Live tennis and live football must use the live board before the date-board plan. The date-board tennis endpoint returned HTTP 404 in the 2026-06-25 reports, while the live board returned HTTP 200 and resolved all 10 live tennis rows, including Plovdiv and Targu Mures Challenger matches. Similarly, live football matches are available on the live board endpoint when date-board scheduled-events endpoints return 404. Non-live/upcoming tennis and football continue to use the date-board plan.

SofaScore is still wired in the current code. It is a free provider, but it is token-sensitive: requests require an `x-requested-with` token. The script stores the latest captured token, uses it in score/H2H requests, and can refresh it through a background SofaScore tab after a token rejection.

Prior 403 failures were not treated as a reason to remove SofaScore. The current implementation uses the `www.sofascore.com` API host, sends browser-origin headers plus `x-requested-with`, and queues token refresh when a 403 or empty board suggests token rejection.

Do not treat HTTP 404 from a SofaScore endpoint as token rejection. It is an endpoint/path failure and must not queue the token refresh tab. Token refresh is reserved for 401/403, forbidden, or challenge-like failures.

Known response shape:

```text
event.id
event.slug
event.startTimestamp
event.status.{code,type,description}
event.homeTeam / event.awayTeam
event.homeScore / event.awayScore
```

For tennis, per-set scores are in `period1`, `period2`, and similar fields; `current` indicates sets won.

For tennis display, prefer set-by-set period fields (`period1` through `period5`) and include tiebreak fields when present (`period1TieBreak`, etc.). Fall back to `current` or `display` only when period values are absent.

Regression guardrails:

- keep `SofaScore live tennis uses events/live before the date schedule endpoint`,
- keep `SofaScore non-live tennis keeps the date schedule endpoint`,
- keep `SofaScore live football uses events/live before the date schedule endpoint`,
- keep `SofaScore non-live football keeps the date schedule endpoint`,
- keep `SofaScore 404 reports endpoint failure without token refresh`,
- keep ESPN tennis grouped/date-only parser tests.

## API-Sports And API-Football

One API-Sports key powers both:

- API-Football for soccer.
- API-Sports rugby/AFL for rugby, rugby league fallback, and AFL fallback.

Soccer:

```text
https://v3.football.api-sports.io/fixtures?date=YYYY-MM-DD
header: x-apisports-key
```

Rugby:

```text
https://v1.rugby.api-sports.io/games?date=YYYY-MM-DD
header: x-apisports-key
```

AFL:

```text
https://v1.afl.api-sports.io/games?date=YYYY-MM-DD
header: x-apisports-key
```

Free-tier notes from prior probes:

- each sport API has its own daily quota,
- daily remaining is reported through `x-ratelimit-requests-remaining`,
- per-minute remaining is reported through `x-ratelimit-remaining`,
- manual-only mode is the default to avoid unexpected quota use.

Response envelopes must check `errors` before mapping `response[]`.

## LiveScore And TheScore

These providers remain useful only for currently mapped slugs. Do not re-enable removed soccer/basketball slugs without a fresh probe and parser test.

Known removed cases from the 2026-06 provider-failure pass:

- LiveScore soccer and basketball date endpoints returned 404.
- TheScore soccer and basketball endpoints returned 404.
- LiveScore MLB/baseball and American football were also excluded due endpoint failures.
- TheScore baseball was excluded due endpoint failures.

## BBC Sport

BBC Sport score pages are fetched as normal HTML from:

```text
https://www.bbc.com/sport/{sport}/scores-fixtures/{YYYY-MM-DD}
```

Do not add `X-Requested-With`; prior testing showed it can trigger a response path without the expected fixture data. The current parser supports BBC's visible fixture markup and keeps BBC disabled by default.

If BBC parsing fails again, inspect the actual returned HTML in a sanitized sample. Do not assume `__NEXT_DATA__` is still present.

## PandaScore

PandaScore is BYOK and disabled by default. It covers:

```text
counter-strike -> csgo
league-of-legends -> lol
dota-2 -> dota2
valorant -> valorant
```

The token is sent only as an authorization header to `api.pandascore.co` and is redacted from debug reports.

## The Odds API

The Odds API is enrichment-only and disabled by default. It is used from the details pane, not from the automatic score refresh loop.

Current regions:

```text
us, us2, uk, eu, au
```

Current markets:

```text
h2h
h2h, spreads, totals
```

The odds cache is local and size-capped. Do not add historical endpoints, saved odds snapshots, or line-movement tracking without a separate feature design and privacy review.

## Matching Notes

Torn names are the user's source of truth, but provider names often differ. Preserve these matching rules:

- Secondary, reserve, youth, and gender qualifiers can be real identity and should not be globally stripped.
- Short tokens can be legitimate team identity or common club designators.
- Penalize known secondary-side qualifiers only when they appear as qualifiers on an otherwise matching club identity.
- Do not treat every one- or two-character token as noise.

Examples of important short tokens or designators include `AIK`, `RFS`, `TPS`, `VPS`, `HJK`, `SJK`, `GAIS`, `UCD`, `FC`, `SC`, `CF`, `AC`, `CD`, `IF`, `BK`, `FF`, and similar club suffixes.

## Remaining Provider Data Gaps

- Save one ESPN rugby union scorepanel JSON body before implementing rugby union ESPN primary.
- Add more soccer league mappings only from observed Torn competition names and verified ESPN slugs.
- Save one ESPNcricinfo `match/home` and one `match/scorecard` JSON for richer cricket details.
- Re-probe LiveScore/TheScore before re-enabling any removed slugs.
- Keep raw HAR files local-only; summarize durable endpoint facts here.
