# Troubleshooting

Last reviewed: 2026-06-25
Userscript version reviewed: `2.5.8`

## First Checks

1. Confirm the userscript is enabled in Tampermonkey.
2. Open Torn Bookie at `https://www.torn.com/page.php?sid=bookie`.
3. Select the Torn Bookie `YOUR BETS` view so the page loads the data the script captures.
4. If the panel says it is waiting for data, refresh the Bookie page.
5. Open Settings and confirm the sport and provider you expect are enabled.

Torn PDA is not supported.

## Copy A Debug Report

Turn on Settings -> Debug mode, then use the panel's debug report copy action.

The report is intended for issue triage. It includes settings, provider outcomes, cache summaries, network host status, and sanitized match summaries.

It should not include:

- Torn account data,
- raw Torn API responses,
- bet amounts,
- bet selections,
- API keys,
- bearer tokens,
- cookies,
- raw provider responses.

Still review the report before posting it publicly.

## Common Symptoms

### Panel waits for Torn data

The userscript only reads Torn Bookie data from the page's own `sid=bookieApi` response. It does not call a Torn API key.

Try:

- switch to `YOUR BETS`,
- refresh the page,
- confirm Tampermonkey is running the script on the Torn Bookie URL,
- check whether another extension/userscript is blocking page requests.

### No score for a live match

Possible causes:

- the sport is disabled in Settings,
- all providers for that sport are disabled,
- the match's provider league is not mapped,
- provider data exists but team names do not match confidently,
- provider endpoints are down or changed shape,
- API-Sports manual-only mode has no cached board yet.

Enable debug mode and inspect `providersTried`, `providerErrors`, and the `network` section of the debug report.

For live tennis specifically, a healthy report should usually show one successful `www.sofascore.com` request to:

```text
/api/v1/sport/tennis/events/live
```

Multiple live tennis rows should coalesce onto the same cache key, `sofascore:tennis:live`. If live tennis falls back to ESPN only, check whether SofaScore returned 401/403/token errors, not just a 404 from the date schedule path.

### API-Sports or API-Football does not fetch

API-Sports is BYOK and manual-only by default.

Check:

- Settings -> Score Sources -> API-Sports is enabled.
- The API-Sports key is saved and masked in the key section.
- The API-Sports mode is `Auto` if you want automatic quota use.
- In `Manual-only`, click `Refresh now` to spend quota and refresh boards.
- The debug report shows `apiSportsQuota` after a successful keyed response.

Manual-only mode is intentional for free-tier quota. Auto-refreshes serve cached boards only.

### SofaScore shows 403 or token rejected

The script normally recovers by opening a background SofaScore token-refresh tab after a token rejection. That tab closes only after it captures a fresh token from the current page session.

If it still fails:

- open `https://www.sofascore.com` manually in the same browser profile,
- let the page finish loading,
- return to Torn Bookie and click `Refresh now`,
- copy a debug report if failures continue.

The debug report includes SofaScore token age and whether a refresh was queued. It does not include the token value.

Do not treat a SofaScore HTTP 404 as a token problem. For tennis, the date schedule path can return 404 while the live tennis endpoint works. A token refresh is expected only for 401/403, forbidden, or challenge-like responses.

### BBC Sport parser failed

BBC is disabled by default and uses public HTML pages. If the parser fails, the page markup likely changed or BBC served a consent/minimal response.

Useful report details:

- HTTP status for `www.bbc.com`,
- content type,
- provider parse failure text,
- whether other providers resolved the match.

Do not share raw BBC HTML unless it has been sanitized.

### LiveScore or TheScore does not cover a sport

Some slugs are intentionally removed because they returned 404 in provider testing. In particular, do not expect current LiveScore/TheScore soccer or basketball coverage unless those endpoints are re-verified and remapped.

### Details pane is sparse

The details pane is progressive and provider-dependent. It may show less for upcoming games, unsupported leagues, missing odds keys, or provider failures.

For odds analysis:

- enable The Odds API,
- save an Odds API key,
- choose a region,
- open a supported event in the details pane,
- use the odds pull action.

The Odds API is not called automatically on every refresh.

## API Key Storage

Keys are stored locally by the userscript manager or local browser storage:

- The Odds API key: `GM_*` storage.
- PandaScore token: `GM_*` storage.
- API-Sports key: `GM_*` storage.
- SofaScore `x-requested-with` token: `GM_*` storage.
- UI settings and odds-analysis cache: `localStorage`.

Do not enable BYOK providers on shared browser profiles unless you are comfortable storing keys there.

## Bug Report Checklist

Include:

- userscript version,
- browser and userscript manager,
- sport and match name,
- whether the match is live or upcoming,
- enabled providers,
- whether relevant keys are configured,
- copied debug report with debug mode enabled,
- steps you took, such as `Refresh now` or opening the details pane.

Avoid including:

- screenshots showing private Torn account information,
- raw HAR files,
- API keys or tokens,
- full raw provider responses,
- local machine paths.

## Maintainer Verification

Before release after provider, matching, cache, or network changes:

```powershell
node --check Torn_Bookie_Live_Scores.js
Set-Location tests
node --test *.test.js
```

Manual smoke test on Torn Bookie:

- panel renders after `YOUR BETS` loads,
- live ESPN-covered match resolves,
- live tennis resolves through SofaScore's `/sport/tennis/events/live` path and coalesces repeated tennis rows,
- SofaScore-backed match either resolves or queues token refresh cleanly,
- API-Sports manual-only spends quota only after `Refresh now`,
- debug report has network host status and no secrets,
- browser console has no uncaught errors.
