# Overnight Audit — Torn Bookie Live Scores

**Date:** 2026-06-20
**Branch:** `claude/overnight-audit`
**Production source audited:** `Torn_Bookie_Live_Scores.js` (7,108 lines, ~408 KB), userscript `@version 2.5.3`
**Auditor:** automated production-readiness pass (read-only on production code; tests/fixtures/report added only)

> **Scope note / discrepancy:** The task brief named `FINAL.user.js` as the production source. **No file by that name exists in the repository.** The repository's single userscript is `Torn_Bookie_Live_Scores.js`, which is unambiguously the production artifact (it carries the `==UserScript==` metadata block and the Greasy Fork `@homepage`/`@supportURL`). I treated `Torn_Bookie_Live_Scores.js` as the production source and **did not modify it or any other pre-existing file.** If `FINAL.user.js` is a separate, not-yet-committed artifact, this audit does not cover it.

---

## 1. Executive summary

The userscript is a mature, defensively-written single-file Tampermonkey script that overlays a live/upcoming bet panel on Torn's bookie page and enriches it with scores from several public sports providers (plus optional BYOK odds/esports). Code quality is high: HTML output is consistently escaped, secrets are redacted from debug reports, network scope is tightly constrained, and the matching/date logic is factored into clearly-marked "core" regions that are obviously designed to be unit-tested (`DATE_MATCHING_CORE_*`, `ODDS_ANALYSIS_CORE_*`, plus an in-code reference to a `tests/odds-math.test.js` that did not exist).

**No Critical or High severity defects were found.** Security posture is good: no XSS reachable through provider/team data, no prototype-pollution via settings, `@connect`/`@match`/`@grant` are minimal and complete, and the debug report scrubs keys, tokens, account data, and Windows user paths.

The findings are concentrated in **correctness edge cases and hygiene**: a team-name matching heuristic that over-matches "contained" names (and whose inline comment claims a guarantee it does not provide), a cosmetic abbreviation bug, three pieces of stale/typo'd metadata (version constant, homepage URL, README filename), unbounded growth of three in-memory caches over very long sessions, and several documented design limitations around timezone boundaries and esports detection.

A new, dependency-free test harness runs the **real production file** inside a `vm` sandbox (mocked clock/storage/DOM/network) and exercises 130 deterministic tests. The harness injects its export hook **in memory only**; the file on disk is never written. All 130 tests pass, and pass identically across 10 sequential runs, 6 shuffled-order runs, and 3 high-concurrency runs (no ordering or state-leakage sensitivity).

**Top recommendations**

1. Fix the containment matching guard (Finding **M-1**) — the only finding with real user-visible impact (wrong scores on reserve/"New X" fixtures).
2. Sync `SCRIPT_VERSION` to `@version` (Finding **L-1**) — otherwise support/debug reports show the wrong version.
3. Add periodic eviction/size-caps to `providerCache`/`enrichmentCache`/`resolvedEventCache` (Finding **L-4**).

---

## 2. Architecture summary

**Entry / lifecycle.** IIFE at `@run-at document-start`. On load it installs network interceptors, registers global `error`/`unhandledrejection` listeners, loads settings from `localStorage`, then `whenBodyReady()` builds the panel and schedules the first `refreshPanel()` (1.5 s) and the refresh interval (`30s` default).

**Data capture (interception).** `Torn_Bookie_Live_Scores.js:889-942` wraps `pageWindow.fetch` and `XMLHttpRequest.prototype.open/send` on the page realm (`unsafeWindow`). Only responses whose URL `includes('sid=bookieApi')` are parsed; the parsed JSON is stashed in module memory (`capturedBookieData`) and a debounced (250 ms) `refreshPanel()` is triggered. No bet/account data leaves the browser.

**Bet extraction.** `getYourBetsMatches` → `extractLiveBets`/`extractUpcomingBets` filter the `your-bets` box by `status` (`inprogress`/`notstarted`), drop excluded sports (horse racing) and per-sport-disabled sports, then `normalizeBetMatch` flattens each into a stable internal shape (teams from `ep[0]/ep[1]`, summed bet `amount`, derived `sportKey`/`sourceKey`).

**Provider routing & score fetch.** `chooseScoreSource` + `getProviderPriority` produce an ordered, enable-gated, sport-supported provider list. `findScoreForMatch` (`:3465`) tries each provider in turn, returning the first confident match. Per provider a **lookup plan** of provider-formatted dates is built (`buildSofascoreLookupPlan`, `buildDateBucketPlan`, `buildTheScorePlan`, `buildPandaScorePlan`, `buildNhlScorePlan`) with live/multi-day widening; `resolveProviderMatch` fetches each step, dedupes candidates, scores them (`scoreCandidate`), and selects the best (`selectBestCandidate`) with an ambiguity guard.

**Matching.** `calcTeamMatchScore` (exact → alias table → containment → Jaccard) feeds `matchTeamPair`/`scoreTeamOrientation` (both teams must clear `CONFIDENCE_THRESHOLD = 60`, orientation = `min(home,away)`). `scoreCandidate` adds time-window compatibility (live 36 h / upcoming 12 h / cricket multi-day), competition compatibility, status, and anchor/offset bonuses; acceptance ≥ 75.

**Caching / coalescing.** `fetchWithCache` (`:1704`) keys by request, serves within TTL (`45 s` success / `15 s` error), coalesces concurrent identical requests via `inFlightRequests`, and caches a safe empty shape on error. `resolvedEventCache` remembers a provider's matched event id (5 min active / 2 min final) and invalidates on team-identity change or >1 h start drift. `enrichmentCache` holds per-match detail-pane enrichment.

**Dates/timestamps.** `normalizeTimestampMs` accepts epoch s/ms and *timezone-qualified* ISO only, bounded to 2000–2100. Provider date strings are formatted in **UTC** (`formatProviderDate`); day offsets use UTC arithmetic (`addUtcDays`, `startOfUtcDay`). DOM "Due to start at…" text is parsed by `parseSelectedGameStartTimestamp` (this path uses local-time `new Date(y,m,d,…)`).

**UI / DOM.** Render functions are pure string builders (`renderScoreboard`, `renderLiveMatch`, `renderUpcomingMatch`, `renderSportGroups`, details pane) writing through `innerHTML`; **all dynamic values pass `escapeHtml`**. `getOrCreatePanel` recreates the panel if Torn's SPA removes it; listeners are re-bound on each `rerenderPanel`. Timers are singletons (cleared before re-set).

**Error recovery.** `refreshPanel` wraps everything in try/catch → `renderError`. Provider exceptions are caught per-provider and folded into a diagnostic string. A debug report (`buildDebugReport`) captures sanitized state for support.

---

## 3. Commands executed

All commands run from the repository root on Windows (Node v24.16.0, npm 11.13.0). Tests force `TZ=UTC` (set inside the harness) for deterministic local-time parsing.

| Command | Purpose |
|---|---|
| `node --check Torn_Bookie_Live_Scores.js` | Syntax validation of production source — **OK** |
| `node --test tests/*.test.js` | Run full suite — **130 pass / 0 fail** |
| `node --test --test-concurrency=1 tests/*.test.js` (×10) | Sequential repeat — stable 111→130 pass each run |
| `node --test <shuffled file order>` (×6) | Ordering independence — 130 pass each |
| `node --test --test-concurrency=8 tests/*.test.js` (×3) | Concurrency stress — 130 pass each |
| `node -e` probes | Empirical evidence-gathering for findings |
| `git diff --stat` / `git status --porcelain` | Confirm production code untouched |

No existing test/lint/build tooling was present in the repository (no root `package.json`, no `node_modules`, no CI config, no ESLint/Prettier config). A dev-only `tests/package.json` (zero dependencies; uses Node's built-in test runner) was added to provide `npm --prefix tests test`, `npm --prefix tests run test:syntax`, and `npm --prefix tests run test:repeat`.

---

## 4. Tests created and coverage obtained

**Harness:** `tests/load-userscript.js` reads the production file, injects (in memory only) `globalThis.__TBLS__ = { …internal functions/state… }` immediately before the IIFE's closing `})();`, and runs it in a `vm` context with mocked globals: a **controllable clock** (`MockDate`, default now = `2026-06-20T12:00:00Z`, `__control.setNow(ms)`), in-memory `GM_*` + `localStorage`, a stubbed `window`/`document`/`XMLHttpRequest`, and no-op timers (so the bootstrap never builds DOM or schedules real work). `__resetCaches()` clears the shared Maps between tests. **The production file is never modified on disk** (verified: `git diff --stat` empty).

`tests/fixtures.js` provides UTC-anchored sample data shaped like real Torn bookie + Odds API payloads.

| Test file | Tests | Area covered |
|---|---:|---|
| `tests/odds-math.test.js` | 19 | implied-prob/EV/no-vig conversions, best-price, ML/spread/total row building, 3-way skip, commentary, **abbreviateSelection defect** |
| `tests/dates.test.js` | 17 | timestamp normalization, ISO tz requirement, UTC provider-date formatting, **midnight & month-boundary rollovers**, livescore compact parse, DOM date-text parse |
| `tests/matching.test.js` | 17 | name normalization, alias/containment/Jaccard scoring, orientation, **containment over-match defect (M-1)**, candidate scoring, **ambiguous-match guard**, dedup |
| `tests/plans.test.js` | 11 | lookup-plan builders: upcoming vs live, adjacent fallback, **multi-day cricket**, invalid-anchor recovery, TheScore/Panda/NHL windows |
| `tests/providers.test.js` | 11 | esports detection (+short-alias strictness), excluded sports, sport routing, ESPN keys, provider support/priority, runtime toggles |
| `tests/cache.test.js` | 10 | TTL hit/expiry, **request coalescing**, error caching + safe shape, **no in-flight leak on reject**, resolved-event TTL/team-change/drift invalidation |
| `tests/security.test.js` | 12 | escapeHtml, **prototype-pollution resistance**, secret/token/bearer/path redaction, depth/sensitive-key scrubbing, https-only URL allowlist, ESPN deep-link safety |
| `tests/bookie-extract.test.js` | 10 | usable-data detection, malformed/empty/missing-field tolerance, amount coercion, live/upcoming filtering, grouping/sort |
| `tests/render-states.test.js` | 11 | headless UI states (live/completed/delayed/upcoming/empty/error/unmatched), **XSS-safety across styles**, **render idempotency (no duplication)** |
| `tests/metadata.test.js` | 8 | required directives, **@match scope**, **@grant minimality**, **@connect completeness/no-wildcards**, interception marker, **version & homepage defects** |
| `tests/state-leakage.test.js` | 4 | repeated stateful cycles, clock determinism, extraction stability |
| **Total** | **130** | |

**Coverage character.** Coverage is **behavioral over the isolatable pure/stateful logic** (matching, dates, odds math, caching, extraction, routing, sanitization, render strings, metadata). Not covered (see §10): live network I/O, real GM/DOM integration, Tampermonkey runtime, CSS/visual layout, and the large stateful UI orchestration functions (`getOrCreatePanel`, `rerenderPanel`, `updateDetailsPanel`) which require a real DOM.

---

## 5. Findings

Severity legend: **Critical** (data loss / security breach / crash) · **High** (wrong results commonly) · **Medium** (wrong results in plausible cases) · **Low** (minor/cosmetic/hygiene) · **Informational** (design note / limitation).

> No Critical or High findings.

### M-1 (Medium) — Containment matcher over-matches "contained" team names; inline comment is false

- **Location:** `Torn_Bookie_Live_Scores.js:1270-1276` (`calcTeamMatchScore`, containment branch).
- **Evidence (test `tests/matching.test.js` → "DEFECT: containment heuristic over-matches contained names"):**
  `calcTeamMatchScore('Mexico','New Mexico') === 80`, `('Arsenal','Arsenal Reserves') === 80`, `('United','Manchester United') === 80`, and the full pair `matchTeamPair({team1:'Mexico',team2:'USA'},'New Mexico','USA').confidence === 80`. All are ≥ `CONFIDENCE_THRESHOLD (60)`.
- **Reproduction:** `node -e "const a=require('./tests/load-userscript').loadUserscript(); console.log(a.calcTeamMatchScore('Mexico','New Mexico'))"` → `80`.
- **Root cause:** The guard requires *both* normalized names ≥ 5 chars, then returns 80 if the longer `includes` the shorter. A 6-char name fully contained in a longer one (`mexico` ⊂ `new mexico`, `arsenal` ⊂ `arsenal reserves`) still scores 80. The inline comment claims this exact case is *prevented* — `// Containment ... (prevents "mexico" matching "new mexico")` — which is incorrect.
- **Impact:** On match days where a club's senior, reserve, and youth sides (or "New X" vs "X") play, the panel can attach the **wrong fixture's score** to a bet with 80 confidence. Both sides must be containment matches for a full mismatch, which is realistic for reserve-vs-reserve fixtures.
- **Recommended correction:** Require the contained token to be a *whole-word boundary* match and/or require the length delta to be small (e.g. reject when the longer name has an extra leading word like "new"/"reserves"/"u21"); or lower the containment score below threshold and rely on competition/time compatibility to re-confirm. Update the comment to match real behavior.

### L-1 (Low) — `SCRIPT_VERSION` constant (`2.1.0`) disagrees with `@version` (`2.5.3`)

- **Location:** `@version` at `Torn_Bookie_Live_Scores.js:4` vs `const SCRIPT_VERSION = '2.1.0'` at `:68`.
- **Evidence (test `tests/metadata.test.js` → "DEFECT: SCRIPT_VERSION constant disagrees…"):** header = `2.5.3`, constant = `2.1.0`.
- **Impact:** `buildDebugReport` (`:667`) reports `version: SCRIPT_VERSION`, so every user-submitted debug report shows `2.1.0` regardless of the installed version — actively misleads support/triage.
- **Root cause:** Version bumped in the metadata header but not in the constant (and likely meant to be derived from `GM_info.script.version`).
- **Recommended correction:** Set `SCRIPT_VERSION` from `GM_info?.script?.version` with a literal fallback, or update the literal on each release.

### L-2 (Low) — `abbreviateSelection` leaks filler word + trailing space

- **Location:** `Torn_Bookie_Live_Scores.js:3213-3222`.
- **Evidence (test `tests/odds-math.test.js` → "DEFECT: abbreviateSelection leaks filler word…"):** `abbreviateSelection('FC Barcelona') === 'FC '` (trailing space), `('The Rock') === 'THE'`. Expected something like `BAR`/`ROC`.
- **Root cause:** When the filler-word filter (`the|fc|sc|cf|of|and|&`) removes all-but-one word, `words.length < 2`, so it falls back to `clean.slice(0,3)` of the **original** string — re-introducing the filler it just removed.
- **Impact:** Cosmetic only — odds-analysis row labels show `FC ` / `THE` instead of the team abbreviation. No effect on numbers or matching.
- **Recommended correction:** Fall back to `words.join(' ').slice(0,3)` (the filtered remainder) instead of the original `clean`, and `.trim()` the result.

### L-3 (Low) — `@homepage` URL has a `hhttps://` typo

- **Location:** `Torn_Bookie_Live_Scores.js:24`.
- **Evidence (test `tests/metadata.test.js` → "DEFECT: @homepage has a 'hhttps' typo"):** value starts with `hhttps://`.
- **Impact:** The userscript-manager "Homepage" link is broken (invalid scheme). `@supportURL` (`:25`) is correct, so feedback still works.
- **Recommended correction:** `@homepage https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores`.

### L-4 (Low) — Long-lived caches are never pruned (slow unbounded growth)

- **Location:** `providerCache` set at `:1720`/`:1728`, `enrichmentCache` set at `:1192`, `resolvedEventCache` set at `:1601`. Only `resolvedEventCache` ever deletes (on expired *access*, `:1622`); `providerCache` and `enrichmentCache` have **no eviction path** (verified by grep: zero `.delete`/`.clear` on those two).
- **Evidence:** Source grep shows `providerCache.set`/`enrichmentCache.set` with no corresponding delete/prune; `fetchWithCache` overwrites by key but never removes expired keys.
- **Impact:** For a Bookie tab left open for hours/days with auto-refresh, the Maps accumulate one entry per distinct `(match × provider × date-window)` key and per distinct match-key. Entries are small, so this is slow, but growth is monotonic for the session. Low severity.
- **Recommended correction:** Add a lightweight sweep (drop entries past `expiry`) on each `refreshPanel`, or cap each Map with simple LRU eviction.

### L-5 (Low) — README install step references a non-existent filename

- **Location:** `README.md:16` ("Open `Live_Scores_Panel.js`.").
- **Evidence:** `grep -n` shows the README points users at `Live_Scores_Panel.js`; the actual file is `Torn_Bookie_Live_Scores.js` (and `README.md:2` separately calls the panel by a third name).
- **Impact:** New installers following the README look for a file that isn't there. Documentation only.
- **Recommended correction:** Update the README to `Torn_Bookie_Live_Scores.js`.

### I-1 (Informational) — Esports detection misses short-form competition labels

- **Location:** `detectEsportsGameKey` `:1739-1766` + `ESPORTS_GAME_PATTERNS` `:421`.
- **Evidence (tests in `tests/providers.test.js`):** `detectEsportsGameKey({competition:'CS2 Major'}) === ''` and `({stage:'LoL Worlds'}) === ''`. Short aliases (`cs2`, `lol`, ≤3 chars) only match as an *exact* token (a deliberate guard against substring false-positives like `lol`⊂`Holloway`), so `"CS2 Major"`/`"LoL Worlds"` are not recognized via stage/competition.
- **Impact:** Low — Torn usually carries the full game name in `sport` (e.g. `Counter-Strike`), which *is* detected; only matches labeled solely with a short-form competition string are missed. Trade-off is intentional (avoids false positives).
- **Recommended correction (optional):** Allow short aliases to match as whole words within multi-word strings (word-boundary regex) rather than exact-only.

### I-2 (Informational) — Upcoming (non-global) matches near a UTC day boundary query only one provider date

- **Location:** `buildDateBucketPlan` `:2009-2027`; `buildSofascoreLookupPlan` `:2004-2006`.
- **Detail:** For non-live, non-"global-date" upcoming matches, the plan is the single UTC anchor day (no ±1 widening). A match at, say, `23:30Z` may be listed by a provider under the next/previous *local* calendar day. Live matches and global-date sports (cricket/tennis/rugby/badminton) *do* widen by ±1 day, so the practical gap is upcoming non-global sports near midnight UTC.
- **Impact:** Low/occasional missed pre-game match; self-heals once the match goes live (live widening kicks in).
- **Recommended correction (optional):** Widen upcoming plans by ±1 day when the anchor is within ~2 h of a UTC midnight.

### I-3 (Informational) — ISO timestamps without an explicit timezone are rejected

- **Location:** `normalizeTimestampMs:1335-1340`.
- **Evidence (test `tests/dates.test.js`):** `'2026-06-20T19:30:00Z'` → parsed; `'2026-06-20T19:30:00'` (no tz) and `'2026-06-20'` → `null`.
- **Impact:** Intentional and safe (avoids ambiguous local interpretation). Torn supplies numeric epochs, so this is not hit in practice. Documented so future provider integrations don't assume bare-ISO support.

### I-4 (Informational) — Live score refresh is capped by the 45 s success TTL

- **Location:** `TTL_SUCCESS = 45000` (`:94`) applied in `fetchWithCache`.
- **Detail:** With the `10s` refresh option selected, live provider scores still update at most every ~45 s (cache TTL), because the panel re-reads the cached provider response. This is a deliberate rate-limit protection but may surprise a user who expects 10 s live updates.
- **Recommended correction (optional):** Use a shorter success TTL for matches detected as live, or document the cap in the refresh UI.

### I-5 (Informational) — Page-realm prototype patching via `unsafeWindow`

- **Location:** `:889-942` (overrides `fetch` and `XMLHttpRequest.prototype.open/send` on `unsafeWindow`).
- **Detail:** Necessary to capture Torn's bookie API (which the page fetches itself). It is invasive (mutates the page's intrinsics) and could theoretically conflict with other scripts or future Torn changes, but it is correctly guarded (`sid=bookieApi` only), preserves originals, and never blocks/alters the page's traffic. No action required; noted for completeness and Torn-PDA incompatibility (already disclosed in `@description`).

### Positive confirmations (audited, no defect)

- **No XSS:** every provider/team/venue/standing/commentary string is `escapeHtml`-ed before `innerHTML` (`tests/security.test.js`, `tests/render-states.test.js`); URLs are gated by an https-only host allowlist (`safeExternalSourceUrl`).
- **No prototype pollution:** `deepMergeSettings` uses object spread (own-property copy, no setter invocation); `{"__proto__":…}` from `localStorage` does **not** pollute `Object.prototype` (`tests/security.test.js`).
- **Privacy/redaction:** debug report scrubs api keys, bearer tokens, stored secrets, `amount`/`bets`/`tornId` keys, cookies, and Windows user paths; caps depth and array sizes (`tests/security.test.js`).
- **`@connect`/`@match`/`@grant`:** minimal and complete — `@match` is bookie-page-scoped (no `<all_urls>`), grants are exactly those used, and every fetched API host has a matching wildcard-free `@connect` (`tests/metadata.test.js`).
- **Request hygiene:** TTL caching + in-flight coalescing prevent duplicate requests; a rejected fetch never leaks an in-flight entry; errors are cached with a short TTL and a safe empty shape (`tests/cache.test.js`).
- **Render idempotency:** repeated rendering of the same match yields byte-identical markup with exactly one row/details button — no duplication on refresh (`tests/render-states.test.js`).

---

## 6. Remaining uncertainties and environmental limitations

- **`FINAL.user.js` not present** — the named production file does not exist; audit targets `Torn_Bookie_Live_Scores.js` (see top note).
- **No browser / real DOM** — there is no preview HTML or dev harness in the repo. UI was exercised *headlessly* via the pure render functions; the stateful orchestration (`getOrCreatePanel`, `rerenderPanel`, `updateDetailsPanel`, event-binding, CSS, visual layout, and "console has no errors" in a real page) was **not** executed. Manual verification on `https://www.torn.com/page.php?sid=bookie` with Tampermonkey is still recommended.
- **No live network** — provider response *parsing/mapping* paths (`sofascoreHeaders`, `pandaScoreMatchUrl`, `findNhlGame`, full `resolveProviderMatch` against real payloads) were not hit against live APIs; tests mock at the candidate/`fetchWithCache` boundary. Real provider schema drift (the source's dated `// excluded … 404 as of 2026-06-20` comments) is unverifiable offline.
- **Cross-realm equality** — `vm`-context objects carry the sandbox realm's prototypes, so structural assertions use JSON value-equality rather than `deepStrictEqual` (documented in the harness).
- **Timezone** — tests force `TZ=UTC` so the one local-time path (`buildSelectedStartTimestamp`) is deterministic; behavior on other host timezones for that DOM-text path was not swept.
- **Tampermonkey/Greasy Fork runtime** — `@match`-with-query relies on Tampermonkey's lenient match handling (query strings are outside the standard match-pattern spec); not validated on Greasemonkey/Violentmonkey.

---

## 7. Final test results

```
node --check Torn_Bookie_Live_Scores.js      → OK (syntax valid)

node --test tests/*.test.js
  ℹ tests 130
  ℹ pass 130
  ℹ fail 0
  ℹ duration_ms ~200

Stability:
  10× sequential (concurrency=1) → 130 pass / 0 fail each
   6× shuffled file order        → 130 pass / 0 fail each
   3× concurrency=8              → 130 pass / 0 fail each
```

Per-file: odds-math 19 · dates 17 · matching 17 · security 12 · plans 11 · providers 11 · render-states 11 · bookie-extract 10 · cache 10 · metadata 8 · state-leakage 4.

All created tests pass. Tests marked `DEFECT:` are **characterization tests** that pin the *actual* (buggy) behavior so each finding has a green, reproducible evidence anchor and any future fix will flip the test (signaling the regression is resolved). No production code was changed to make any test pass.

---

## 8. Final git status and diff summary

```
Branch: claude/overnight-audit
git diff --stat (tracked files): <empty>   ← production source unchanged

Untracked (added by this audit only):
  ?? test-docs/OVERNIGHT_AUDIT.md
  ?? tests/package.json      (dev-only; zero dependencies)
  ?? tests/                  (harness + fixtures + 11 *.test.js)
       tests/load-userscript.js   tests/fixtures.js
       tests/odds-math.test.js     tests/dates.test.js
       tests/matching.test.js      tests/plans.test.js
       tests/providers.test.js     tests/cache.test.js
       tests/security.test.js      tests/bookie-extract.test.js
       tests/render-states.test.js tests/state-leakage.test.js
       tests/metadata.test.js
```

The diff contains **only** the audit report, tests, fixtures, and dev test-tooling (`tests/package.json`). `Torn_Bookie_Live_Scores.js` and all other pre-existing files are byte-for-byte unchanged (`git diff --stat` empty; `git status` shows the production file untracked-as-modified = false). No commits, pushes, PRs, publishes, Greasy Fork changes, or external network writes were performed.

### Dev dependencies added

**None.** Testing uses Node's built-in `node:test`, `node:assert`, and `node:vm`. The added `tests/package.json` declares an empty `devDependencies` and only convenience scripts (`test`, `test:syntax`, `test:once`, `test:repeat`). No runtime dependencies were added to the userscript.
