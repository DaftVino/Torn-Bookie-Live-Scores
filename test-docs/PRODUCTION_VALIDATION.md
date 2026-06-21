# PRODUCTION VALIDATION — Torn Bookie Live Scores

**Date:** 2026-06-20
**Branch:** `claude/overnight-audit`
**Production source validated:** `Torn_Bookie_Live_Scores.js` (7,108 lines, ~408 KB), userscript `@version 2.5.3`
**Validation type:** read-only production-readiness pass. Production code was **not modified**; a separate audit + test layer was added.

> **Scope discrepancy (unchanged from prior pass).** The brief names `FINAL.user.js` as the production file. **No file by that name exists in this repository.** The only userscript present is `Torn_Bookie_Live_Scores.js`, which carries the `==UserScript==` block (`:1-27`) and is unambiguously the production artifact. It was treated as the production source and left byte-for-byte unchanged (empty `git diff HEAD`). If `FINAL.user.js` is a separate, uncommitted file, this validation does not cover it.

Companion reports: **test-docs/ARCHITECTURE.md**, **test-docs/NETWORK_AUDIT.md**, **test-docs/RUNTIME_AUDIT.md**, **test-docs/SECURITY_AUDIT.md**. A `test-docs/FIX_PLAN.md` (ranking + remediation plan) accompanies this report per the follow-up request.

---

## 1. Executive summary

The userscript is a mature, defensively-written single-file Tampermonkey script that overlays a live/upcoming bet panel on Torn's bookie page and enriches it with scores from several public sports providers (plus optional BYOK odds/esports). Code quality is high: HTML output is consistently escaped, secrets are redacted from debug reports, network scope is tightly constrained (`@connect` allowlist, GET-only, no telemetry), provider fallback is bounded with no retry storms, and the matching/date/odds logic is factored into clearly-marked, unit-testable "core" regions.

**No Critical or High severity defects were found.** The findings concentrate in **correctness edge cases and hygiene**: one team-name matching heuristic that over-matches "contained" names (with a false inline comment), two unbounded in-memory caches (slow session memory growth), a cosmetic abbreviation bug, three pieces of stale/typo'd metadata/docs, one plausible (browser-dependent) network-stall risk from a missing request timeout, and several documented design limitations (status filtering, midnight boundaries, esports short-labels, the 45 s live-update cap).

A dependency-free harness runs the **real production file** inside a `vm` sandbox (mocked clock/storage/DOM/network) and exercises **149 deterministic tests**. All 149 pass, and pass identically across **10 sequential, 6 shuffled-order, 3 concurrent, and 13 isolated** executions — no order dependence, state leakage, or flakiness. The harness injects its export hook **in memory only**; the file on disk is never written (verified: empty `git diff`).

**Top recommendations:** (1) fix the containment matching guard (**M-1**, only finding with real user-visible impact); (2) sync `SCRIPT_VERSION` to `@version` (**L-2**); (3) add eviction to the two unpruned caches (**L-1**); (4) set a `timeout` on `GM_xmlhttpRequest` (**N-2**).

---

## 2. Commands executed (all recorded)

Repo root, Windows, Node v24.16.0. The harness forces `TZ=UTC` internally for deterministic local-time parsing.

| # | Command | Purpose | Result |
|---|---|---|---|
| 1 | `node --check Torn_Bookie_Live_Scores.js` | syntax validation | **OK** |
| 2 | `node --test tests/*.test.js` | full suite | **149 pass / 0 fail** |
| 3 | `node --test --test-concurrency=1 tests/*.test.js` ×10 | sequential repeat | 149/149 each (×10) |
| 4 | `node --test --test-concurrency=1 <shuffled order>` ×6 | order independence | 149/149 each (×6) |
| 5 | `node --test tests/*.test.js` ×3 (default concurrency) | race detection | 149/149 each (×3) |
| 6 | `node --test tests/<single>.test.js` ×13 | isolation / leak detection | per-file pass, Σ = 149 |
| 7 | `git diff HEAD -- Torn_Bookie_Live_Scores.js` | confirm prod untouched | **empty** |
| 8 | `git status --porcelain` / `git diff --stat` | confirm tracked files unchanged | only untracked additions |

### Raw repeat-run log
```
10× sequential (concurrency=1): runs 1-10  → tests 149 / pass 149 / fail 0   (each)
 6× shuffled file order        : shuffles 1-6 → tests 149 / pass 149 / fail 0 (each)
 3× default concurrency        : runs 1-3   → tests 149 / pass 149 / fail 0   (each)
13× per-file isolation         : Σ pass = 149 / fail 0
```

---

## 3. Test inventory (149 tests)

| File | Tests | Area | New? |
|---|---:|---|---|
| `tests/odds-math.test.js` | 19 | implied-prob/EV/no-vig, best-price, ML/spread/total rows, 3-way skip, commentary, **abbreviateSelection defect** | |
| `tests/dates.test.js` | 17 | timestamp normalization, ISO-tz requirement, UTC provider dates, **midnight/month rollovers**, livescore/DOM date parse | |
| `tests/matching.test.js` | 17 | name normalization, alias/containment/Jaccard, orientation, **containment over-match (M-1)**, candidate scoring, **ambiguity guard**, dedup | |
| `tests/states.test.js` | 15 | **status: delayed/postponed/suspended/abandoned/cancelled**, **section filtering**, **multi-live**, **provider fallback**, **HTTP/429/timeout/parser/ambiguous labels**, **stale/corrupted cache**, **reload-during-match** | **✔** |
| `tests/security.test.js` | 12 | escapeHtml, **prototype-pollution resistance**, secret/token/bearer/path redaction, depth/key scrubbing, https-only allowlist, ESPN deep-link safety | |
| `tests/cache.test.js` | 10 | TTL hit/expiry, **coalescing**, error caching + safe shape, **no in-flight leak**, resolved-event TTL/team-change/drift invalidation | |
| `tests/bookie-extract.test.js` | 10 | usable-data detection, malformed/empty tolerance, amount coercion, live/upcoming filtering, grouping/sort | |
| `tests/plans.test.js` | 11 | lookup-plan builders: upcoming vs live, adjacent fallback, **multi-day cricket**, invalid-anchor recovery, TheScore/Panda/NHL windows | |
| `tests/providers.test.js` | 11 | esports detection (+short-alias strictness), excluded sports, routing, ESPN keys, provider support/priority, runtime toggles | |
| `tests/render-states.test.js` | 11 | headless UI states (live/completed/delayed/upcoming/empty/error/unmatched), **XSS-safety across styles**, **render idempotency** | |
| `tests/metadata.test.js` | 8 | required directives, **@match scope**, **@grant minimality**, **@connect completeness/no-wildcards**, interception marker, **version & homepage defects** | |
| `tests/runtime.test.js` | 4 | **in-flight cleanup**, **providerCache/enrichmentCache unbounded growth**, **resolvedEventCache self-eviction** | **✔** |
| `tests/state-leakage.test.js` | 4 | repeated stateful cycles, clock determinism, extraction stability | |
| **Total** | **149** | | |

**Pass/fail totals: 149 pass / 0 fail / 0 skipped / 0 todo.** Tests prefixed `DEFECT:` or `BEHAVIOR:` are **characterization tests** that pin the *actual* current behavior so each finding has a green, reproducible anchor; a future fix will flip them. No production code was changed to make any test pass.

**Coverage character:** behavioral over the isolatable pure/stateful logic (matching, dates, odds math, caching, extraction, routing, sanitization, render strings, provider fallback, status classification, metadata). Not covered (see §6): live network I/O, real GM/DOM integration, the large stateful UI orchestration functions, and visual/CSS layout.

---

## 4. Findings

Severity legend: **Critical** (data loss / security breach / crash) · **High** (wrong results commonly) · **Medium** (wrong results in plausible cases) · **Low** (minor/cosmetic/hygiene) · **Informational** (design note / limitation / plausible risk).

> **No Critical or High findings.**

### CONFIRMED BUGS (code-path evidence + reproducible test)

#### M-1 (Medium) — Containment matcher over-matches "contained" team names; inline comment is false
- **Location:** `Torn_Bookie_Live_Scores.js:1270-1276` (`calcTeamMatchScore`, containment branch).
- **Root cause:** Guard requires both normalized names ≥ 5 chars, then returns **80** if the longer `includes` the shorter. A ≥6-char name fully contained in a longer one (`mexico` ⊂ `new mexico`, `arsenal` ⊂ `arsenal reserves`, `united` ⊂ `manchester united`) scores 80 ≥ `CONFIDENCE_THRESHOLD (60)`. The comment at `:1270` claims this exact case is *prevented* — it is not.
- **Evidence (test `tests/matching.test.js`):** "DEFECT: containment heuristic over-matches contained names" — `calcTeamMatchScore('Mexico','New Mexico') === 80`; `matchTeamPair({team1:'Mexico',team2:'USA'},'New Mexico','USA').confidence === 80`. (A separate test confirms the <5-char case *is* guarded: `York`/`New York` falls through to Jaccard.)
- **Reproduction:** `node -e "console.log(require('./tests/load-userscript').loadUserscript().calcTeamMatchScore('Mexico','New Mexico'))"` → `80`.
- **Impact:** On match days with senior/reserve/youth or "New X" vs "X" fixtures, the panel can attach the **wrong fixture's score** at 80 confidence (when *both* teams are containment matches — realistic for reserve-vs-reserve). Time/competition compatibility partially mitigates but does not eliminate it.
- **Confidence:** **High** (deterministic, test-backed).
- **Recommended fix:** require whole-word-boundary containment and/or reject when the longer name adds a leading qualifier (`new`/`reserves`/`u21`/`b`); or drop the containment score below threshold and rely on competition/time bonuses to re-confirm. Correct the comment.

#### L-1 (Low) — `providerCache` and `enrichmentCache` are never pruned (slow session memory growth)
- **Location:** `providerCache.set` `:1720`,`:1728` (no delete/clear); `enrichmentCache.set` `:1192` (no delete/clear). Confirmed by grep: zero `.delete`/`.clear` on either Map.
- **Evidence (test `tests/runtime.test.js`):** "providerCache grows monotonically … NOT auto-pruned on expiry" (25 keys → size 25, still 25 after +10 min); "enrichmentCache grows one entry per distinct match key and is never pruned" (15 → 15 after a day).
- **Impact:** A Bookie tab open for hours/days accumulates one small entry per distinct `(match × provider × date-window)` and per distinct match key. Monotonic but small and practically bounded by the user's actual bets; not a crash risk. (`resolvedEventCache` self-evicts `:1622`; `inFlightRequests` cleans on settle; odds-analysis cache is size-capped `:3031` — only these two Maps lack eviction.)
- **Confidence:** **High**.
- **Recommended fix:** sweep expired `providerCache` entries on each `refreshPanel`; cap `enrichmentCache` (drop keys absent from `latestRenderableMatches`, or size-capped LRU).

#### L-2 (Low) — `SCRIPT_VERSION` (`2.1.0`) disagrees with `@version` (`2.5.3`)
- **Location:** `@version` `:4` vs `const SCRIPT_VERSION = '2.1.0'` `:68`; consumed by `buildDebugReport:659`.
- **Evidence (test `tests/metadata.test.js`):** "DEFECT: SCRIPT_VERSION constant disagrees with @version header".
- **Impact:** Every user-submitted debug report shows `2.1.0` regardless of installed version — misleads support/triage.
- **Confidence:** **High**.
- **Recommended fix:** derive from `GM_info?.script?.version` with a literal fallback.

#### L-3 (Low) — `abbreviateSelection` leaks filler word + trailing space
- **Location:** `:3213-3222`.
- **Root cause:** When the filler filter (`the|fc|sc|cf|of|and|&`) leaves <2 words, it falls back to `clean.slice(0,3)` of the **original** string, re-introducing the filler.
- **Evidence (test `tests/odds-math.test.js`):** "DEFECT: abbreviateSelection leaks filler word + trailing space" — `abbreviateSelection('FC Barcelona') === 'FC '`; `('The Rock') === 'THE'`.
- **Impact:** Cosmetic only — odds-analysis row labels show `FC `/`THE`. No effect on numbers or matching.
- **Confidence:** **High**.
- **Recommended fix:** fall back to the filtered remainder (`words.join(' ').slice(0,3)`) and `.trim()`.

#### L-4 (Low) — `@homepage` has a `hhttps://` typo
- **Location:** `:24`.
- **Evidence (test `tests/metadata.test.js`):** "DEFECT: @homepage has a 'hhttps' typo".
- **Impact:** Broken Homepage link in the userscript manager; `@supportURL` `:25` is valid.
- **Confidence:** **High**.
- **Recommended fix:** `@homepage https://greasyfork.org/en/scripts/583676-torn-bookie-live-scores`.

#### L-5 (Low) — README references a non-existent filename
- **Location:** `README.md:16` ("Open `Live_Scores_Panel.js`."); actual file is `Torn_Bookie_Live_Scores.js`.
- **Impact:** New installers look for a file that isn't there. Documentation only.
- **Confidence:** **High**.
- **Recommended fix:** update the README filename.

### PLAUSIBLE RISKS (code-path evidence; user-visible impact not locally reproducible)

#### N-2 (Plausible) — No request timeout configured; `ontimeout` handlers are unreachable
- **Location:** `gmFetchJson:955-976`, `gmFetchJsonWithMeta:988-1010` call `GM_xmlhttpRequest({...})` **without a `timeout` property** (grep: only `ontimeout:` at `:973`/`:1007`, no `timeout:`). Score lookups also lack `withTimeout` (it wraps only enrichment `:4988`).
- **Confirmed (code-path):** the `ontimeout` rejection branches are dead code as written, and score lookups have no application-level timeout.
- **Plausible consequence (not locally verifiable):** if a provider connection stalls without the browser erroring, the in-flight promise for that `cacheKey` never settles; every later refresh **coalesces onto the dead promise** (`:1712-1716`), so that one match never updates until reload. Other matches/keys are isolated. Depends on browser/Tampermonkey socket defaults, not reproducible in Node.
- **Confidence:** **Medium** (mechanism confirmed; trigger browser-dependent — usually the browser surfaces `onerror` instead).
- **Recommended fix:** add `timeout: 12000` to both `GM_xmlhttpRequest` option objects, and/or wrap `findScoreForMatch` provider calls in `withTimeout`.

### INFORMATIONAL (design notes, limitations, characterized behavior)

#### B-1 (Informational) — Only `inprogress`→live and `notstarted`→upcoming Torn statuses are shown
- **Location:** `extractLiveBets:1928-1935`, `extractUpcomingBets:1937-1945`.
- **Evidence (test `tests/states.test.js`):** "BEHAVIOR: only inprogress->live and notstarted->upcoming survive; other statuses are dropped" — a bet with status `postponed`/`cancelled`/`finished`/`delayed` appears in **neither** list.
- **Impact:** If Torn ever emits a status other than those two for a bet you hold, it silently disappears from the panel. Whether Torn uses such statuses for `your-bets` rows is **unverifiable offline** — hence Informational/plausible, not a confirmed bug.
- **Confidence:** **High** for the code behavior; **Unknown** for the real-world trigger.

#### B-2 (Informational) — `delayed` / `abandoned` / `suspended` are in no status set
- **Location:** `LIVE_STATUS_VALUES`/`NON_LIVE_STATUS_VALUES`/`FINAL_STATUS_VALUES` `:1322-1324`.
- **Evidence (test `tests/states.test.js`):** "isFinalStatus: … abandoned/suspended/delayed are NOT" and "BEHAVIOR: delayed/abandoned/suspended are neither live nor final nor non-live".
- **Impact:** A provider candidate marked abandoned/suspended is not treated as final, so the resolved-event cache keeps the longer active TTL and the UI does not show a completed state. Minor.
- **Confidence:** **High** (deterministic).

#### I-1 (Informational) — Esports detection misses short-form competition labels (`"CS2 Major"`, `"LoL Worlds"`). `detectEsportsGameKey:1739-1766` + `ESPORTS_GAME_PATTERNS:421`; short aliases match only as an exact token (intentional guard against `lol`⊂`Holloway`). Torn usually carries the full game name in `sport`. (`tests/providers.test.js`.)
#### I-2 (Informational) — Upcoming non-global matches near a UTC midnight query a single provider date (`buildDateBucketPlan:2009-2027` widens only when live or global-date upcoming). Self-heals once live.
#### I-3 (Informational) — Bare-ISO timestamps (no timezone) are rejected (`normalizeTimestampMs:1330-1340`) — intentional and safe; Torn supplies epochs.
#### I-4 (Informational) — Live score updates are capped by `TTL_SUCCESS = 45 s` (`:94`); the `10s` refresh option does not yield 10 s score updates. (See NETWORK_AUDIT N-1.)
#### I-5 (Informational) — Page-realm prototype patching via `unsafeWindow` (`:889-942`) — required to capture Torn's bookie API; guarded (`sid=bookieApi` only), originals preserved; the documented reason for "NOT COMPATIBLE WITH TORN PDA".

---

## 5. Greasy Fork / Tampermonkey readiness

- **Metadata formatting:** valid `==UserScript==` block; `@name/@namespace/@version/@description/@author/@license/@match/@grant/@connect/@run-at` all present (`tests/metadata.test.js`). Two cosmetic metadata defects (L-2 version, L-4 homepage typo) — neither blocks installation.
- **Permissions:** `@grant` minimal and fully used; `@match` scoped to the bookie page (no `<all_urls>`, no `@include`); `@connect` lists exactly the 8 fetched hosts with no wildcards. ✔
- **Dependencies / resources:** **none.** No `@require`, no `@resource`, no external script/CDN, no `eval`/dynamic code (grep = 0). Nothing can "unexpectedly change" out from under the script — all logic and data tables are inlined.
- **Compatibility risks:** (a) `@match` with a query string (`?sid=bookie*`) relies on Tampermonkey's lenient matching (query strings are outside the strict match-pattern spec) — works on Tampermonkey, **not validated on Greasemonkey/Violentmonkey**; (b) `unsafeWindow` prototype patching is incompatible with Torn PDA (already disclosed). No live Greasy Fork listing was accessed or modified.

---

## 6. Items that could not be verified locally

- **`FINAL.user.js`** — named file does not exist; validated `Torn_Bookie_Live_Scores.js`.
- **No browser / real DOM** — stateful UI orchestration (`getOrCreatePanel` recreation on SPA navigation, `rerenderPanel`/`updateDetailsPanel` against live nodes, CSS/visual layout, "console clean" on the real page) was exercised only headlessly via pure render functions. Manual check on `https://www.torn.com/page.php?sid=bookie` with Tampermonkey still recommended.
- **No live network** — provider response *parsing/mapping* against real payloads (schema drift) was not hit; tests mock at the candidate/`fetchWithCache`/`resolveProviderMatch` boundary.
- **N-2 stall** — the missing-`timeout` wedge depends on real socket behavior; the dead `ontimeout` is confirmed by code, the user-visible stall is not reproducible offline.
- **B-1 trigger** — whether Torn emits non-`inprogress`/`notstarted` statuses for held bets is unknown without live data.
- **Timezone** — tests force `TZ=UTC`; the one local-time path (`buildSelectedStartTimestamp`) was not swept across host timezones.
- **Userscript-manager runtime** — Tampermonkey-specific `@match`/`unsafeWindow`/GM behavior not validated on other managers.

---

## 7. Final git status and diff summary

```
Branch: claude/overnight-audit

git diff HEAD -- Torn_Bookie_Live_Scores.js   → EMPTY  (production source byte-for-byte unchanged, 7108 lines)
git diff --stat (tracked files)               → EMPTY  (no tracked file modified)

git status --porcelain (untracked additions only):
  ?? test-docs/ARCHITECTURE.md
  ?? test-docs/NETWORK_AUDIT.md
  ?? test-docs/RUNTIME_AUDIT.md
  ?? test-docs/SECURITY_AUDIT.md
  ?? test-docs/PRODUCTION_VALIDATION.md
  ?? test-docs/FIX_PLAN.md
  ?? test-docs/OVERNIGHT_AUDIT.md        (pre-existing)
  ?? tests/package.json       (dev-only; zero dependencies)
  ?? tests/                   (harness + fixtures + 13 *.test.js, incl. new states/runtime)
```

The only change inside `tests/` this pass was adding `resolveProviderMatch` to the harness export list (`tests/load-userscript.js`) and two new test files (`tests/states.test.js`, `tests/runtime.test.js`) — all **test tooling, untracked, outside the production file**. No commits, pushes, PRs, publishes, Greasy Fork changes, or external network writes were performed. No runtime dependencies were added to the userscript (testing uses Node's built-in `node:test`/`node:assert`/`node:vm`).

---

## 8. Confirmed vs. plausible vs. unverified (summary)

| Class | Items |
|---|---|
| **Confirmed bugs** (test-backed) | **M-1** containment over-match · **L-1** unpruned caches · **L-2** version mismatch · **L-3** abbreviateSelection · **L-4** homepage typo · **L-5** README filename |
| **Plausible risks** (code-path; trigger not reproducible offline) | **N-2** no request timeout / dead `ontimeout` · **B-1** non-standard Torn statuses dropped |
| **Informational / by-design** | **B-2** status-set gaps · **I-1** esports short-labels · **I-2** midnight upcoming window · **I-3** bare-ISO rejection · **I-4** 45 s live-update cap · **I-5** `unsafeWindow` patching |
| **Unverified concerns** | real-DOM SPA lifecycle · live provider schema drift · multi-timezone DOM-date path · non-Tampermonkey managers |
