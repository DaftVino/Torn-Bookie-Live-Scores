# Torn Bookie Live Scores

A Tampermonkey userscript that adds a configurable live scores panel to Torn Bookie. It shows live and upcoming bets grouped by sport, pulls public score data from supported providers, and includes optional BYOK odds and esports integrations.

## Features

- Live and upcoming bet panel for Torn Bookie
- Score lookups from ESPN, SofaScore, LiveScore, TheScore, BBC Sport, and NHL public APIs
- Optional BYOK integrations for The Odds API and PandaScore
- Details pane with team snapshots, odds analysis, expected outcome, and commentary
- Provider toggles, themes, copy tools, debug report, and local caching

## Install

1. Install Tampermonkey or a compatible userscript manager.
2. Open `Live_Scores_Panel.js`.
3. Copy the script into a new userscript, or install it from a hosted raw script URL.
4. Visit Torn Bookie at:

```text
https://www.torn.com/page.php?sid=bookie
```

## Privacy

This script does not send Torn account data, usernames, bet amounts, bet selections, or personal information to score providers.

It may contact external public sports data providers only when the panel is active and matching bets are present. BYOK providers are contacted only when enabled and configured by the user.

## Optional API Keys

The script can work without API keys.

Optional integrations:

- The Odds API: enables Odds Analysis
- PandaScore: enables supported esports score lookups

Keys are stored locally by your userscript manager and are not included in debug reports.

## Disclaimer

This project is not affiliated with Torn, Torn City, or any score provider.

## License

MIT License. See `LICENSE`.
