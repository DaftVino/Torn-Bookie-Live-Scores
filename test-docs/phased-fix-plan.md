# phased-fix-plan.md — Torn Bookie Live Scores (`Torn_Bookie_Live_Scores.js` `@version 2.5.3`)

## ⚙️ Agent execution & parallelization (read first)

**Per-phase assignment for distribution across ChatGPT Codex / Claude Code / local Ollama models, optimized for token cost.**

**Hard constraint — shared file:** all five phases edit the *same* production file `Torn_Bookie_Live_Scores.js`, but in **non-overlapping line regions** (see each phase). Parallel agents must therefore each work in their **own git branch or worktree** and merge serially; do **not** point two agents at the same working copy. Region-disjoint edits merge without conflict. The only secondary collision risk is `tests/load-userscript.js`, edited by both Phase 1 (add `GM_info` stub) and Phase 4 (extend `GM_xmlhttpRequest` stub) — keep those two stub edits in separate hunks, or let whichever lands first be rebased by the other.

**Token-cost strategy:** push the trivial, low-risk phases to **free local Ollama** models; spend cloud tokens (Codex / Claude Code) only on the multi-region and behavior-changing phases. Give each agent **only its phase section of this plan + the named line region + its one test file** — never the full 408 KB source — to keep every context small.

| Phase | Parallel-safe? | Recommended agent | Why / token note |
|---|---|---|---|
| **1** Metadata & docs | ✅ Fully independent | **Ollama** (local code model, e.g. qwen2.5-coder / deepseek-coder) | Pure string edits in 3 spots; zero reasoning. Free. Only nuance: the `GM_info` self-syncing one-liner + harness stub — give the model the exact snippet from the phase. |
| **2** abbreviateSelection | ✅ Fully independent | **Ollama** (local code model) | Single isolated pure function + one test flip. Self-contained, low risk, free. |
| **3** Cache eviction + catch | ⚠️ Independent, but broadest footprint | **Claude Code** *or* **ChatGPT Codex** | Touches several regions (`fetchWithCache`, `getEnrichment`, `refreshPanel`, capture path) with a hard "evict expired-only / never touch `inFlightRequests`" safety constraint. Worth cloud reasoning; too risky for a small local model. |
| **4** Network timeout (N-2) | ⚠️ Soft coupling | **ChatGPT Codex** *or* **Claude Code** | Behavior-changing. Soft deps: extends Phase 1's harness stub and must preserve Phase 3's in-flight cleanup — run after both if serializing, or coordinate the `load-userscript.js` hunk if parallel. Needs careful timeout-value judgement. |
| **5** Containment matcher (M-1) | ✅ Region-independent | **Claude Code** *or* **ChatGPT Codex** (high-effort) | Highest regression risk; core matching + word-boundary logic + new positive regression test + manual smoke. Strongest model only — **do not** assign to a local model. |

**Recommended distribution:**
- **Parallel batch A (free, fire-and-forget):** Phases 1 & 2 → two Ollama agents on separate branches. No coupling, region-disjoint, no cloud tokens spent.
- **Parallel batch B (cloud):** Phases 3 & 5 → can run concurrently (fully region-independent, no shared test file) on one capable cloud agent each.
- **Phase 4 last (or coordinated):** run after Phase 1 (harness stub) and Phase 3 (cleanup) land, to avoid the `load-userscript.js` collision and confirm cleanup is intact. If you must parallelize it, give it its own branch and hand-merge the harness-stub hunk.
- **Net:** worst case 2 cloud agents (Phases 3+5 parallel, then 4) + 2 free local agents (1+2). This minimizes cloud token spend while keeping the critical-path short.

**Merge order after parallel work:** 1 → 2 → 3 → 5 → 4 (4 last so it rebases cleanly onto the final harness stub), then run the full 149-test suite per "Testing & verification."

---

**Purpose:** A sequenced implementation plan for every actionable finding in `fix-summary.md`, cross-checked against `FIX_PLAN.md`, `PRODUCTION_VALIDATION.md`, `NETWORK_AUDIT.md`, `RUNTIME_AUDIT.md`, `SECURITY_AUDIT.md`, and `OVERNIGHT_AUDIT.md`.

**How this plan is grouped:** items are clustered by *code context* (the region/subsystem they touch) so each phase loads one mental model. Phases are ordered to **bank zero-regression wins first and defer the two behavior-changing, higher-risk fixes (network timeout, matching) to the end** — this matches the FIX_PLAN-recommended order `L-4 → L-2 → L-5 → L-3 → L-1 → N-2 → M-1`. Each phase builds on the prior one (e.g., the test-harness stubs added in Phase 1 are extended in Phase 4); no phase depends on a later phase.

**Phasing / context-budget rule applied:** the two findings that change live behavior and pull in the most surrounding code + their own test files — **N-2 (network funnel)** and **M-1 (matching subsystem)** — are each isolated in their own phase so per-phase planning context stays well under the 100k budget and each risky change is independently reviewable. The trivial, same-context hygiene items are consolidated.

**Execution model (per your instruction):** all phases are intended to be applied **sequentially, then tested as a batch**. Two advised exceptions are flagged under "Testing & verification" — Phases 4 and 5 each change runtime behavior and warrant an interim full-suite checkpoint plus a manual smoke test before release.

**Reconciliation notes vs. source docs:**
- Test-suite size is **149** (PRODUCTION_VALIDATION supersedes OVERNIGHT_AUDIT's 130). All 149 must stay green after each phase; characterization tests prefixed `DEFECT:`/`BEHAVIOR:` get **flipped** to assert corrected behavior.
- Unpruned-cache scope is **`providerCache` + `enrichmentCache` only** (`resolvedEventCache` self-evicts; `inFlightRequests` cleans on settle; odds-analysis cache is size-capped).
- This plan adds one actionable item the ranked FIX_PLAN omitted: the **capture-path unhandled-rejection** hygiene fix (`fix-summary.md:192-210`, RUNTIME_AUDIT §6), folded into Phase 3 (same runtime/promise context as L-1).
- Excluded by design (not in any phase): **B-1, B-2, I-1–I-5, N-1, N-3, N-4** — deliberate trade-offs / live-data-dependent. Do not action without a real provider/Torn payload.
- **Line numbers are as-of audit time on a 7,108-line file; re-confirm each location before editing.**

---

## Phase 1 — Metadata & documentation hygiene (L-4, L-2, L-5)

**Context:** the `==UserScript==` header block + `README.md` + the debug-report version constant. No runtime logic; zero regression risk. Grouped because all three are stale-string fixes a publisher would ship in a single version bump.

**Items**

| ID | File / line | Change |
|---|---|---|
| L-4 | `Torn_Bookie_Live_Scores.js:24` | Fix `@homepage hhttps://…` → `https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores` (remove leading `h`). |
| L-2 | `:68` (`SCRIPT_VERSION`), consumed at `buildDebugReport:659` | Replace `const SCRIPT_VERSION = '2.1.0';` with self-syncing form: `const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '2.5.3';`. (Simpler alternative: literal `'2.5.3'`, accepting future drift.) |
| L-5 | `README.md:16` (and reconcile the panel name on `README.md:2`) | Replace `Live_Scores_Panel.js` with `Torn_Bookie_Live_Scores.js`. |

**Test-harness dependency (establishes a pattern reused in Phase 4):** if adopting the `GM_info` form for L-2, add a `GM_info` stub to `tests/load-userscript.js` (`GM_info.script.version`), **or** rely on the literal fallback so the harness (which has no `GM_info`) stays deterministic. Either is acceptable.

**Tests to flip:** `tests/metadata.test.js` → `DEFECT: SCRIPT_VERSION constant disagrees with @version header` (assert `=== '2.5.3'` or `=== GM_info.script.version`); `DEFECT: @homepage has a 'hhttps' typo` (assert starts with `https://`).
**Must stay green:** all other `tests/metadata.test.js` (required directives, `@match`/`@grant`/`@connect`, interception marker). README change is doc-only — no test impact.
**Regression risk:** None. **Stored-data impact:** None.

---

## Phase 2 — Cosmetic label formatting (L-3)

**Context:** one isolated pure function in the odds-analysis region (`abbreviateSelection`, `:3213-3222`). Separate phase because it is a code-logic change in a different subsystem than Phase 1's metadata, but it carries no numeric or matching effect.

**Item**

- **L-3** `Torn_Bookie_Live_Scores.js:3213-3222` — the `<2`-word fallback uses `clean.slice(0,3)` of the *original* unfiltered string, re-introducing the stripped filler (`the|fc|sc|cf|of|and|&`). Fix to use the filtered remainder:
  ```js
  const remainder = words.join(' ').trim() || clean;
  return remainder.slice(0, 3).toUpperCase();
  ```
  → `'FC Barcelona'` → `'BAR'`, `'The Rock'` → `'ROC'` (no trailing space).

**Tests to flip:** `tests/odds-math.test.js` → `DEFECT: abbreviateSelection leaks filler word + trailing space` (assert `'BAR'` / `'ROC'`).
**Must stay green:** `abbreviateBook` and all odds-row/commentary tests.
**Regression risk:** Very low (cosmetic, label strings only). **Stored-data impact:** None.

---

## Phase 3 — In-memory cache eviction & promise hygiene (L-1 + capture-path catch)

**Context:** the caching/runtime layer — `fetchWithCache`, `getEnrichment`, `refreshPanel`/`renderPanel`, and the fetch-intercept capture path. Grouped because both items are in-memory-only session-hygiene fixes touching the same runtime model, and both are validated by `tests/runtime.test.js` / `tests/cache.test.js`.

**Items**

- **L-1a `providerCache`** (decl `:523`; `.set` at `:1720`,`:1728` inside `fetchWithCache:1704`) — sweep expired entries, cost-bounded by size threshold:
  ```js
  const now = Date.now();
  if (providerCache.size > 200) {
    for (const [k, v] of providerCache) if (v.expiry < now) providerCache.delete(k);
  }
  ```
  Place at top of `fetchWithCache` or once per `refreshPanel`. **Sweep expired-only** — never evict unexpired entries (would defeat the 45 s `TTL_SUCCESS` rate-limit) and never touch `inFlightRequests` (would break coalescing).
- **L-1b `enrichmentCache`** (decl `:524`; `.set` at `:1192` inside `getEnrichment:1189`) — after each `renderPanel`, drop keys absent from `latestRenderableMatches` (the only matches that can re-request enrichment), or apply a size-capped FIFO/LRU.
- **Capture-path hygiene** (`:896-898`, RUNTIME_AUDIT §6) — add a `.catch()` to the unhandled `clone().text()` chain:
  ```js
  response.clone().text()
    .then(text => tryParseBookieResponse(text, url))
    .catch(() => {});  // clone/text failures are non-fatal
  ```

**Tests to flip:** `tests/runtime.test.js` → `providerCache grows monotonically … NOT auto-pruned on expiry` and `enrichmentCache grows one entry per distinct match key and is never pruned` (assert size shrinks after sweep / caps).
**Must stay green:** all `tests/cache.test.js` (TTL hit/expiry, coalescing, error-caching safe shape, no in-flight leak); the `resolvedEventCache` self-eviction and `inFlightRequests` cleanup tests in `tests/runtime.test.js`.
**Regression risk:** Low–Medium — only danger is evicting a still-valid entry (functionally safe: a miss just re-fetches). **Stored-data impact:** None (both Maps in-memory only).

---

## Phase 4 — Network request timeout (N-2) — *behavior-changing; isolated*

**Context:** the outbound network funnel — `gmFetchJson:955-976`, `gmFetchJsonWithMeta:988-1010`, and how `fetchWithCache`/`inFlightRequests` handle rejections. Isolated in its own phase because it changes live request behavior, pulls in the whole `findScoreForMatch → resolveProviderMatch → fetchWithCache → gmFetch*` chain, and needs its own harness stub work — keeping it alone bounds the planning context and makes it independently reviewable. **Builds on Phase 3:** the timeout reject must flow through the same in-flight cleanup that Phase 3 leaves intact.

**Items**

- Add a `timeout` key to **both** `GM_xmlhttpRequest` option objects (`:957`, `:990`), which activates the already-present-but-dead `ontimeout` reject branches (`:973`, `:1007`):
  ```js
  GM_xmlhttpRequest({ method: 'GET', url, headers, timeout: 12000, onload, onerror,
    ontimeout() { reject(new Error('timeout')); } });
  ```
- **Optional defense-in-depth:** wrap `findScoreForMatch` provider calls (`:3465`) in `withTimeout(…, 15000)`, as enrichment already does at `:4988`.
- **Caution on the value:** set it comfortably above the slowest provider's latency (TheScore windowed feed, BBC). Too-short converts slow-but-valid responses into 15 s (`TTL_ERROR`) error-cache entries; too-long is harmless (preserves current behavior).

**Test-harness dependency (extends Phase 1's stub work):** the harness stubs `GM_xmlhttpRequest` as a no-op. To test this, extend the stub in `tests/load-userscript.js` to honor `timeout`/`ontimeout`.
**Tests:** keep `tests/cache.test.js` → `a rejected fetch never leaks an in-flight entry` green (timeout must flow through the same cleanup). **Add (recommended):** a test asserting a timed-out fetch (a) rejects with a `timeout` message, (b) caches the safe empty shape `{error, events:[], Stages:[]}`, (c) clears `inFlightRequests`.
**Regression risk:** Low–Medium (timeout-too-short risk above). **Stored-data impact:** None.

---

## Phase 5 — Containment matcher over-match (M-1) — *behavior-changing; isolated; do last*

**Context:** the core matching subsystem — `calcTeamMatchScore:1270-1276`, plus `matchTeamPair`/`scoreTeamOrientation`, the alias table (`:1265-1268`), the Jaccard branch, and `tests/matching.test.js`. Isolated and placed last because it is the **only finding that produces a user-visible wrong result**, it is the highest-regression-risk change (it underpins all score matching), and it requires the broadest matching context + a manual smoke test — so it stays in its own phase to keep planning context bounded and review focused.

**Item**

- **M-1** — the containment branch's only guard is "both normalized names ≥ 5 chars," so any ≥6-char name that is a raw substring of a longer name returns `80` (≥ `CONFIDENCE_THRESHOLD 60`) and can attach the **wrong fixture's score**. The inline comment at `:1270` falsely claims the `mexico`/`new mexico` case is prevented.
  - **Preferred fix:** require whole-word-boundary containment — split `longer` into word tokens; `return 80` only if `shorter` equals one token **and** the extra words are not disqualifying qualifiers (`new`, `reserves`, `reserve`, `u21`, `u23`, `u19`, `b`, `ii`, `women`, `w`). Otherwise fall through to the existing Jaccard branch. **Correct the misleading comment.**
  - **Lower-risk alternative** (if word-boundary proves too strict and regresses a legitimate pair): keep `includes` but return a **sub-threshold score (e.g. `55`)** so containment only confirms via time + competition bonuses, never on name alone.
  - **Before shipping:** verify legitimate aliased pairs still resolve via the alias table or Jaccard (e.g. `Barcelona`/`FC Barcelona`, `Man United`/`Manchester United`) and **add a positive regression test** proving it.

**Tests to flip:** `tests/matching.test.js` → `DEFECT: containment heuristic over-matches contained names` — assert `calcTeamMatchScore('Mexico','New Mexico') < CONFIDENCE_THRESHOLD`; same for `('Arsenal','Arsenal Reserves')`, `('United','Manchester United')` (unless alias-covered); `matchTeamPair({team1:'Mexico',team2:'USA'},'New Mexico','USA').confidence < 60`.
**Must stay green:** `min-length guard catches short containment (York/New York)`, all exact/alias/Jaccard cases, orientation detection, distinct-same-league-below-threshold, and all candidate-scoring/plan tests.
**Regression risk:** Medium — core of all score matching. **Stored-data impact:** None (pure in-memory logic).

---

## Testing & verification

Per FIX_PLAN §11, the invariant after **every** change is: `node --test tests/*.test.js` → **all 149 pass** (each flipped `DEFECT:` test now green proves its fix), followed by the stability sweep (10× sequential + 6× shuffled-order + 3× concurrent).

You asked that phases run sequentially before a single test pass unless advised otherwise. **Advised exceptions:**
1. **Interim full-suite checkpoint after Phase 4 and after Phase 5** — these two change live behavior; bundling their failures with the trivial phases makes triage harder. A green checkpoint after each isolates any regression to that phase.
2. **Manual smoke test on `https://www.torn.com/page.php?sid=bookie` with real bets** for Phase 4 (N-2) and Phase 5 (M-1) before release — neither the stall path nor real provider-payload matching is reproducible in the Node harness.
3. **Phases 1–3 may be applied and tested as one batch** — all zero/low regression and harness-only verifiable.

**Release:** bump `@version` (and `SCRIPT_VERSION` if kept as a literal) once; metadata edits (L-2, L-4) ship as part of that bump — Greasy Fork re-parses the header on publish.

## Dependency summary

```
Phase 1 (metadata/docs)        ── adds GM_info harness stub pattern ─┐
Phase 2 (abbreviateSelection)   independent                          │
Phase 3 (cache eviction + catch) independent                         │
Phase 4 (network timeout) ── relies on Phase 3's intact in-flight cleanup; extends Phase 1's harness stub
Phase 5 (containment matcher)   independent of all above; sequenced last for risk
```
No phase depends on a later phase. Apply 1 → 2 → 3 → 4 → 5.
