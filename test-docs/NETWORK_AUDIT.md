# NETWORK AUDIT — Torn Bookie Live Scores

**Source:** `Torn_Bookie_Live_Scores.js` `@version 2.5.3`. **Method:** static code-path analysis + deterministic tests (`tests/cache.test.js`, `tests/states.test.js`, `tests/plans.test.js`). No live third-party requests were issued.

---

## 1. How requests are generated

Every outbound request funnels through one path:

```
findScoreForMatch :3465  (per match, providers tried sequentially)
  └─ _find<Provider> :2219-2575
       └─ resolveProviderMatch :1631  (walks lookup plan, ≤ maxRequests steps)
            └─ fetchWithCache :1704   (TTL cache + in-flight coalescing)
                 └─ gmFetchJson :955 / gmFetchJsonWithMeta :988
                      └─ GM_xmlhttpRequest :957 / :990
```

There is **no other outbound network path.** Enrichment (details pane) adds `api-web.nhle.com`, `api.nhle.com`, `api.the-odds-api.com` through the same `fetchWithCache` → `gmFetchJson` funnel, but only when a details pane is opened.

**No retry/backoff logic exists.** `grep -ciE 'retry|retries|backoff'` over the source = **0**. The only repetition is (a) the per-provider lookup *plan* (a fixed, deduped, capped list of date windows) and (b) the refresh interval. This structurally rules out classic retry storms.

---

## 2. Request caps per provider (per match, per refresh)

Each plan step = at most one network request (subject to the cache). Caps are enforced by `.slice(0, maxRequests)` in `resolveProviderMatch:1633` and the plan builders.

| Provider | Find fn | Plan builder | Max steps (upcoming / live) | Default |
|---|---|---|---|---|
| ESPN | `_findEspn` `:2219` | `buildDateBucketPlan(espn)` `:2231` | 1 / 3 | on |
| SofaScore | `_findSofascore` `:2287` | `buildSofascoreLookupPlan` `:1987` | 1 / 3 (cricket ≤ **7** `:2002`) | on |
| LiveScore | `_findLivescore` `:2306` | `buildDateBucketPlan(livescore)` `:2309` | 1 / 3 | on |
| TheScore | `_findThescore` `:2401` | `buildTheScorePlan` `:2029` | **1** (single ±1-day window) | off |
| BBC Sport | `_findBbc` `:2423` | `buildDateBucketPlan(iso)` `:2426` | 1 / 3 | off |
| PandaScore | `_findPandaScore` `:2504` | `buildPandaScorePlan` `:2058` | ≤ 3 | off (BYOK) |
| NHL (enrich) | `resolveNhlGame` `:2865` | `buildNhlScorePlan` `:2086` | ≤ 4 | enrich-only |

**Important damping:** `findScoreForMatch` stops at the **first provider that returns `found`** (`:3481-3489`), and `resolveProviderMatch` stops at the **first accepted plan step** (`:1670-1673`). So the caps above are *worst-case* (nothing matches); a successful match typically costs **1 request** (the primary date of the primary provider), then **0** for `TTL_SUCCESS = 45 s`.

### Worst-case requests for a single unmatched live match (cold cache)

- **Default config** (espn + sofascore + livescore enabled, those that support the sport): ≤ 3 + 3 + 3 = **≤ 9** requests (non-cricket); cricket via SofaScore can reach **≤ 13**.
- **All six providers enabled** (non-cricket): 3 + 3 + 3 + 1 + 3 + (panda ≤3) = **≤ 16**; with cricket SofaScore: **≤ 20**.

These are per-match, per-cold-refresh ceilings, not steady state.

---

## 3. Caching & coalescing (verified)

- **TTL cache** (`providerCache`, `fetchWithCache:1704`): serves within `TTL_SUCCESS = 45 s` / `TTL_ERROR = 15 s` (`:94-95`). Verified by `tests/cache.test.js` ("serves cache hit until TTL, refetches after expiry") and `tests/states.test.js` ("stale providerCache entry past expiry triggers a refetch").
- **In-flight coalescing** (`inFlightRequests`): concurrent identical requests share one promise; the entry is deleted on both resolve and reject (`:1721`,`:1729`). Verified ("coalesces concurrent calls", "a rejected fetch never leaks an in-flight entry").
- **Resolved-event cache** (`resolvedEventCache`): once a provider event id is matched, subsequent refreshes reuse it for 5 min (active) / 2 min (final) and skip re-selection, invalidating on team change or > 1 h start drift (`:1617-1629`). Verified by `tests/cache.test.js`.
- **Error caching**: a failed fetch is cached as a safe empty shape `{error, events:[], Stages:[]}` for `TTL_ERROR`, so a down provider is **not hammered** every refresh (`:1727`). Verified.

**No duplicate requests within a refresh:** distinct plan steps carry deduped `requestKey`s (`dedupeLookupPlan:1429`, `dedupeCandidates:1470`); identical keys across matches/refreshes hit the cache or coalesce.

---

## 4. Refresh cadence vs. actual outbound rate

Two things can trigger `refreshPanel`:
1. **The refresh interval** — `setRefreshMode` `:3575`, `REFRESH_OPTIONS` `:81` = `10s / 30s / 3m / MAN(off)`. The interval is a **singleton** (`refreshIntervalId` cleared before re-set, `:3578`).
2. **Capture debounce** — every captured Torn bookie response schedules `refreshPanel` after 250 ms (coalesced via `clearTimeout`, `:873-874`). Torn polls its own bookie API, so refreshes can also fire on Torn's cadence.

**Refresh frequency ≠ request frequency.** Outbound provider traffic is gated by the TTL cache, so most refreshes after the first cost **0 network requests** until a TTL expires.

### Max requests per minute / per hour (M = number of displayed matches)

| State | Per-match cost | 30 s refresh | 10 s refresh |
|---|---|---|---|
| **Matched / success** | ~1 req per `45 s` (TTL_SUCCESS) | ≈ **M req/min** → **≈ 60·M/hr** | same (TTL, not refresh, gates it) |
| **All errors** (15 s err TTL) | full cold burst when TTL expires | burst (≤9·M) every 30 s → **≤ 18·M/min** | burst every ~20 s → **≤ 27·M/min** |

Worked example, M = 10 matches, default providers, total-failure state at 10 s refresh: ceiling ≈ **270 req/min ≈ 16,200 req/hr**. In the normal matched state the same panel settles to **≈ 10 req/min ≈ 600 req/hr**. Both are bounded and contain no unbounded growth term.

> **N-1 (Informational) — live updates are capped by the 45 s success TTL.** Selecting `10s` refresh does **not** produce 10 s live score updates; the panel re-reads the cached provider response until `TTL_SUCCESS` (45 s) elapses (`:94`, `fetchWithCache:1706`). Intended rate-limit protection; can surprise users. Confidence: **High** (deterministic, test-backed).

---

## 5. Findings

### N-2 (Plausible risk) — No request timeout is configured; `ontimeout` handlers are unreachable

- **Location:** `gmFetchJson:955-976` and `gmFetchJsonWithMeta:988-1010` call `GM_xmlhttpRequest({ method, url, headers, onload, onerror, ontimeout })` **without a `timeout` property** (verified: `grep -nE 'timeout\s*:'` returns only the two `ontimeout:` handler lines, `:973` and `:1007`, and no `timeout:` option).
- **Confirmed (code-path):** Because no `timeout` is passed, Tampermonkey's script-level timeout never triggers, so the `ontimeout` rejection branches are **dead code as written**. Score lookups also lack any application-level timeout — `withTimeout` (`:4832`) wraps only enrichment (`:4988`), **not** `findScoreForMatch`.
- **Plausible consequence (not locally verifiable):** If a provider connection stalls without the browser erroring, the in-flight promise for that `cacheKey` never settles. `fetchWithCache` keeps it in `inFlightRequests`, and every later refresh **coalesces onto the dead promise** (`:1712-1716`), so that one match never updates its score until page reload. Other matches/keys are unaffected (per-key isolation). Whether a stall actually occurs depends on the browser/Tampermonkey socket defaults, which cannot be exercised in the Node harness.
- **Why not "confirmed bug":** in practice the browser usually surfaces a network error (→ `onerror` → cached error shape), and Tampermonkey may impose its own default. The dead-`ontimeout` code is confirmed; the user-visible stall is a risk, not a reproduced failure.
- **Recommended fix:** add `timeout: 12000` (or similar) to both `GM_xmlhttpRequest` option objects so `ontimeout` becomes live, and/or wrap `findScoreForMatch` provider calls in `withTimeout`.

### N-3 (Informational) — Failure-state burst repeats every error-TTL window

- **Location:** `TTL_ERROR = 15 s` (`:95`) + refresh interval.
- **Detail:** When a provider is persistently failing, its error entry expires every 15 s, so each refresh after that re-issues the full unmatched plan (up to the §2 ceilings). This is **bounded and intentional** (15 s back-off prevents per-refresh hammering at 10 s/30 s) but means a sustained outage holds the request rate near the §4 worst case rather than decaying. No retry multiplication occurs.
- **Confidence:** High (deterministic from TTL + interval).

### N-4 (Positive confirmation) — Provider fallback is correct and bounded

- One provider failing while another succeeds is handled cleanly: `findScoreForMatch` catches per-provider exceptions (`:3498`) and advances the ladder; `resolveProviderMatch` catches per-step exceptions (`:1644`) and advances the plan. Verified by `tests/states.test.js` ("provider fallback: first plan step throws, a later step resolves"; "one provider fails while another succeeds"). HTTP status, 429 rate-limiting, parser failure, and ambiguity are surfaced distinctly by `summarizeProviderResult` (`:1680`), verified by "summarizeProviderResult surfaces HTTP status, including 429".

---

## 6. Hostnames contacted (and gating)

| Host | When | Default |
|---|---|---|
| `site.api.espn.com` | score lookup (supported leagues) | on |
| `api.sofascore.com` | score lookup + H2H/stats enrichment | on |
| `prod-public-api.livescore.com` | score lookup | on |
| `api.thescore.com` | score lookup + standings | off |
| `www.bbc.com` | score lookup | off |
| `api.pandascore.co` | esports score lookup | off (BYOK token required) |
| `api-web.nhle.com`, `api.nhle.com` | NHL stats/H2H enrichment | details pane only |
| `api.the-odds-api.com` | odds analysis enrichment | off (BYOK key required) |

All eight hosts are declared in `@connect` (`:15-23`) with no wildcards. No request is made to any host absent from that list (the GM sandbox enforces `@connect`). Disabled providers are never contacted (`getProviderPriority` filters by `uiSettings.enabledProviders`, `:1852-1855`).
