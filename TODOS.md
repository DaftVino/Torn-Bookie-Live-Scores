# TODOS

Deferred work with rationale. Items here are consciously postponed, not forgotten.

## Mobile / Torn PDA

### Panel top offset and safe-area insets

**Deferred from:** [#1](https://github.com/DaftVino/torn-bookie-live-scores/issues/1) (Torn PDA compatibility). Background: [docs/TORN_PDA.md](docs/TORN_PDA.md).

The panel's `#${PANEL_ID}` rule hardcodes `top: ${PANEL_TOP}px` (90px, from the `PANEL_TOP` constant), which assumes the desktop Torn header height. Torn PDA's app bar is a different height, and there is no allowance for device notches. The details pane reuses the same constant.

**Why deferred:** the reporter confirmed the current position looks fine on their device. Picking a better `top` needs an on-device measurement of PDA's header height, and `env(safe-area-inset-*)` support needs testing on a device with a notch. Guessing would risk regressing a position that currently works.

**What it needs:** a device with a notch, plus a measurement of PDA's app bar height. Then either a smaller `top` under the 480px breakpoint, `env(safe-area-inset-top)`, or both.

**Blast radius if wrong:** panel sits too low or overlaps content on PDA. Cosmetic, not functional.

## Known issues (unscheduled)

### `getRefreshErrorSummary()` mislabels capture failures

In `getRefreshErrorSummary()` (`Torn_Bookie_Live_Scores.js`), a "Waiting for Torn Bookie data capture" error does not match any of the network/key patterns, so it falls through to the generic `'Refresh failed.'` summary. A real capture failure is therefore indistinguishable from a provider or network failure in the summary line (the detail body from `renderErrorBody()` underneath does render the correct text).

**Why unscheduled:** surfaced during review of #1 but explicitly out of its scope. Once #1 lands, the panel no longer mounts off-Bookie, so the most common path to this error disappears. It remains reachable on the Bookie page itself when the `sid=bookieApi` response is never captured.
