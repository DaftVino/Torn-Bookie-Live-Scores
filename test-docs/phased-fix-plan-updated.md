# phased-fix-plan.md — Torn Bookie Live Scores (`Torn_Bookie_Live_Scores.js` `@version 2.5.3`)

## ⚙️ Agent execution, model assignment, and merge strategy

**Purpose:** Implement every actionable finding from `fix-summary.md`, cross-checked against `FIX_PLAN.md`, `PRODUCTION_VALIDATION.md`, `NETWORK_AUDIT.md`, `RUNTIME_AUDIT.md`, `SECURITY_AUDIT.md`, and `OVERNIGHT_AUDIT.md`.

### Hard constraint: shared production file

All five phases edit the same production file, `Torn_Bookie_Live_Scores.js`, but they target separate regions. Any phases developed in parallel must use separate Git branches or worktrees. Never point two implementation agents at the same working copy.

`tests/load-userscript.js` is the only secondary overlap:

- Phase 1 may extend the loader to support optional `GM_info` injection.
- Phase 4 extends the `GM_xmlhttpRequest` stub to simulate timeout behavior.

These edits should remain in separate hunks. The required serial merge order resolves any conflict.

### Recommended model assignment

| Phase | Recommended model/tool | Effort | Reason |
|---|---|---:|---|
| **1 — Metadata & docs** | Continue Edit with `qwen2.5-coder:14b` | Normal | Exact, localized edits with deterministic tests. |
| **2 — `abbreviateSelection`** | Continue Edit with `qwen2.5-coder:14b` | Normal | One isolated pure function and a narrow regression test. |
| **3 — Cache eviction + promise catch** | Claude Code with Claude Sonnet 4.6 | High | Multi-region runtime work with strict cache and in-flight invariants. |
| **4 — Network timeout** | Codex with GPT-5.5 | High | Production and harness changes, timeout simulation, and repeated test/fix cycles. |
| **5 — Containment matcher** | Claude Code with Claude Opus 4.8 | Xhigh | Highest regression risk and the most nuanced matching logic. |
| **Final independent review** | Codex with GPT-5.5 | Xhigh | Review the complete merged diff independently of the implementation agents. |

**Local fallback for Phases 3–5:** Continue Agent/Edit with `qwen3-coder:30b`, using a 32k context window initially. Use 64k only if the task demonstrably requires it. Expect slower execution because the 19 GB model cannot fit entirely in the RTX 3080 Ti's 12 GB VRAM.

### Parallelization and merge order

For the clearest audit trail and lowest semantic risk, use:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Final independent review
7. Release verification

Phases 1 and 2 may be developed concurrently in separate worktrees because they are genuinely independent. Each still requires diff review and testing before commit.

Phase 5 may also be developed in a separate worktree while earlier phases proceed, but it must be rebased and merged last. Do not merge Phase 4 before Phase 3. Phase 4 relies on Phase 3 preserving the in-flight cleanup path.

**Required merge order:** `1 → 2 → 3 → 4 → 5`

### No “fire-and-forget” phases

Every implementation agent, including local models, must:

1. Inspect the target code and relevant tests before editing.
2. Show or summarize the final diff.
3. Run the phase's targeted tests.
4. Run the complete 149-test suite before commit.
5. Confirm no out-of-scope files or regions changed.
6. Commit only after the diff and tests are clean.

### Context-budget rules

Give each agent:

- Only its phase section from this plan.
- The named production regions or symbols.
- The relevant test files.
- The permanent Continue project rules.
- The phase acceptance criteria.

Allow the agent to inspect direct callers, callees, shared constants, key-generation helpers, and existing tests. Do not force the entire 408 KB userscript into the initial prompt merely because the agent may inspect it through repository tools.

Initial context targets:

| Model | Preferred initial task context |
|---|---:|
| `qwen2.5-coder:14b` | Under 15k–20k tokens |
| `qwen3-coder:30b` local | Under 35k–40k tokens |
| Claude Sonnet / Claude Opus / GPT-5.5 | Prefer under 60k–70k tokens |
| Absolute pre-execution ceiling | Under 100k tokens |

A plan validated at nearly 100k tokens is not operationally under 100k once tool definitions, source excerpts, test output, Git diffs, and model output are added. Split the phase further if the initial handoff approaches the ceiling.

---

## Plan-wide implementation rules

- Treat the current phase as authoritative.
- Implement only the requested findings.
- Reconfirm symbols and locations before editing; audit-time line numbers may have shifted.
- Preserve existing behavior outside the explicit defect.
- Prefer localized changes over broad refactors.
- Do not add packages, services, network destinations, telemetry, storage, or unrelated cleanup.
- Do not weaken tests merely to make them pass.
- Never claim a command or test passed unless it was actually run.
- Preserve the single-file userscript deployment model.
- Keep test-only behavior in the test harness.
- Use separate branches or worktrees for concurrent development.
- Review the final diff before commit and again after merge.

---

## Reconciliation notes

- Test-suite size is **149**. `PRODUCTION_VALIDATION` supersedes `OVERNIGHT_AUDIT` where the older report states 130.
- Characterization tests prefixed `DEFECT:` or `BEHAVIOR:` must be updated to assert corrected behavior, not deleted or weakened.
- Unpruned-cache scope is limited to `providerCache` and `enrichmentCache`.
  - `resolvedEventCache` already self-evicts.
  - `inFlightRequests` already cleans on settle and must never be pruned as a cache.
  - The odds-analysis cache is already size-capped.
- The capture-path unhandled-rejection fix is included in Phase 3 because it shares the same promise/runtime context as L-1.
- Excluded by design: **B-1, B-2, I-1–I-5, N-1, N-3, N-4**. These are deliberate trade-offs or require real provider/Torn payloads. Do not implement them without new evidence.
- Line numbers are based on the audited 7,108-line file. Locate by symbol and surrounding code, not line number alone.

---

# Phase 1 — Metadata and documentation hygiene (L-4, L-2, L-5)

## Scope

The `==UserScript==` header, `SCRIPT_VERSION`, `README.md`, the metadata tests, and only the minimum test-loader support needed to exercise `GM_info`.

No runtime behavior should change.

## Assigned model

Continue Edit with `qwen2.5-coder:14b`.

## Required changes

| ID | File / location | Change |
|---|---|---|
| L-4 | `Torn_Bookie_Live_Scores.js`, userscript header | Change `@homepage hhttps://…` to `https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores`. |
| L-2 | `SCRIPT_VERSION`, consumed by `buildDebugReport` | Replace the stale literal with `const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '2.5.3';`. |
| L-5 | `README.md` | Replace stale `Live_Scores_Panel.js` references with `Torn_Bookie_Live_Scores.js` and reconcile the panel/script name where needed. |

## Explicit `GM_info` test strategy

Do not install a permanent global `GM_info` value in the default test harness.

Instead:

1. Keep the ordinary loader path without `GM_info` so the `'2.5.3'` fallback is exercised.
2. Extend the loader with an optional `GM_info` injection mechanism, or create a focused isolated load in `tests/metadata.test.js`.
3. Verify both:
   - No `GM_info` → `SCRIPT_VERSION === '2.5.3'`.
   - Injected `GM_info.script.version` → `SCRIPT_VERSION` matches the injected version.

This keeps the default Node harness deterministic while proving the production self-sync behavior.

## Tests

Update or flip in `tests/metadata.test.js`:

- `DEFECT: SCRIPT_VERSION constant disagrees with @version header`
- `DEFECT: @homepage has a 'hhttps' typo`

Keep all other metadata tests green, including required directives, `@match`, `@grant`, `@connect`, and the interception marker.

## Verification

Run:

```bash
node --test tests/metadata.test.js
node --test tests/*.test.js
```

## Acceptance criteria

- Homepage URL is valid.
- Version fallback equals the current header version.
- Injected `GM_info.script.version` overrides the fallback.
- README uses the correct production filename.
- All 149 tests pass.
- No runtime logic changed.

**Regression risk:** None  
**Stored-data impact:** None

---

# Phase 2 — Cosmetic label formatting (L-3)

## Scope

`abbreviateSelection` and its existing odds-math tests only.

## Assigned model

Continue Edit with `qwen2.5-coder:14b`.

## Required change

In `abbreviateSelection`, the `<2`-word fallback currently slices the original unfiltered string and can reintroduce a removed filler token.

Use the filtered remainder:

```js
const remainder = words.join(' ').trim() || clean;
return remainder.slice(0, 3).toUpperCase();
```

Expected examples:

- `FC Barcelona` → `BAR`
- `The Rock` → `ROC`
- No trailing space

Do not change numeric odds logic, book abbreviations, commentary formatting, or unrelated label behavior.

## Tests

Update or flip in `tests/odds-math.test.js`:

- `DEFECT: abbreviateSelection leaks filler word + trailing space`

Add or retain assertions for both `BAR` and `ROC`.

Keep `abbreviateBook` and all odds-row/commentary tests green.

## Verification

Run:

```bash
node --test tests/odds-math.test.js
node --test tests/*.test.js
```

## Acceptance criteria

- Filler words do not reappear in the three-character fallback.
- Output is uppercase and contains no trailing whitespace.
- All 149 tests pass.
- No unrelated formatting changed.

**Regression risk:** Very low  
**Stored-data impact:** None

---

# Phase 3 — In-memory cache eviction and promise hygiene (L-1 + capture-path catch)

## Scope

The cache/runtime layer:

- `providerCache`
- `enrichmentCache`
- `fetchWithCache`
- `getEnrichment`
- `refreshPanel` / `renderPanel`
- The intercepted response capture path
- `tests/runtime.test.js`
- `tests/cache.test.js`

## Assigned model

Claude Code with Claude Sonnet 4.6 at high effort.

## Required changes

### L-1a: `providerCache`

Add a cost-bounded expired-entry sweep.

Reference behavior:

```js
const now = Date.now();
if (providerCache.size > 200) {
  for (const [key, value] of providerCache) {
    if (value.expiry < now) providerCache.delete(key);
  }
}
```

The agent must choose the safest existing lifecycle point, such as the beginning of `fetchWithCache` or once per refresh, after inspecting current call frequency.

Hard invariants:

- Delete expired entries only.
- Never delete an unexpired success entry.
- Preserve the 45-second `TTL_SUCCESS` rate-limit behavior.
- Never modify, prune, or clear `inFlightRequests`.
- Preserve request coalescing.

### L-1b: `enrichmentCache`

Prune entries that can no longer be requested by the current renderable match set, or apply a clearly bounded FIFO/LRU strategy if that better fits the existing key design.

Before editing:

- Locate the exact enrichment key-generation path.
- Confirm how `latestRenderableMatches` maps to cache keys.
- Do not compare unlike key formats.
- Preserve entries that remain relevant to current renderable matches.

Prefer pruning after a completed render cycle when the active match set is known.

### Capture-path promise hygiene

Change the unhandled chain to explicitly absorb nonfatal clone/text failures:

```js
response.clone().text()
  .then(text => tryParseBookieResponse(text, url))
  .catch(() => {});
```

The empty catch is permitted only because this capture path is observational and the failure is explicitly nonfatal. Do not use this pattern to suppress provider, cache, or rendering failures elsewhere.

## Tests

Update or flip in `tests/runtime.test.js`:

- `providerCache grows monotonically … NOT auto-pruned on expiry`
- `enrichmentCache grows one entry per distinct match key and is never pruned`

Add assertions proving:

- Expired provider entries are removed after the threshold/lifecycle condition.
- Unexpired entries remain.
- Enrichment entries not present in the active renderable set are removed or the cache remains within the selected cap.
- Active/relevant enrichment entries remain.

Keep green:

- All TTL hit/expiry tests.
- Request coalescing.
- Safe error-cache shape.
- Rejected fetch cleanup.
- `resolvedEventCache` self-eviction.
- `inFlightRequests` cleanup and no-leak tests.

## Verification

Run:

```bash
node --test tests/runtime.test.js
node --test tests/cache.test.js
node --test tests/*.test.js
```

## Acceptance criteria

- Expired provider entries no longer grow indefinitely.
- Valid provider entries are not evicted early.
- Enrichment cache is pruned without removing active entries.
- Capture-path clone/text failures cannot become unhandled rejections.
- `inFlightRequests` behavior is unchanged.
- All 149 tests pass.

**Regression risk:** Low–Medium  
**Stored-data impact:** None

---

# Phase 4 — Network request timeout (N-2)

## Scope

The outbound network funnel:

- `gmFetchJson`
- `gmFetchJsonWithMeta`
- `fetchWithCache`
- `inFlightRequests` rejection cleanup
- `tests/load-userscript.js`
- Timeout-focused cache/network tests

This phase must begin from the merged Phase 3 result.

## Assigned model

Codex with GPT-5.5 at high effort.

## Required changes

Add `timeout: 12000` to both `GM_xmlhttpRequest` option objects so the existing `ontimeout` branches become reachable.

Reference form:

```js
GM_xmlhttpRequest({
  method: 'GET',
  url,
  headers,
  timeout: 12000,
  onload,
  onerror,
  ontimeout() {
    reject(new Error('timeout'));
  }
});
```

Use the existing surrounding formatting and callbacks rather than restructuring the request helpers.

### Do not add a second timeout layer by default

Do not automatically wrap provider calls in `withTimeout(..., 15000)` in this phase. Duplicate timeout layers complicate failure attribution and testing.

Add a defense-in-depth wrapper only if repository inspection or a failing regression test proves that a request can still bypass the `GM_xmlhttpRequest` timeout.

### Timeout-value constraint

Twelve seconds is the intended starting value. Before changing it, inspect any documented provider latency assumptions and existing timeout constants.

A shorter timeout risks converting slow-but-valid provider responses into `TTL_ERROR` entries. A longer timeout preserves more of the current behavior but leaves the UI stalled longer.

## Test-harness change

Extend the existing `GM_xmlhttpRequest` test stub so tests can deterministically trigger:

- `onload`
- `onerror`
- `ontimeout`

The stub must not use real wall-clock waits. Use controlled test behavior or a short deterministic timer appropriate to the existing harness.

Keep Phase 1's optional `GM_info` injection behavior intact.

## Tests

Add a timeout regression test proving that a timed-out request:

1. Rejects with a timeout-identifying error.
2. Flows through existing error handling.
3. Produces the expected safe cached shape, such as `{ error, events: [], Stages: [] }`, where that is the current contract.
4. Clears the matching `inFlightRequests` entry.
5. Does not prevent a later retry after the error TTL.

Keep green:

- `a rejected fetch never leaks an in-flight entry`
- Request coalescing
- Success-cache TTL behavior
- Error-cache TTL behavior
- Existing provider helper tests

## Verification

Run:

```bash
node --test tests/cache.test.js
node --test tests/runtime.test.js
node --test tests/*.test.js
```

Then perform a manual smoke test on:

```text
https://www.torn.com/page.php?sid=bookie
```

Confirm:

- Normal provider responses still populate scores.
- A slow or failed provider does not leave the panel indefinitely waiting.
- Subsequent refreshes can retry after error-cache expiry.
- No uncaught rejection appears in the browser console.

## Acceptance criteria

- Both request helpers set an explicit timeout.
- Timeout rejection uses the existing cleanup path.
- No in-flight entry leaks.
- Normal success behavior is unchanged.
- The harness tests timeout deterministically.
- All 149 tests pass.
- Manual smoke test passes.

**Regression risk:** Low–Medium  
**Stored-data impact:** None

---

# Phase 5 — Containment matcher over-match (M-1)

## Scope

The core matching subsystem:

- `calcTeamMatchScore`
- `matchTeamPair`
- `scoreTeamOrientation`
- Existing alias normalization
- Jaccard scoring
- `tests/matching.test.js`

This phase is merged last because it is the only finding that can directly attach the wrong live score to a fixture.

## Assigned model

Claude Code with Claude Opus 4.8 at xhigh effort.

## Defect

The current containment branch grants a score of `80` when one normalized name is a raw substring of another and both names meet a minimum character length.

This can exceed `CONFIDENCE_THRESHOLD` based on name containment alone:

- `Mexico` / `New Mexico`
- `Arsenal` / `Arsenal Reserves`
- `United` / `Manchester United`

The inline comment claiming the length guard prevents `Mexico` / `New Mexico` is incorrect and must be replaced.

## Preferred algorithm

Replace raw string containment with conservative token-sequence containment.

### Step 1: use normalized token arrays

Split the normalized shorter and longer names into nonempty word tokens using the same normalization assumptions already used by the matcher.

Do not introduce a competing normalization pipeline unless the existing helper cannot provide the required tokens.

### Step 2: require contiguous token-sequence containment

The full shorter token sequence must appear contiguously within the longer token sequence.

This supports legitimate multi-token cases such as:

- `Real Madrid` / `Real Madrid CF`
- `Manchester United` / `Manchester United FC`

It also supports legitimate single-token club names where the only extra token is a neutral club affix:

- `Barcelona` / `FC Barcelona`

Raw character substring matches are insufficient.

### Step 3: evaluate the extra tokens

Containment may return `80` only when every token outside the matched sequence is a permitted neutral organizational affix.

Start with a deliberately narrow neutral set supported by actual repository behavior and tests, such as:

```text
fc, cf, sc, club
```

Do not silently broaden this set without a positive test.

Reject high-confidence containment when any extra token is a disqualifying qualifier, including:

```text
new, reserves, reserve, women, w, b, ii, u19, u21, u23
```

Inspect the repository for additional age, reserve, gender, or squad suffixes already represented in normalization or aliases and test any additions.

### Step 4: block generic one-token containment

A generic one-token shorter name must not receive `80` based only on containment.

At minimum, cover examples such as:

```text
united, city, town, athletic, sporting, racing, real
```

Before finalizing the set, inspect existing aliases and positive fixtures so legitimate exact or alias matches are not harmed.

Exact matches and alias matches should still resolve through their existing higher-priority paths.

### Step 5: fall through when containment is inconclusive

If the token sequence is not contiguous, extra tokens are not all neutral, a disqualifying qualifier is present, or the shorter name is an ambiguous generic token, do not return `80`.

Fall through to the existing Jaccard and downstream scoring logic.

Do not return a new arbitrary confidence score unless the preferred approach proves incompatible with legitimate fixtures and the alternative is documented with tests.

## Required tests

Update or flip:

- `DEFECT: containment heuristic over-matches contained names`

Negative assertions:

```js
calcTeamMatchScore('Mexico', 'New Mexico') < CONFIDENCE_THRESHOLD
calcTeamMatchScore('Arsenal', 'Arsenal Reserves') < CONFIDENCE_THRESHOLD
calcTeamMatchScore('United', 'Manchester United') < CONFIDENCE_THRESHOLD
```

Also verify the complete pair does not qualify:

```js
matchTeamPair(
  { team1: 'Mexico', team2: 'USA' },
  'New Mexico',
  'USA'
).confidence < CONFIDENCE_THRESHOLD
```

Positive regression assertions must cover legitimate token-boundary cases, including at least:

```text
Barcelona / FC Barcelona
Real Madrid / Real Madrid CF
Manchester United / Manchester United FC
```

Where an existing alias path handles one of these, assert that the pair still resolves successfully and document which path is responsible.

Keep green:

- Exact-name cases
- Alias cases
- Jaccard cases
- Orientation detection
- `York` / `New York` minimum-length behavior
- Distinct same-league names below threshold
- Candidate scoring and plan tests

## Manual review requirements

Before accepting the implementation:

1. Inspect the actual confidence path for every new positive and negative fixture.
2. Confirm no new token list shadows or conflicts with the alias table.
3. Review both team orientations.
4. Confirm generic-token handling does not reject exact or explicit alias matches.
5. Review the final matcher diff independently from the implementation agent.

## Verification

Run:

```bash
node --test tests/matching.test.js
node --test tests/*.test.js
```

Then perform a manual smoke test on:

```text
https://www.torn.com/page.php?sid=bookie
```

Use real current fixtures where possible and inspect debug output for:

- Legitimate club-prefix/suffix matches.
- Reserve, youth, women's, B-team, and geographic-prefix distinctions.
- Correct orientation.
- No score attached solely because one team name contains another.

## Acceptance criteria

- Raw character containment no longer grants high confidence.
- Legitimate contiguous token-sequence cases remain supported.
- Disqualifying qualifiers block containment confidence.
- Generic one-token names cannot qualify by containment alone.
- Exact and alias behavior remains intact.
- Both orientations remain correct.
- All 149 tests pass.
- Manual smoke test passes.

**Regression risk:** Medium  
**Stored-data impact:** None

---

# Testing and verification policy

## Within every phase branch

Run the narrowest relevant test file first, then the full suite:

```bash
node --test tests/<relevant-file>.test.js
node --test tests/*.test.js
```

Do not commit until all 149 tests pass.

If a failure is unrelated and demonstrably pre-existing:

- Record it.
- Prove it exists on the branch base.
- Do not modify unrelated code unless the task scope is explicitly expanded.

## After every phase merge

On the integration branch:

```bash
node --test tests/*.test.js
```

All 149 tests must pass before merging the next phase.

## Behavior-changing checkpoints

After Phase 4:

- Full suite
- Manual live smoke test

After Phase 5:

- Full suite
- Manual live smoke test

## Final stability sweep

Run only after all five phases are merged and the ordinary suite is green:

- 10 sequential full-suite runs
- 6 shuffled-order runs
- 3 concurrent runs

Use the repository's existing commands or scripts for shuffled and concurrent execution. Do not invent a different stability procedure without documenting it.

## Final independent review

Give GPT-5.5 at xhigh effort:

- The approved phase plan
- The complete merged Git diff
- Relevant test changes
- Final test output
- Any manual-smoke notes

Ask it to identify:

- Out-of-scope changes
- Missed requirements
- Weakened tests
- Cache or in-flight regressions
- Timeout cleanup defects
- Matching false positives or false negatives
- Release-version inconsistencies

Resolve any material findings and rerun the affected tests plus the complete suite.

---

# Release gate

1. Confirm the integration branch is clean except for intended release changes.
2. Run the complete 149-test suite.
3. Complete the final stability sweep.
4. Complete the Phase 4 and Phase 5 manual smoke tests.
5. Complete independent final review.
6. Bump the userscript `@version` once for the release.
7. Update the `SCRIPT_VERSION` fallback literal to the same release version, even though production normally reads `GM_info`.
8. Rerun metadata tests and the complete suite after the version bump.
9. Review the final release diff.
10. Publish to Greasy Fork.
11. Verify Greasy Fork parsed the header and displays the new version and corrected homepage.

---

# Dependency summary

```text
Phase 1 — Metadata/docs
  Independent; may add optional GM_info injection support in the loader.

Phase 2 — abbreviateSelection
  Independent of all other phases.

Phase 3 — Cache eviction + capture-path catch
  Must preserve inFlightRequests and establishes the cleanup behavior Phase 4 relies on.

Phase 4 — Network timeout
  Must begin from merged Phase 3 and preserve its cleanup invariants.
  May touch a separate hunk in tests/load-userscript.js after Phase 1.

Phase 5 — Containment matcher
  Runtime-independent from Phases 1–4 but highest risk.
  Merge last.

Final order
  1 → 2 → 3 → 4 → 5 → independent review → release
```
