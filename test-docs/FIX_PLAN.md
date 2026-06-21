# FIX PLAN — Torn Bookie Live Scores

**Status: planning only. No code has been changed.** This plan covers the **confirmed** findings from `PRODUCTION_VALIDATION.md` (those with code-path evidence *and* a reproducible test, plus one confirmed code-path fact, N-2). It ranks them, then specifies a minimal, regression-aware correction for each.

**Explicitly excluded** (per the request): pure style/preference changes; speculative findings without evidence; refactors that do not correct a confirmed problem; micro-optimizations without measurable impact. The Informational/by-design items in the validation report (I-1…I-5, B-2) are **not** action items — they are deliberate trade-offs and are listed at the end under "Out of scope."

> **Important about the test suite:** the failing-case tests are *characterization tests* that currently assert the **buggy** behavior (prefixed `DEFECT:` / `BEHAVIOR:`). A correct fix will **flip** those assertions. For each item, "Tests that must pass" lists (a) the characterization test that must be **updated** to assert the fixed behavior, and (b) the invariant that **all other 149 tests still pass**.

---

## 1. Ranking

Scored 1 (low) – 5 (high) on each axis. "Priority score" = `UserImpact × Likelihood ÷ (FixRisk × RegressionPotential)` (higher = fix sooner / cheaper-safer). The table is sorted by a blended judgement, not the raw number alone — **M-1 is the top correctness priority despite higher fix risk** because it is the only finding that shows a *wrong result* to the user.

| Rank | ID | Finding | User impact | Likelihood | Fix risk | Regression potential | Notes |
|---|---|---|---:|---:|---:|---:|---|
| 1 | **M-1** | Containment matcher over-matches contained team names | 4 | 2 | 3 | 3 | Only finding that yields a *wrong score*; fix carefully |
| 2 | **L-2** | `SCRIPT_VERSION` ≠ `@version` (debug report) | 2 | 5 | 1 | 1 | High-frequency, trivial, zero regression |
| 3 | **L-1** | `providerCache`/`enrichmentCache` never pruned | 2 | 3 | 2 | 2 | Real (slow) growth; safe eviction is low-risk |
| 4 | **N-2** | No `GM_xmlhttpRequest` timeout; dead `ontimeout` | 3 | 2 | 2 | 3 | Pick timeout value carefully (slow≠failed) |
| 5 | **L-3** | `abbreviateSelection` leaks filler word/space | 1 | 3 | 1 | 1 | Cosmetic, isolated pure fn |
| 6 | **L-4** | `@homepage` `hhttps://` typo | 1 | 5 | 1 | 1 | One-character metadata fix |
| 7 | **L-5** | README references non-existent filename | 1 | 2 | 1 | 1 | Docs only, no code |

**Conditional / needs live data (not yet actionable):** **B-1** (Torn statuses other than `inprogress`/`notstarted` are dropped). The code path is confirmed, but whether Torn ever emits such statuses for held bets is unverifiable offline. **Do not change behavior until a real Torn payload with such a status is observed** — see §9.

**Recommended execution order** (balances "fix the worst result" with "bank the cheap zero-regression wins first"): **L-4 → L-2 → L-5 → L-3 → L-1 → N-2 → M-1.** Do the trivial, zero-regression fixes first to de-risk the release, then the cache eviction, then the two changes that touch live behavior (timeout, matching) last with the most review.

---

## 2. M-1 — Containment matcher over-matches contained team names

- **Exact affected code:** `Torn_Bookie_Live_Scores.js:1270-1276` (the containment branch of `calcTeamMatchScore`), and the misleading comment on `:1270`.
  ```js
  // Containment with minimum-length guard (prevents "mexico" matching "new mexico")
  const MIN_LEN = 5;
  if (na.length >= MIN_LEN && nb.length >= MIN_LEN) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer  = na.length <= nb.length ? nb : na;
    if (longer.includes(shorter)) return 80;
  }
  ```
- **Root cause:** the only guard is "both names ≥ 5 chars." A ≥6-char name fully contained in a longer one (`mexico` ⊂ `new mexico`) still returns 80 ≥ `CONFIDENCE_THRESHOLD (60)`. The comment claims the `mexico`/`new mexico` case is prevented; it is not.
- **Minimal correction (preferred):** require **whole-word-boundary** containment instead of raw substring, and reject when the longer name only matches by adding a leading/trailing qualifier word. Concretely: split `longer` into words; accept (return 80) only if `shorter` equals one of `longer`'s words **and** the extra words are not disqualifying qualifiers (`new`, `reserves`, `reserve`, `u21`, `u23`, `u19`, `b`, `ii`, `women`, `w`). Otherwise fall through to the Jaccard branch (which already scores partial overlap below threshold). Keep legitimate cases working: `united` as a standalone word in `manchester united` should still match via the existing alias table (`Man United`→`Manchester United` is an alias, `:1265-1268`) and/or Jaccard; verify against the alias list before relying on containment.
  - Lower-risk alternative if word-boundary proves too strict: keep substring containment but **return a sub-threshold score (e.g. 55)** so it only contributes when time + competition bonuses confirm — never matches on name alone.
- **Tests that must pass:**
  - **Update** `tests/matching.test.js` → "DEFECT: containment heuristic over-matches contained names" to assert the **corrected** result: `calcTeamMatchScore('Mexico','New Mexico') < CONFIDENCE_THRESHOLD` (was `=== 80`), same for `('Arsenal','Arsenal Reserves')`, `('United','Manchester United')` (unless alias-covered), and `matchTeamPair({team1:'Mexico',team2:'USA'},'New Mexico','USA').confidence < 60`.
  - **Keep green:** "min-length guard catches short containment (York/New York)", "calcTeamMatchScore: exact, alias, containment, jaccard", "matchTeamPair: orientation detection", "distinct same-league teams stay below threshold", and all candidate-scoring/plan tests.
  - **Add (recommended):** a positive case proving a legitimate contained name still resolves via alias/Jaccard (e.g. a real abbreviation pair you intend to keep matching).
- **Regression risks:** **Medium.** `calcTeamMatchScore` is the core of all score matching; tightening it could drop *legitimate* containment matches (e.g. a provider listing "Barcelona" vs Torn "FC Barcelona") if those are not covered by the alias table or Jaccard. Mitigate by (1) running the full suite, (2) spot-checking a sample of real fixtures across sports, (3) preferring the "sub-threshold score" alternative if any legitimate match regresses.
- **Existing users / stored settings:** **No** stored-data impact. Pure in-memory matching logic; no settings, cache schema, or storage keys change. Users may see *fewer wrong scores* and, if over-tightened, occasionally a "Score not matched" where a loose match previously (sometimes wrongly) appeared.

---

## 3. L-2 — `SCRIPT_VERSION` constant disagrees with `@version`

- **Exact affected code:** `:68` `const SCRIPT_VERSION = '2.1.0';`; consumed by `buildDebugReport:659` (`version: SCRIPT_VERSION`). Header `@version 2.5.3` at `:4`.
- **Root cause:** version bumped in the metadata header but not in the constant.
- **Minimal correction:** derive at runtime: `const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '2.5.3';` — self-syncs on every future release; literal fallback keeps tests deterministic. (Simpler one-liner alternative: set the literal to `'2.5.3'`, but it will drift again.)
- **Tests that must pass:**
  - **Update** `tests/metadata.test.js` → "DEFECT: SCRIPT_VERSION constant disagrees with @version header" to assert agreement (constant === header, or that the report reflects `GM_info`). Note: the harness does not define `GM_info`; if you adopt the `GM_info` form, add a `GM_info` stub to `tests/load-userscript.js` (test tooling) **or** keep the literal-fallback path so the test stays green without GM.
  - **Keep green:** all other metadata tests.
- **Regression risks:** **Very low.** Only affects the debug-report string. If using `GM_info`, confirm it is granted/available (it is implicitly available in Tampermonkey; no `@grant` needed).
- **Existing users / stored settings:** **No** impact. Cosmetic to support reports only.

---

## 4. L-1 — `providerCache` / `enrichmentCache` never pruned

- **Exact affected code:** `providerCache.set` at `:1720`,`:1728` inside `fetchWithCache:1704`; `enrichmentCache.set` at `:1192` inside `getEnrichment:1189`. Declarations `:523`,`:524`.
- **Root cause:** neither Map has any `.delete`/`.clear`/sweep; entries persist for the page session.
- **Minimal correction:**
  - `providerCache`: at the top of `fetchWithCache` (or once per `refreshPanel`), drop entries whose `expiry < Date.now()`. A cheap in-place sweep:
    ```js
    for (const [k, v] of providerCache) if (v.expiry < now) providerCache.delete(k);
    ```
    Bound the cost by only sweeping when `providerCache.size` exceeds a threshold (e.g. 200).
  - `enrichmentCache`: after each `renderPanel`, drop keys not present in `latestRenderableMatches` (the only matches that can be re-read), or cap to a fixed size with FIFO/LRU eviction.
- **Tests that must pass:**
  - **Update** `tests/runtime.test.js` → "providerCache grows monotonically … NOT auto-pruned on expiry" and "enrichmentCache grows … never pruned" to assert the **new** eviction behavior (size shrinks after expiry sweep / cap). Keep the in-flight-cleanup and resolved-event-eviction tests green.
  - **Keep green:** all `tests/cache.test.js` (TTL hit/expiry, coalescing, error caching) — eviction must not break the within-TTL cache-hit path or the coalescing path.
- **Regression risks:** **Low–Medium.** The danger is evicting a *still-valid* entry, causing an extra refetch (functionally safe — a cache miss just re-fetches, which is already the cold path and is rate-limited by TTL on the next write). Do **not** evict `inFlightRequests` (would break coalescing) and do **not** evict unexpired `providerCache` entries (would defeat the 45 s rate-limit). Sweep expired-only.
- **Existing users / stored settings:** **No** stored-data impact — both Maps are in-memory only. No localStorage/GM schema changes.

---

## 5. N-2 — No request timeout; `ontimeout` is dead code

- **Exact affected code:** `gmFetchJson:955-976` and `gmFetchJsonWithMeta:988-1010` — the `GM_xmlhttpRequest({...})` option objects (`:957`, `:990`) have no `timeout` key; `ontimeout` handlers at `:973`,`:1007` are therefore unreachable. Score-lookup path (`findScoreForMatch:3465`) has no `withTimeout` wrapper (contrast enrichment `:4988`).
- **Root cause:** `timeout` option omitted, so Tampermonkey never fires `ontimeout`; a stalled socket can leave a per-key in-flight promise unsettled.
- **Minimal correction:** add a `timeout` to both option objects, e.g. `timeout: 12000`. This activates the existing `ontimeout` reject paths, which `fetchWithCache` already converts to a cached error shape (so the UI degrades gracefully and the in-flight entry is released). Optionally also wrap each provider call in `findScoreForMatch` with `withTimeout(…, 15000)` as defense-in-depth.
- **Tests that must pass:**
  - **Keep green:** `tests/cache.test.js` "a rejected fetch never leaks an in-flight entry" (the timeout reject must flow through the same cleanup) and the error-caching tests.
  - **Add (recommended):** a test asserting that a `gmFetch` timeout rejects with a `timeout` message and that `fetchWithCache` caches the safe empty shape and clears `inFlightRequests`. (The harness stubs `GM_xmlhttpRequest` as a no-op; to test this you would extend the stub to honor `timeout`/`ontimeout` — test tooling only.)
- **Regression risks:** **Low–Medium.** The real risk is a **timeout that is too short**, turning slow-but-valid provider responses into errors (cached as a miss for `TTL_ERROR = 15 s`). Choose a value comfortably above typical provider latency (12–15 s) and verify against the slowest provider (TheScore's windowed feed, BBC). Too-long is harmless (matches current behavior).
- **Existing users / stored settings:** **No** stored-data impact. Behavior change only: a hung request now fails fast and shows a provider error/fallback instead of silently never updating.

---

## 6. L-3 — `abbreviateSelection` leaks filler word + trailing space

- **Exact affected code:** `:3213-3222`, specifically the fallback `return clean.slice(0, 3).toUpperCase();` on `:3221`.
- **Root cause:** when filler-word filtering leaves <2 words, the fallback uses the **original** `clean` string, re-introducing the removed filler (`'FC Barcelona'` → `'FC '`).
- **Minimal correction:** fall back to the filtered remainder, trimmed:
  ```js
  const remainder = words.join(' ').trim() || clean;
  return remainder.slice(0, 3).toUpperCase();
  ```
  → `'FC Barcelona'` → `'BAR'`, `'The Rock'` → `'ROC'`.
- **Tests that must pass:**
  - **Update** `tests/odds-math.test.js` → "DEFECT: abbreviateSelection leaks filler word + trailing space" to assert the corrected output (`'BAR'`, `'ROC'`, no trailing space).
  - **Keep green:** `abbreviateBook` and all odds-row/commentary tests (this function only feeds label strings).
- **Regression risks:** **Very low.** Isolated pure function used only for odds-analysis row labels; no numeric or matching effect.
- **Existing users / stored settings:** **No** impact.

---

## 7. L-4 — `@homepage` `hhttps://` typo

- **Exact affected code:** `:24` `// @homepage     hhttps://greasyfork.org/en/scripts/583676-torn-bookie-live-scores`.
- **Root cause:** leading `h` typo → invalid URL scheme.
- **Minimal correction:** `// @homepage     https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores`.
- **Tests that must pass:**
  - **Update** `tests/metadata.test.js` → "DEFECT: @homepage has a 'hhttps' typo" to assert a valid `https://` homepage.
  - **Keep green:** "required metadata directives are present", `@match`/`@grant`/`@connect` tests.
- **Regression risks:** **None.** Metadata only; does not affect execution. Note: editing the metadata block is the kind of change that should be released as a normal version bump (Greasy Fork re-parses the header).
- **Existing users / stored settings:** **No** impact (the userscript manager just shows a working Homepage link after update).

---

## 8. L-5 — README references a non-existent filename

- **Exact affected code:** `README.md:16` ("Open `Live_Scores_Panel.js`."); also `README.md:2` calls the panel by a different name.
- **Root cause:** doc drift; actual file is `Torn_Bookie_Live_Scores.js`.
- **Minimal correction:** update the README install step to `Torn_Bookie_Live_Scores.js` (and reconcile the name on line 2).
- **Tests that must pass:** none (documentation). Keep all 149 green (unaffected).
- **Regression risks:** **None** (not code).
- **Existing users / stored settings:** **No** impact.

---

## 9. Conditional item — B-1 (status filtering) — NOT yet actionable

- **Exact affected code:** `extractLiveBets:1928-1935`, `extractUpcomingBets:1937-1945` (filter `status==='inprogress'` / `'notstarted'`).
- **Why not yet:** dropping non-standard statuses is only a *problem* if Torn actually emits them for held bets — which cannot be confirmed without a live payload. Acting now risks surfacing rows the panel cannot render correctly or breaking the clean live/upcoming split.
- **Trigger to act:** capture a real `sid=bookieApi` `your-bets` payload showing a status other than `inprogress`/`notstarted`. Then decide whether to add a "Other/!" bucket or map specific statuses (e.g. `postponed`→upcoming with a badge). Until then, leave as-is; `tests/states.test.js` "BEHAVIOR: only inprogress->live and notstarted->upcoming survive" documents the current contract.

---

## 10. Out of scope (deliberately excluded)

| ID | Why excluded |
|---|---|
| B-2 (delayed/abandoned/suspended not in status sets) | By-design; no wrong result, only a minor "not marked final." Add tokens only if a real payload warrants it. |
| I-1 (esports short-labels exact-token only) | Intentional guard against substring false positives (`lol`⊂`Holloway`); Torn carries full game names. |
| I-2 (upcoming single-date near midnight) | Self-heals once live; widening adds requests for marginal gain. |
| I-3 (bare-ISO rejection) | Intentional safety; Torn supplies epochs. |
| I-4 (45 s live-update cap) | Deliberate rate-limit protection; a UI note is a product decision, not a bug fix. |
| I-5 (`unsafeWindow` patching) | Required for data capture; correctly guarded; already disclosed. |

---

## 11. Pre-flight for any of the above

1. Branch off `main`; do **not** touch `Torn_Bookie_Live_Scores.js` until a change is approved.
2. Per fix: apply the minimal change, **update the matching characterization test** to assert the corrected behavior, then run `node --test tests/*.test.js` — **all 149 must pass** (the flipped test now green proves the fix).
3. Re-run the stability sweep (10× sequential + shuffled + concurrent) before considering any change done.
4. For M-1 and N-2 (the two that change live behavior), also do a manual smoke test on `https://www.torn.com/page.php?sid=bookie` with real bets before release.
5. Bump `@version` (and `SCRIPT_VERSION`) on release; metadata edits (L-2, L-4) ship as part of that bump.
