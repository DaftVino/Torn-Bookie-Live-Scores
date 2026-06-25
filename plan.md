# Plan: Complete UI Priorities 1-5

Source reviewed: `test-docs/feature-ideas.md`  
Repo reviewed: `Torn_Bookie_Live_Scores.js`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `tests/package.json`  
Scope: complete feature-ideas priorities 1-5 while preserving the single-file userscript model, provider behavior, copied payload content, settings, and existing details functionality.

## Context Budget

Completing priorities 1-5 in one uninterrupted implementation pass is expected to exceed 150k context because the production file is a large single userscript, the relevant UI/CSS/handler code is spread across render, action, details, binding, and style sections, and each phase needs syntax/test/manual verification.

Use three implementation phases. No phase should exceed 150k expected context.

| Phase | Priority Coverage | Expected Context | Outcome |
| --- | --- | ---: | --- |
| Phase 1 | Priorities 1-2 | 65k-95k | Themed action notices and consistent button action states |
| Phase 2 | Priorities 3-4 | 70k-110k | Selected-game Tools summary, disabled/no-selection state, and copy receipt/preview groundwork |
| Phase 3 | Priority 5 plus integration hardening | 60k-100k | Row selection/detail affordances, source/status pills, keyboard-safe row behavior, and final regression pass |

## Non-Negotiable Guardrails

- Do not add external packages, hosted assets, build steps, telemetry, or new UI-only network calls.
- Keep `Copy Full Game` output identical unless a separate copy-format task explicitly changes it.
- Do not persist copied payload text. Store only session metadata for receipts.
- Keep all existing Settings options reachable and keep existing `data-*` bindings intact.
- Keep old score data visible during action feedback work; do not rewrite provider refresh behavior.
- Use CSS classes and theme variables instead of new inline style mutations.
- Keep button height and row geometry stable for long match names and all themes.
- Run `npm run test:syntax` and `npm run test:once` from `tests` after each phase.
- Manually smoke test in Tampermonkey before release because the Node harness does not fully exercise Torn DOM selection.

## Existing Touchpoints

Primary source file: `Torn_Bookie_Live_Scores.js`

- State and constants: `PANEL_WIDTH`, `EDGE_GAP`, `uiSettings`, `activeDetailsMatchKey`, `activeDetailsFallbackMatch`
- Feedback: `toast(msg, isError)`
- Copy/debug/details actions: `handleCopyClick(compact, button)`, `handleCopyDebugReport(button)`, `handleShowSelectedDetails(button)`
- Tools UI: `renderCopyTools()`
- Rows: `renderLiveMatch(match)`, `renderUpcomingMatch(match)`, `renderSportGroups(...)`
- Details: `renderDetailsHeader(enrichment)`, `renderDetailsPanel(match)`, `updateDetailsPanel()`
- Panel chrome: `renderUpdatedBar()`, `rerenderPanel()`, `refreshPanel(...)`
- Bindings: copy/details/debug handlers and `bindSportGroupButtons()`
- CSS: injected style block starting near the panel styles

## Phase 1: Action Feedback Foundation

Priorities completed: 1 and 2.

### Goals

- Replace the plain fixed toast with a themed action notification component.
- Keep `toast()` as a compatibility wrapper while migrating important callers.
- Add consistent action states for copy, debug report, and selected-game details buttons.
- Make action feedback accessible with live-region roles.

### Implementation Checklist

1. Add semantic UI tokens in the injected CSS:
   - `--tm-success`
   - `--tm-success-bg`
   - `--tm-info`
   - `--tm-info-bg`
   - `--tm-warning`
   - `--tm-warning-bg`
   - `--tm-danger`
   - `--tm-danger-bg`
   - `--tm-focus`
   - Alias these to existing `--tm-good`, `--tm-bad`, `--tm-warn`, and `--tm-accent` where possible.

2. Implement `showActionNotice({ type, title, detail, timeoutMs })`.
   - Default `type`: `info`.
   - Supported types: `success`, `info`, `warning`, `error`, `loading`.
   - Success/info use `role="status"` and `aria-live="polite"`.
   - Warning/error use `role="alert"` and `aria-live="assertive"`.
   - Use one active DOM node by default.
   - Use a title line, detail line, icon/status slot, and auto-dismiss progress bar.
   - Position by `uiSettings.layoutSide`, `PANEL_WIDTH`, and `EDGE_GAP`.
   - On narrow viewports, stretch within `left: 12px; right: 12px`.
   - Truncate long details with ellipsis and preserve full text in `title`.

3. Keep `toast(msg, isError)` as a wrapper.
   - Map `isError` to `error`; otherwise use `success`.
   - For legacy copy strings such as `Copied: {match}`, parse into title/detail when cheap and obvious.
   - Do not remove `toast()` until all existing callers are migrated or intentionally left compatible.

4. Implement `setButtonActionState(button, state, label, options)`.
   - States: `idle`, `loading`, `success`, `error`, `disabled`.
   - Classes: `is-loading`, `is-success`, `is-error`, `is-disabled`.
   - Store `button.dataset.originalLabel` once.
   - Provide `restoreButtonActionState(button, delayMs = 1600)`.
   - Do not rely on button width changes to communicate success.

5. Migrate action handlers.
   - `handleCopyClick(false, button)`:
     - idle `Copy Full Game`
     - loading `Copying...`
     - success `Copied`
     - error `Copy Failed`
     - success notice title `Copied full game`, detail match name
   - `handleCopyClick(true, button)`:
     - loading `Collecting...` or `Copying...`
     - success `Copied`
     - warning notice for enrichment fallback
     - error notice for clipboard failure
   - `handleCopyDebugReport(button)`:
     - loading `Copying...`
     - success `Copied`
     - error `Copy Failed`
     - keep the existing debug report modal behavior after a successful copy
   - `handleShowSelectedDetails(button)`:
     - loading `Opening...`
     - success `Details Opened`
     - error `Could Not Open`
     - warning when details are disabled in Settings

6. Add CSS for:
   - `.tm-bookie-action-notice`
   - notice type classes
   - notice icon/status slot
   - notice progress bar
   - reduced-motion-safe spinner/dot/progress behavior
   - shared `.is-loading`, `.is-success`, `.is-error`, `.is-disabled` action button states

### User-Visible Copy

- `Copied full game` / `{match name}`
- `Copied compact text` / `{match name}`
- `Copied compact text` / `External analysis unavailable, original game copied`
- `Copy failed` / `Clipboard blocked. Output was written to the console.`
- `Details opened` / `{match name}`
- `Could not open details` / `Could not identify the selected game.`
- `Details unavailable` / `Details panel is disabled in Settings.`

### Verification

- Run `npm run test:syntax` from `tests`.
- Run `npm run test:once` from `tests`.
- Manual smoke cases:
  - copy full success
  - compact/enriched copy success
  - compact copy fallback
  - clipboard failure path, with console fallback
  - debug report copy
  - details disabled
  - long match name
  - left and right panel layouts
  - narrow viewport
  - all themes

### Acceptance Criteria

- No hard-coded green/red toast remains as the primary feedback path.
- Copy/debug/details buttons visibly show loading and result states without layout jump.
- Errors are assertive live-region announcements.
- Success and warning notices use theme tokens.
- Existing copy output and details behavior are unchanged.

## Phase 2: Selected-Game Context And Copy Transparency

Priorities completed: 3 and 4.

### Goals

- Show exactly which Torn game the Tools actions affect.
- Disable Tools actions when no Torn game is selected.
- Add session-only copy receipt metadata after successful copies.
- Add copy preview support only if it can be done without expensive render-time extraction.

### Implementation Checklist

1. Add session-only state near existing UI globals:
   - `let lastCopyReceipt = null;`
   - Optional if preview lands: `let copyPreviewState = { open: false, mode: 'full', text: '', error: '' };`

2. Add `getSelectedGameSummary()`.
   - Query `document.querySelector('li.c-pointer.active')`.
   - Return `null` if no active Torn row exists.
   - Extract best-effort fields synchronously:
     - `name`
     - `sport`
     - `status`
     - `amountText`
     - `sourceLabel`
     - `matchKey` when a renderable match can be found cheaply
   - Do not call `expandExtraOdds(active)` from render.
   - Do not trigger enrichment or provider calls from render.

3. Add `formatSelectedGameSummary(summary)`.
   - Primary line: match name.
   - Secondary line format: `{status} - {sport} - Bet: {amount}`.
   - Use the same ordering in notices, Tools, receipts, and row titles.

4. Update `renderCopyTools()`.
   - Tools header hint:
     - `selected game` when a selection exists
     - `no selection` when none exists
   - Body selected state:
     - label `Selected`
     - selected match name
     - secondary status/sport/bet/source line
   - Body empty state:
     - label `No game selected`
     - `Open a Torn Bookie game to enable copy and details actions.`
   - Keep both action buttons visible.
   - Disable action buttons only when no active row exists.
   - Add `title` explaining disabled reason.

5. Update handlers with no-selection guards.
   - If no active row exists, use `showActionNotice({ type: 'warning', title: 'No game selected', detail: 'Open a Torn Bookie game first.' })`.
   - If active row exists but parsing fails, keep buttons enabled and show an error notice.

6. Add copy receipt metadata.
   - Update only after `copyToClipboard(...)` succeeds.
   - Store:
     - `mode`: `Full game`, `Compact`, `Compact fallback`, or `Debug report`
     - `matchName`
     - `copiedAt`
     - `characterCount`
     - `quality`: `Torn data only`, `enriched`, `fallback`, or `debug`
   - Do not store copied text.
   - Render in Tools:
     - `Last copied: {mode}, {time}`
     - `{matchName}`
     - optional chip: `{characterCount} characters`

7. Add copy preview if time/context remains inside Phase 2.
   - Add a compact `Preview` button in Tools.
   - Generate preview on demand from the selected row and chosen mode.
   - Never auto-refresh preview while open.
   - Use `<pre>` with `max-height`, `overflow:auto`, and `white-space:pre-wrap`.
   - Include `Copy Full`, optional `Copy Compact`, and `Close`.
   - If preview generation needs async odds expansion, show a loading state and keep it button-triggered.

8. Add CSS for:
   - selected summary block
   - no-selection state
   - receipt row/chips
   - disabled buttons
   - optional preview drawer

### User-Visible Copy

- `Selected`
- `No game selected`
- `Open a Torn Bookie game to enable copy and details actions.`
- `Last copied: Full game, 9:42 PM`
- `Copied 2,184 characters`
- `Preview unavailable` / `Could not build a preview for the selected game.`

### Verification

- Run `npm run test:syntax` from `tests`.
- Run `npm run test:once` from `tests`.
- Manual smoke cases:
  - no selected Torn game
  - selected active Torn game with normal parsed data
  - selected active Torn game that parsing cannot resolve
  - receipt after full copy
  - receipt after compact enriched copy
  - receipt after fallback compact copy
  - Tools collapsed/open
  - copy tools hidden in Settings
  - details panel disabled
  - long match names and long bet amounts

### Acceptance Criteria

- Tools always communicates what the actions will target.
- No-selection actions are clearly disabled and explained.
- Selected-game rendering is best-effort and never performs expensive async work.
- Receipt metadata appears only after successful copy and does not persist copied payloads.
- Preview, if implemented, is generated only by explicit user action.

## Phase 3: Row Selection And Action Affordances

Priority completed: 5. Also hardens integration of priorities 1-4.

### Goals

- Visually connect the selected Torn game, details-active row, and Tools state.
- Improve scanability with subtle status/source pills derived from existing data.
- Avoid false keyboard affordances; only focus rows if keyboard actions are implemented.
- Keep details button behavior and details pane ownership clear.

### Implementation Checklist

1. Add a lightweight selected-row key strategy.
   - Prefer deriving selected Torn state from `getSelectedGameSummary()` and existing renderable matches.
   - Add `activeTornSelectionKey` only if DOM-derived matching is too expensive or unreliable.
   - Keep `activeDetailsMatchKey` as the source of truth for details-owned rows.

2. Add row state helper functions.
   - `getMatchRowState(match)` returns:
     - `isTornSelected`
     - `isDetailsActive`
     - `isUnmatched`
     - `statusKind`: `live`, `upcoming`, `unmatched`
     - `sourceLabel`
     - `confidenceLabel` when already present in score metadata
   - `renderMatchStatusPills(match, rowState)` returns existing-data-only badges.

3. Update `renderLiveMatch(match)` and `renderUpcomingMatch(match)`.
   - Add classes:
     - `tm-row-selected`
     - `tm-row-details-active`
     - `tm-row-unmatched`
   - Add `data-match-key`.
   - Add status/source pills only where they improve scanability.
   - Keep title, score, metadata, status line, and bet amount readable.
   - Do not add `tabindex="0"` unless row-level key handlers are implemented in the same phase.

4. Update details button affordance.
   - Active details button uses the same accent language as details-active row.
   - Button title/aria-label should include match name when available.
   - Clicking details still toggles the same pane and does not change copied payload behavior.

5. Optional keyboard support if completed in Phase 3 budget.
   - Make rows focusable only if Enter/Space triggers details for rows with details enabled.
   - Keep focus on actual buttons otherwise.
   - Escape can close details if details pane is open.
   - Return focus to the triggering details button when the details pane closes and the element still exists.

6. Add CSS for:
   - subtle selected row left accent
   - details-active row accent
   - unmatched neutral state
   - compact status/source pills
   - focus-visible rings using `--tm-focus`
   - stable spacing so badges do not shift row height unexpectedly

7. Integration cleanup.
   - Ensure action notices, Tools selected summary, receipts, and row highlight use the same match summary order.
   - Ensure `rerenderPanel()` does not clear copy receipt state.
   - Ensure details fallback matches still display a coherent active state where possible.

### User-Visible Copy

- Pill labels may include:
  - `Live`
  - `Upcoming`
  - `Unmatched`
  - provider labels already present in score metadata, such as `ESPN` or `SofaScore`
  - confidence labels only if already available, such as `exact` or `likely`

### Verification

- Run `npm run test:syntax` from `tests`.
- Run `npm run test:once` from `tests`.
- Run `git diff --check`.
- Manual smoke cases:
  - selected Torn game also visible in panel
  - selected Torn game not visible because sport/filter hides it
  - details-active row
  - details fallback match
  - unmatched live row
  - upcoming row
  - source labels hidden in Settings
  - details buttons hidden/off
  - minimal/classic/compact scoreboard styles
  - all themes
  - left/right layouts and narrow viewport

### Acceptance Criteria

- The row that owns the open details pane is visually obvious.
- The selected Torn game is subtly highlighted when it can be matched to a panel row.
- Row pills use only existing metadata and do not trigger provider calls.
- Keyboard behavior is no worse than before; any new focusable row has real keyboard actions.
- Priorities 1-5 work together without inconsistent labels or competing visual states.

## Final Release Gate

After Phase 3:

1. Run `npm run test:syntax` from `tests`.
2. Run `npm run test:once` from `tests`.
3. Run `git diff --check`.
4. Review the diff for:
   - no new dependencies,
   - no copied payload persistence,
   - no UI-only network calls,
   - no provider-order changes,
   - no Settings option loss,
   - no hard-coded feedback colors outside theme aliases.
5. Manual Tampermonkey smoke test on Torn Bookie:
   - copy full,
   - compact copy,
   - enrichment fallback,
   - debug report copy,
   - selected details,
   - disabled details,
   - no selected game,
   - long match names,
   - all themes,
   - left/right layout,
   - narrow viewport.
6. Do not update `CHANGELOG.md`, userscript version metadata, or release notes unless the user explicitly asks for a version/release update.

## Deferred From Priorities 1-5

These are useful but should not block completion of priorities 1-5 unless the implementation naturally creates the needed foundation:

- Smart copy mode selector.
- Persistent selected-game ribbon.
- Source trace ladder.
- Copy templates.
- Settings subpanel redesign.
- Full details pane hierarchy redesign.
- Provider health mini panel.
