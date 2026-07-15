# Torn Bookie Live Scores

A userscript that adds a configurable live scores panel to Torn Bookie. It shows live and upcoming bets grouped by sport, pulls public score data from supported providers, and includes optional BYOK odds and esports integrations. Runs under Tampermonkey on desktop and inside Torn PDA on Android.

## What's New in v3.1.0

- **Torn PDA support**: the panel no longer leaks onto other Torn sections showing "Refresh failed". Off the Bookie page the script now does nothing at all — no panel, no network requests, no refresh loop. See [Installing on Torn PDA](#installing-on-torn-pda).
- **Mobile layout**: the panel fills the screen width on phones instead of leaving dead space, tracks the dynamic viewport so it doesn't run off-screen under PDA's app bar, and gives the collapse and refresh controls 44px touch targets.

## What's New in v3.0.0

- **Smarter football matching**: enhanced alias lists and pair-level guardrails prevent false positives (e.g., "Mexico" no longer matches "New Mexico")
- **Improved UI feedback**: themed action notices, consistent button states, and selected-game context in Tools so you know exactly which bet your actions affect
- **Better error handling**: improved request timeouts, provider error gracefully, and cache eviction to prevent memory growth
- **Enhanced tennis coverage**: ESPN date-board parsing and live SofaScore fallback for Challenger matches
- **Stricter provider validation**: SofaScore no longer spams 404s on live football; token refresh reserved for auth failures only

## Features

- Live and upcoming bet panel for Torn Bookie with selected-game context
- Score lookups from ESPN, ESPNcricinfo, SofaScore, LiveScore, TheScore, BBC Sport, API-Sports/API-Football, PandaScore, and NHL public APIs
- Optional BYOK integrations for The Odds API, API-Sports, and PandaScore
- Details pane with team snapshots, odds analysis, expected outcome, and commentary
- Provider toggles, themes, copy tools, debug report, and local caching
- Comprehensive test coverage with 150+ regression tests

## Install

1. Install Tampermonkey or a compatible userscript manager.
2. Open `Torn_Bookie_Live_Scores.js`.
3. Copy the script into a new userscript, or install it from a hosted raw script URL.
4. Visit Torn Bookie at:

```text
https://www.torn.com/page.php?sid=bookie
```

### Installing on Torn PDA

1. In Torn PDA, go to *Settings → Advanced browser settings* and enable **custom user scripts**.
2. Add the script.
3. Set **Injection time** to **Start**.

Injection time **must** be Start. The script captures your bets by intercepting Torn's own network calls at `document-start`; on **End** it loads too late to see them and the panel will sit empty.

Torn PDA does not honour `@match` ([torn-pda#314](https://github.com/Manuito83/torn-pda/issues/314)), so it injects the script on every Torn page regardless of what the metadata block says. That is expected and harmless — as of v3.1.0 the script detects the page itself and does nothing outside Bookie. The panel only appears on the Bookie page; this is intentional, since your bet data is only available there.

## Privacy

This script does not send Torn account data, usernames, bet amounts, bet selections, or personal information to score providers.

It may contact external public sports data providers only when the panel is active and matching bets are present. BYOK providers are contacted only when enabled and configured by the user.

## Optional API Keys

The script can work without API keys.

Optional integrations:

- The Odds API: enables Odds Analysis
- API-Sports: enables quota-aware soccer, rugby, and AFL fallback coverage
- PandaScore: enables supported esports score lookups

Keys are stored locally by your userscript manager and are not included in debug reports.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Provider notes](docs/PROVIDER_NOTES.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Roadmap](docs/ROADMAP.md)

## Disclaimer

This project is not affiliated with Torn, Torn City, or any score provider.

## License

MIT License. See `LICENSE`.
