# Torn PDA

Last reviewed: 2026-07-14
Userscript version reviewed: `3.1.0`

[Torn PDA](https://github.com/Manuito83/torn-pda) is a third-party Android/iOS app that wraps Torn in a webview. It is not Tampermonkey, and the differences matter enough to document.

## Install

*Settings → Advanced browser settings → enable custom user scripts*, add the script, and set **Injection time = Start**.

**Injection time must be Start.** The script captures your bets by wrapping the page's own `fetch`/`XMLHttpRequest` at `document-start` and reading Torn's `sid=bookieApi` responses. On **End** it loads after those requests have already fired, so nothing is captured and the panel sits empty waiting for data that already came and went.

## PDA does not honour `@match`

PDA's matcher mishandles wildcards and injects scripts on pages the author never targeted ([torn-pda#314](https://github.com/Manuito83/torn-pda/issues/314)). **Do not rely on the metadata block for page scoping inside PDA.**

This is why `isBookiePageContext()` exists. As of v3.1.0 the script scopes its own behaviour at runtime from `location`, and the predicate is deliberately at least as strict as the `@match` it stands in for:

```js
hostname ∈ {www.torn.com, torn.com}  AND  pathname === '/page.php'  AND  sid === 'bookie'
```

Checking `sid` alone is not enough. `sid=bookie` is unique among *legitimate* Torn URLs, but the guard exists to hold against ones that are not — `torn.com/city.php?sid=bookie` is a link anyone could hand a PDA user, and a `sid`-only check would let it mount the panel and start the refresh loop on a page with no bet data.

Off the Bookie page the script returns before installing anything: no interception, no listeners, no panel, no timers.

## Torn section navigation is a real page load, not SPA routing

**Verified on-device, 2026-07-14.** Navigating to City, Gym, or Items goes to `city.php`, `gym.php`, `item.php` — separate documents. The JS context is destroyed and the script is re-injected per page.

Torn's SPA behaviour is confined to the hash routes *within* the Bookie page (`#/`, `#/popular`, `#/american-football`, …), which all keep `sid=bookie`. `isBookiePageContext()` therefore stays true across the Bookie tabs and needs no navigation watcher.

Two consequences follow, and both are load-bearing:

1. **No history/popstate watcher is needed.** An earlier design proposed patching `history.pushState`/`replaceState`; it was cut. It solved a problem that does not exist and risked fighting Torn's own router.
2. **`capturedBookieData` cannot survive navigation.** It is a plain in-memory variable, only ever filled from `sid=bookieApi` responses, which only the Bookie page issues. So the panel can never show bet data off-Bookie — which is why the script does not mount there at all rather than mounting an empty or erroring panel.

An observed quirk worth knowing: PDA's injection decision appears to lag the URL by one page. Leaving Bookie, the script still injects on the *first* page you land on, then stops on the second. The v3.1.0 runtime check makes that harmless — it injects, finds a non-Bookie page, and returns.

## PDA is a Flutter `InAppWebView`

PDA runs on [`flutter_inappwebview`](https://pub.dev/packages/flutter_inappwebview), so `window.flutter_inappwebview` is present. That makes an `isTornPdaContext()` helper possible if a PDA-specific tweak is ever needed.

**The current fix deliberately does not use it.** Keying off page type is correct on both desktop and PDA and needs no platform detection. Reach for PDA detection only if a behaviour must genuinely differ between the two.

`GM_info` may be absent under PDA. The script falls back to a literal `SCRIPT_VERSION` when it is, and `tests/metadata.test.js` pins that literal to `@version` so debug reports from PDA cannot silently misreport the version (they did, for three releases, before v3.1.0).

## PDA API key injection (not used)

PDA can inject the user's Torn API key by replacing the literal token `###PDA-APIKEY###` in a userscript. This script is BYOK and does not use Torn's own API, so the token is not used. Recorded because it is the mechanism any future Torn-API feature would need.

## Sources

- [`@match` handling doesn't follow script standard — torn-pda#314](https://github.com/Manuito83/torn-pda/issues/314)
- [Torn PDA releases (userscript engine changes)](https://github.com/Manuito83/torn-pda/releases)
- [Guide: how to install scripts on PDA and Android (Torn forums)](https://www.torn.com/forums.php?p=threads&f=61&t=16347522&b=0&a=0)
- [`flutter_inappwebview` package (PDA's webview)](https://pub.dev/packages/flutter_inappwebview)
- [Injecting JavaScript in Flutter WebView with user scripts (injection timing)](https://inappwebview.dev/blog/webview-javascript-injection-with-user-scripts-flutter-inappwebview-6/)
