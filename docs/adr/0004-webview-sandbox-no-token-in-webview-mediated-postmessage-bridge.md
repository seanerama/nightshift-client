# 0004. WebView sandbox: no token in WebView, mediated postMessage bridge

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Agent-served `ui://` resources are HTML rendered inside the app. Even in a
single-user system, agent-generated HTML sits downstream of web content the
agent has read — it is an injection path, not trusted code. The connection
bearer token grants full control of the agent (including job submission), so
token exposure to resource HTML is the worst-case compromise.

## Decision

Day-one requirements, not later hardening:

- Each `ui://` resource renders in its **own sandboxed WebView**: JS injection
  disabled except the postMessage bridge, no navigation to external origins,
  no direct network access to the agent.
- **The bearer token never enters the WebView.** All agent calls from resource
  HTML go through the postMessage JSON-RPC bridge to the **native MCP client**,
  which attaches auth and enforces a **per-resource allowlist** of callable
  tools.
- **Mandatory fallback:** any resource failure (load error, bridge violation,
  render crash) degrades to a plain-text/markdown rendering of the underlying
  tool result. A broken resource can never take chat or control down with it.
- The bridge surface is frozen as its own contract (`ui-bridge` v1) so resource
  authors on the agent side build against a stable, additive-only API.

## Alternatives considered

- **Token in the WebView, resources call the agent directly.** Simplest to
  build, and catastrophic on the first injected script — full agent control
  exfiltrated. Rejected outright.
- **Server-side rendering to images/markdown only.** Safe but kills
  interactivity (the kill button, forms), which is the point of MCP Apps.
- **One shared WebView for all resources.** Saves memory, but lets one
  compromised resource script reach another resource's DOM/state. Per-resource
  isolation is cheap at MVP scale.

## Consequences

- Every new interactive capability for resources must be added to the bridge
  contract and allowlist explicitly — slower than ad-hoc, by design.
- Per-resource WebViews cost memory; acceptable at "a handful of resources"
  scale, revisit if the Apps catalog grows large.
- The fallback rule forces every tool result to have a sane text rendering,
  which also covers agents lacking the `mcp-apps-ui` capability.
