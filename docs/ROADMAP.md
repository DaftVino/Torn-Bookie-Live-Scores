# Roadmap

Last reviewed: 2026-06-25
Userscript version reviewed: `3.0.0`

This roadmap consolidates accepted future work from the local planning docs. It is not a release promise. Keep implementation plans in issues/branches; keep only durable direction here.

## Completed In v3.1.0

### Torn PDA Compatibility ✓

The script is scoped at runtime instead of relying on `@match`, which PDA does not honour. Off the Bookie page it returns before installing interceptors, listeners, panel, or timers. See [TORN_PDA.md](TORN_PDA.md).

- `isBookiePageContext()` — hostname + `/page.php` + `sid=bookie`, at least as strict as the `@match`
- Panel fills the viewport on phones; `dvh` height; 44px touch targets
- `SCRIPT_VERSION` fallback pinned to `@version` by test (PDA has no `GM_info`)

## Completed In v3.0.0

### Phase 1: Action Feedback Foundation ✓

Themed action notices, consistent button states, and ARIA live regions are now in place.

- `showActionNotice({ type, title, detail, timeoutMs })` with semantic colors
- `toast()` compatibility wrapper maintained
- copy/debug/details button loading/success/error/disabled states
- Accessible with live-region roles

### Phase 2: Selected-Game Context ✓

Users now see exactly which Torn game their Tools actions affect.

- Selected-game summary in Tools
- Clear no-selection state with disabled actions
- Session-only last-copy receipt metadata
- Jump-to-selected-game affordance

### Phase 3: Row And Refresh States ✓

Improved scanability without changing provider behavior.

- Active row and details-owned row visual language
- Confidence/source badges from existing metadata
- Empty/loading/error state indicators
- Non-blocking refresh indicator keeps old data visible
- Collapse-all/expand-all sport groups

## Current Priorities

1. Provider reliability and schema drift.
2. Memory management and cache eviction strategy.
3. Football matching edge cases and validation.
4. Betting-context features that use data already present in the panel.
5. Accessibility and layout robustness without changing the single-file userscript model.

## Provider Follow-Ups

### ESPN Rugby Union

Do not implement ESPN rugby union as primary until a real scorepanel JSON body is captured and mapped. The current endpoint is promising but not body-verified.

Needed artifact:

```text
site.web.api.espn.com rugby scorepanel JSON for a date with rugby union matches
```

### Soccer League Breadth

Add ESPN soccer mappings only from observed Torn competition names and verified ESPN league slugs. API-Football and SofaScore already cover much of the fallback role, so this is incremental rather than urgent.

### Cricket Details

ESPNcricinfo list boards are implemented. Future detail work should use saved `match/home` and `match/scorecard` JSON samples, preserve cricket score strings, and avoid forcing multi-innings data into simple score integers.

### BBC Sport

BBC is useful as a disabled-by-default fallback. If it drifts, inspect sanitized returned HTML and update the parser against current visible markup. Do not assume `__NEXT_DATA__` will exist.

### LiveScore And TheScore

Re-enable removed slugs only after fresh probes and parser tests. Several soccer, basketball, baseball, and American-football endpoints previously returned 404.

## Future UI And Workflow Phases

### Phase 4: Details Pane Hierarchy

Make the details pane easier to scan.

Included:

- sticky header,
- compact score strip,
- clearer sections or collapsible rows,
- skeleton loading,
- Escape close and focus return.

Prefer collapsible sections before introducing tabs.

### Phase 5: Betting Intelligence

Use existing bet and score data to answer practical tracking questions without new provider calls.

Candidate features:

- live bet winning/losing/push indicator for confidently mapped match-winner/draw markets,
- total visible live stake and potential return,
- score-change flash between refreshes,
- notices when games move from upcoming to live or live to final.

Guardrails:

- show an unknown/neutral state for spreads, totals, props, or ambiguous markets,
- no predictive betting advice,
- no historical odds snapshots or line movement.

### Phase 6: Settings And Provider Chips

Group settings without hiding power features.

Included:

- Display,
- Sources,
- Sports,
- Details Pane,
- API Keys,
- Maintenance.

Provider chips should show current state such as enabled, disabled, key missing, or quota known. Preserve existing `data-*` bindings and storage keys.

### Phase 7: Accessibility Pass

Add structural keyboard and screen-reader support after the UI shape settles.

Included:

- `aria-expanded` and `aria-controls`,
- visible focus rings in every theme,
- labels for icon-only controls,
- Escape behavior for details/modal surfaces,
- focus return to the triggering control,
- narrow-viewport and high-contrast checks.

## Deferred Ideas

These remain plausible but should wait for user evidence:

- selected-game continuity ribbon,
- copy preview drawer,
- smart copy-mode selector,
- source trace ladder,
- copy templates,
- pinned/favorite games,
- settings search,
- panel top offset and safe-area insets for PDA's app bar and device notches (needs an on-device header measurement — see `TODOS.md`),
- an `isTornPdaContext()` helper via `window.flutter_inappwebview`, only if a behaviour must genuinely differ between PDA and desktop. Page-type detection is correct on both today, so this stays unbuilt.

Build them only if earlier selected-game, copy receipt, and provider-health work still leaves a clear workflow gap.

## Non-Goals

- No external packages or build step.
- No telemetry, analytics, or remote error reporting.
- No Torn API key integration for this panel.
- No broad provider polling when the panel has no relevant bets.
- No storage of copied payloads.
- No raw HAR files or raw provider payloads in the public repo.
- No new status mapping for Torn/provider edge statuses without a real captured payload.
- No betting advice or predictive claims.

## Release Gate

Before publishing a release:

1. Run syntax check.
2. Run the full Node test suite.
3. Review `git diff --check`.
4. Smoke test in Tampermonkey on Torn Bookie.
5. Confirm debug reports redact keys, cookies, Torn data, bet amounts, and bet selections.
6. Update patch notes for the version being published.
7. Confirm `@version` and `SCRIPT_VERSION` fallback agree.
