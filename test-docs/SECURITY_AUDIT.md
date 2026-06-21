# SECURITY & PRIVACY AUDIT — Torn Bookie Live Scores

**Source:** `Torn_Bookie_Live_Scores.js` `@version 2.5.3`. **Method:** static code-path analysis + deterministic tests (`tests/security.test.js`, `tests/metadata.test.js`, `tests/render-states.test.js`). **Result: no Critical or High security findings.**

---

## 1. External hostnames contacted

All outbound traffic is **GET-only** (`method: 'GET'` is the only method in the source — `:958`, `:991`) and is restricted by the GM `@connect` allowlist (`:15-23`, no wildcards).

| Host | Purpose | Default | Data sent |
|---|---|---|---|
| `site.api.espn.com` | scores | on | sport key, UTC date |
| `api.sofascore.com` | scores + H2H/stats | on | sport slug, UTC date, event id |
| `prod-public-api.livescore.com` | scores | on | sport slug, date |
| `api.thescore.com` | scores + standings | off | sport slug, ISO date window |
| `www.bbc.com` | scores | off | sport path, date |
| `api.pandascore.co` | esports scores | off (BYOK) | game slug, date, **user token** (header) |
| `api-web.nhle.com`, `api.nhle.com` | NHL enrichment | enrich only | game/team ids, season |
| `api.the-odds-api.com` | odds enrichment | off (BYOK) | sport key, **user API key** (query/header) |

**No host outside `@connect` is contacted.** No analytics/telemetry/error-reporting endpoint exists (`grep -ciE 'analytics|telemetry|sentry|gtag|mixpanel'` → **0**). The only data leaving the browser to BYOK providers is the user's own token plus public sport identifiers — **no Torn account data, username, bet amount, bet selection, or PII is ever transmitted** (privacy disclosure `:32-59`; enforced by the fact that requests are built only from sport/date/event ids).

### Interception scope
The page-realm `fetch` and `XMLHttpRequest` overrides (`:889-942`) parse **only** responses whose URL `includes('sid=bookieApi')` (`:895`, `:932`). All other page traffic passes through untouched (originals are preserved and always called). Captured data stays in `capturedBookieData` (module memory) and is never transmitted. Verified by `tests/metadata.test.js` ("interception is restricted to the Torn bookie API marker only").

---

## 2. Values stored locally

| Key | Backend | Contents | Sensitive | Protections |
|---|---|---|---|---|
| `tmBookieScoresUiSettings` (`:67`) | `localStorage` (`:764`,`:774`) | theme, layout, provider/sport toggles, refresh mode | No | merged via `deepMergeSettings` (prototype-safe) |
| `tmBookieOddsApiKey` (`:110`) | GM storage (`:121-131`) | The Odds API key (BYOK) | **Yes** | masked in UI (`maskOddsApiKey:135`), redacted from debug report |
| `tmBookiePandaScoreToken` (`:153`) | GM storage (`:156-166`) | PandaScore token (BYOK) | **Yes** | masked (`maskPandaScoreToken:170`), redacted from debug report |
| `tmBookieOddsAnalysisCache` (`:117`) | `localStorage` (`:3017`,`:3032`) | cached public odds analysis | No (public odds, no PII) | size-capped `ODDS_ANALYSIS_CACHE_LIMIT` (`:3031`) |

No Torn credentials, session cookies, or bet data are persisted. The two secrets live in GM storage (per-script, not page-readable `localStorage`).

---

## 3. Unsafe HTML insertion (XSS surface)

There are **8 `innerHTML` assignments** (`:3541`,`:4269`,`:4447`,`:4880`,`:4896`,`:5350`,`:5385`,`:5405`). Every one is fed by pure render functions that pass **all dynamic values through `escapeHtml`** (`:1052`, escapes `& < > " '`).

- `renderPoweredBySources:3525` escapes source key, label, and icon URL.
- Scoreboards/match rows/details/error all escape team names, scores, venue, status, commentary, and source labels (`:3609-5375`).
- `renderErrorBody:5370` is the **only** branch that emits non-escaped markup, and only for a **hardcoded static-literal** message; any dynamic error text falls through to `escapeHtml(message)`.
- `showInfoModal:4892` inserts `bodyHtml` raw, but its **sole caller** (`showEsportsPandaScoreNotice:4920`) builds that body from a constant table value and a constant URL, both `escapeHtml`-wrapped (`:4924-4926`).

**No `eval`, `new Function`, `document.write`, `insertAdjacentHTML`, dynamic `<script>`/`.src`, or inline `on*` attribute injection exists** (`grep -ciE 'eval\(|new Function|document\.write|insertAdjacentHTML'` → **0**). No third-party code is loaded or executed. All 3 `target="_blank"` links carry `rel="noopener noreferrer"` (3/3; no reverse-tabnabbing).

**Verified by test** (`tests/render-states.test.js` → "XSS-safety: malicious team name / detail are escaped in every scoreboard style"; `tests/security.test.js` → "escapeHtml neutralises all HTML metacharacters", "buildEspnSourceUrl only emits whitelisted https deep links").

### URL safety
External deep-links are gated by an **https-only host allowlist** (`safeExternalSourceUrl:250`, `firstSafeSourceUrl:261`). Provider-supplied URL fields cannot inject `javascript:`/`data:` schemes or off-allowlist hosts. Verified by `tests/security.test.js` ("safeExternalSourceUrl allows only https on known hosts").

---

## 4. Sensitive-data exposure (debug report)

`buildDebugReport:659` is copied to the **clipboard** on user action (`GM_setClipboard`, `:4845`) — it is never transmitted. It is aggressively sanitised:

- `sanitizeDebugText:546` redacts API keys, bearer tokens, and the literal stored secrets.
- `isSensitiveDebugKey:563` + `sanitizeDebugValue:572` redact account/secret/amount/bet/tornId-bearing keys at any depth, cap recursion depth (`:572`), array length (30, `:585`), and object entries (50, `:589`).
- Windows user paths are scrubbed.

**Verified by `tests/security.test.js`:** "sanitizeDebugText redacts api keys, tokens and bearer auth", "redacts known stored secrets verbatim", "scrubs Windows user paths", "sanitizeDebugValue redacts sensitive keys at any depth and truncates", "caps recursion depth". The BYOK keys are therefore **not** leaked into a user-shared debug report.

---

## 5. Prototype pollution

`deepMergeSettings:741` merges via own-property spread and is resistant to `__proto__` injection from a tampered `localStorage` settings blob. **Verified** (`tests/security.test.js` → "deepMergeSettings does not pollute Object.prototype via __proto__"; "keeps nested enabled maps merged, not replaced").

---

## 6. Userscript metadata / permissions

| Directive | Value | Assessment |
|---|---|---|
| `@match` (`:8`) | `https://www.torn.com/page.php?sid=bookie*` | Tightly scoped to the bookie page; **no `<all_urls>`**, no broad host. No `@include`. ✔ (test "@match is tightly scoped…") |
| `@grant` (`:9-14`) | `GM_xmlhttpRequest`, `GM_setClipboard`, `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `unsafeWindow` | Each grant is used; none superfluous. ✔ (test "grants are limited to what the script uses") |
| `@connect` (`:15-23`) | 8 explicit hosts | Exactly the hosts fetched; **no wildcards**. ✔ (tests "@connect lists exactly the expected external hosts (no wildcards)" + "every API host the code fetches from is covered by @connect") |
| `@run-at` (`:26`) | `document-start` | Needed to install interceptors before Torn's first bookie fetch. ✔ |

### `unsafeWindow` usage (Informational)
`unsafeWindow` is required to wrap the **page's own** `fetch`/`XHR` so the script can read Torn's bookie API response (which the page fetches itself). This mutates page intrinsics (`:889`,`:923`) — invasive but correctly guarded (`sid=bookieApi` only), preserves and always calls originals, and never blocks or alters page traffic. This is the standard pattern for this capability and is the documented reason the script is "NOT COMPATIBLE WITH TORN PDA" (`@description`, `:5`).

---

## 7. Findings

### S-1 (Low) — Debug report `version` is wrong (stale `SCRIPT_VERSION`)
- `buildDebugReport:659` reports `SCRIPT_VERSION = '2.1.0'` (`:68`) while the installed `@version` is `2.5.3` (`:4`). Not a security hole, but every user-submitted debug report **misstates the version**, degrading the integrity of support/triage data. Verified by `tests/metadata.test.js` ("SCRIPT_VERSION constant disagrees with @version header"). Confidence: **High**. Fix: derive from `GM_info.script.version`.

### S-2 (Informational) — `@homepage` has an invalid `hhttps://` scheme
- `:24` → broken Homepage link in the userscript manager. Cosmetic; `@supportURL` (`:25`) is valid. Confidence: High (test-backed). Fix: correct the typo.

### S-3 (Informational) — Page-realm prototype patching via `unsafeWindow`
- As described in §6; inherent to the data-capture design. No action required beyond the existing PDA-incompatibility disclosure.

### Positive confirmations (no defect)
- No XSS reachable via provider/team/venue/commentary data (escaped at every sink).
- No prototype pollution via settings.
- No secret leakage in debug reports (keys/tokens/PII redacted).
- No third-party code execution; no `eval`/dynamic script.
- `@match`/`@grant`/`@connect` minimal and complete; GET-only; no telemetry.
- BYOK keys stored in GM storage, masked in UI, redacted in reports.
