# UI smoke — Stage 5: Apps (sandboxed WebView renderer + ui-bridge)

Observably-works script for the Apps surface. Run on a device/emulator with a
reachable agent that declares `mcp-tools` + `mcp-apps-ui` (the mock agent from
`agent-app-contract` works: `npx mock-agent --token <t> --port 8787 \
--capabilities mcp-tools,mcp-apps-ui`, then connect to `http://<host>:8787`).

Prerequisite: `expo.extra.appsTabEnabled` is `true` in app.json (it is, in this
repo). Flag semantics are documented in `src/config/flags.ts`: explicit boolean
wins; when absent the tab defaults ON in dev builds and OFF in release builds
(dark-launch). The tab additionally self-gates on the agent's `mcp-apps-ui`
capability — the flag never overrides what an agent advertises.

## Steps

1. **Apps tab visible.** With the flag on and an active connection whose
   manifest declares `mcp-apps-ui`, the Apps tab appears in the tab bar.
2. **Resource list.** Open Apps → the agent's `ui://` resources are listed
   (name + uri). Against the mock agent: one row, `ui://mock-agent/home@v1`.
3. **ui.home auto-open.** If the manifest declares `ui.home`, that resource
   opens automatically as the default; a "home" badge marks it in the list.
   (The mock agent declares no `ui.home` — the list is the entry point.)
4. **Resource renders in its sandbox.** Tap a resource → its HTML renders in
   a dedicated WebView under a header with a "‹ Apps" back button; the
   loading spinner clears when the resource signals `ui/ready` (or on load).
5. **Tap the action → real result.** In a resource that declares a tool (via
   `_meta["ui/tools"]`) and renders a button that posts
   `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"status","arguments":{}}}`,
   tapping it returns the agent's REAL tool result over the bridge and the
   resource updates itself with it. No spinner hangs: every request is
   answered (result, error, or -32000 after 30s).
6. **Allowlist enforced.** A resource that declares NO tools (the mock's home
   resource) gets `-32601` for any `tools/call` — verify with a resource
   whose button fires one: the error arrives, nothing reaches the agent.
7. **Theme event.** Toggle device dark mode while a resource is open — the
   resource receives a `ui/theme` event (scheme + safe-area insets).
8. **Break it → fallback card.** Kill the agent process (or turn off the
   network) and reopen the resource → the plain-markdown fallback card
   renders ("Could not load this app" + detail, plus the last tool result if
   one was received). The app itself stays alive — Chat and Connections keep
   working.
9. **Wrong token → fail closed.** Edit the connection to a wrong token: the
   Apps screen shows the fallback/error surface; no resource HTML ever loads
   and no token is visible anywhere in the UI or the resource.
10. **Kill-switch.** Set `"appsTabEnabled": false` in app.json `extra`,
    rebuild/reload → the Apps tab is GONE from the tab bar entirely. Restore
    to `true` and it returns.
