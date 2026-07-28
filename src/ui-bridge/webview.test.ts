/**
 * Sandbox prop-builders (ADR 0004 invariants as tests, not review notes):
 * the navigation gate blocks everything but the initial inline-html load,
 * and NOTHING that reaches the WebView can contain the bearer token.
 */

import { createBridgeSession } from './bridge';
import { buildDispatchScript, buildWebViewProps, shouldStartLoad } from './webview';

describe('shouldStartLoad — external navigation is blocked', () => {
  it('allows only the inline html load', () => {
    expect(shouldStartLoad('about:blank')).toBe(true);
    expect(shouldStartLoad('about:srcdoc')).toBe(true);
  });

  it.each([
    'https://evil.example/exfil',
    'http://100.64.0.7:8787/app/v1/mcp',
    'http://127.0.0.1:8787/app/v1/manifest',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'intent://scan/#Intent;scheme=zxing;end',
    'about:blank#fragment',
    'ABOUT:BLANK',
    '',
  ])('blocks %s', (url) => {
    expect(shouldStartLoad(url)).toBe(false);
  });
});

describe('buildWebViewProps — sandbox surface', () => {
  const props = buildWebViewProps('<p>hello</p>');

  it('loads the fetched html inline with an empty origin whitelist', () => {
    expect(props.source).toEqual({ html: '<p>hello</p>' });
    expect(props.originWhitelist).toEqual([]);
  });

  it('enables JS for the resource itself but injects NO standing script', () => {
    expect(props.javaScriptEnabled).toBe(true);
    expect(props.injectedJavaScript).toBeUndefined();
  });

  it('shares no cookies, storage, cache, or file access', () => {
    expect(props.incognito).toBe(true);
    expect(props.cacheEnabled).toBe(false);
    expect(props.domStorageEnabled).toBe(false);
    expect(props.sharedCookiesEnabled).toBe(false);
    expect(props.thirdPartyCookiesEnabled).toBe(false);
    expect(props.allowFileAccess).toBe(false);
    expect(props.allowFileAccessFromFileURLs).toBe(false);
    expect(props.allowUniversalAccessFromFileURLs).toBe(false);
    expect(props.setSupportMultipleWindows).toBe(false);
  });
});

describe('ADR 0004: no token string reachable from the WebView', () => {
  const FAKE_TOKEN = 'FAKE-TOKEN-adr0004-do-not-leak';

  it('everything sent into the WebView is token-free even while the bridge calls tools', async () => {
    // Simulate the full shell side around a connection whose vault holds a
    // token: collect EVERY byte destined for the WebView and assert the token
    // never appears. The token is only ever visible to the native MCP client.
    const sentToWebView: string[] = [];

    const callTool = async (name: string, _args: Record<string, unknown>) => {
      // Stand-in for the native client: it reads the token internally...
      const token = FAKE_TOKEN;
      void token; // ...and uses it for HTTP auth only; it never returns it.
      return { content: [{ type: 'text', text: `result of ${name}` }] };
    };

    const session = createBridgeSession({
      allowlist: new Set(['status']),
      callTool,
      post: (frame) => sentToWebView.push(buildDispatchScript(frame)),
    });

    const html = '<p>resource html from resources/read</p>';
    sentToWebView.push(JSON.stringify(buildWebViewProps(html)));

    session.pushTheme({ scheme: 'dark', insets: { top: 0, right: 0, bottom: 0, left: 0 } });
    session.handleFrame(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status' } }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    session.dispose();

    expect(sentToWebView.length).toBeGreaterThanOrEqual(3); // props + theme + result
    for (const payload of sentToWebView) {
      expect(payload).not.toContain(FAKE_TOKEN);
      expect(payload.toLowerCase()).not.toContain('authorization');
      expect(payload.toLowerCase()).not.toContain('bearer');
    }
  });
});

describe('buildDispatchScript — shell→resource transport', () => {
  it('dispatches a message event carrying the exact frame string', () => {
    const frame = JSON.stringify({ jsonrpc: '2.0', method: 'ui/theme', params: {} });
    const script = buildDispatchScript(frame);
    expect(script).toContain(`var d=${JSON.stringify(frame)}`);
    expect(script).toContain("new MessageEvent('message',{data:d})");
    expect(script.endsWith('true;')).toBe(true); // RN WebView injection convention
  });

  it('cannot be escaped by hostile frame content', () => {
    const hostile = '"});alert(1);//  ';
    const script = buildDispatchScript(hostile);
    // The hostile string appears ONLY as a JSON-escaped literal (quotes and
    // backslashes neutralized); stripping that literal leaves none of it.
    expect(script).toContain(JSON.stringify(hostile));
    expect(script.replace(JSON.stringify(hostile), '')).not.toContain('alert');
  });
});
