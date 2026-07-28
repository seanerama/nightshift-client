/**
 * Pure prop-builders and handlers for the per-resource sandboxed WebView
 * (ADR 0004). Jest cannot render react-native-webview, so every decision the
 * component makes lives here as testable data/functions and the component in
 * src/components/resource-view.tsx stays a thin shell.
 *
 * Sandbox invariants (contracts/ui-bridge.md + ADR 0004), enforced here:
 * - `source={{ html }}` only — the html arrives via the native MCP client's
 *   resources/read; the WebView itself never talks to the agent.
 * - `originWhitelist={[]}` and a navigation gate that refuses EVERY url
 *   except the initial inline-html load (about:blank).
 * - JS enabled for the resource's own inline scripts, but NO
 *   injectedJavaScript shim at all: resource→shell rides the native
 *   `window.ReactNativeWebView.postMessage`, and shell→resource frames are
 *   injected per-event as a `message` MessageEvent dispatch (the contract's
 *   documented transport). Zero standing injected code.
 * - No cookies / storage / file access shared with anything.
 * - THE TOKEN NEVER APPEARS HERE: these builders take html and frames only;
 *   the ADR test serializes their entire output and asserts token absence.
 */

/** The only url a `source={{ html }}` WebView legitimately loads. */
const INLINE_HTML_URLS = new Set(['about:blank', 'about:srcdoc']);

/** Navigation gate for onShouldStartLoadWithRequest: false for every url
 * except the initial inline html load. External navigation is blocked. */
export const shouldStartLoad = (url: string): boolean => INLINE_HTML_URLS.has(url);

/** Static (per-html) WebView props. Everything here is serializable data —
 * the token-absence test JSON.stringifies the result. */
export const buildWebViewProps = (html: string) => ({
  source: { html },
  /** No origin may be treated as navigable. */
  originWhitelist: [] as string[],
  /** Resource HTML may run its own inline scripts (that is the point of
   * MCP Apps); everything it can DO is bounded by the bridge. */
  javaScriptEnabled: true,
  /** No standing injected code — the bridge needs none (see module doc). */
  injectedJavaScript: undefined,
  /** No shared cookies, storage, or files. */
  incognito: true,
  cacheEnabled: false,
  domStorageEnabled: false,
  sharedCookiesEnabled: false,
  thirdPartyCookiesEnabled: false,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  allowsInlineMediaPlayback: true,
  /** window.open targets must not spawn an ungated sibling WebView. */
  setSupportMultipleWindows: false,
  webviewDebuggingEnabled: false,
});

/**
 * Shell→resource delivery: serialize ONE frame into an injectJavaScript
 * statement that dispatches a `message` MessageEvent carrying the JSON string
 * (contracts/ui-bridge.md §Schema/wire). The frame is embedded via
 * JSON.stringify of the *string*, so resource-controlled content can never
 * escape into script context.
 */
export const buildDispatchScript = (frame: string): string =>
  `(function(){var d=${JSON.stringify(frame)};try{window.dispatchEvent(new MessageEvent('message',{data:d}));}catch(e){}})();true;`;
