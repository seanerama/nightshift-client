# Stage 5: Apps: sandboxed WebView renderer and ui-bridge round-trip

- **Type:** feature
- **Depends on:** 3

## Objectives

Render agent-served `ui://` resources safely and prove one full interactive
round-trip: tap an action in agent HTML → bridge → allowlisted MCP tool → result
→ UI refresh. Implements `contracts/ui-bridge.md` v1 exactly; the ADR 0004
security invariants are acceptance conditions here, not aspirations.

## What to build

- **Native MCP client** over `POST /app/v1/mcp` (streamable HTTP): initialize,
  `resources/list`, resource read, `tools/call` — using the active connection's
  token. Gated on the agent's `mcp-tools` / `mcp-apps-ui` capabilities.
- **Apps screen:** list the agent's `ui://` resources (`resources/list`); honor
  manifest `ui.home` as the default-open resource when present.
- **Renderer:** one sandboxed WebView **per resource**: JS injection disabled
  except the bridge, external navigation blocked, no direct network to the
  agent, **the bearer token never enters the WebView**.
- **Bridge (`ui-bridge` v1):** strict JSON-RPC 2.0 over postMessage —
  `tools/call` (per-resource allowlist; violations → `-32601`, logged, never
  forwarded), `ui/ready`, `ui/close`, shell-pushed `ui/theme`; 30s timeout →
  `-32000`; malformed frames dropped and counted.
- **Mandatory fallback:** load failure / bridge violation / render crash →
  plain markdown rendering of the underlying tool result. A broken resource
  never takes the app down.

## Interface contracts

- **Exposes:** the resource renderer + bridge that all future agent UI rides
  on; the MCP client the control-surface stage extends.
- **Consumes:** `contracts/ui-bridge.md` (v1, owned by this repo — implement
  verbatim), `contracts/app-ingress.md` §MCP. Stage 3's `activeConnection`.
  Mock agent's served `ui://` resource for CI.

## Testing requirements

- Unit: bridge envelope validation, allowlist enforcement (non-allowlisted
  tool → `-32601`, nothing forwarded), timeout path, fallback trigger logic.
- Integration (CI): against the mock agent — `resources/list` → fetch its
  `ui://` resource → simulated bridge `tools/call` round-trip succeeds;
  corrupted resource HTML → fallback renders the tool result as markdown.
- Security checks (must be tests, not review notes): no token string reachable
  from WebView-injected JS; external navigation request is blocked.
- UI-smoke asset: documented script — open Apps on device → resource renders →
  tap the action → result refreshes; then break the URL → fallback appears.

## Acceptance conditions

- [ ] Kill-switch / dark-launch flag (default OFF) for this net-new feature —
      REQUIRED here (unlike stages 3/4): `APPS_TAB_ENABLED` config flag,
      default ON in dev, and the tab additionally self-gates on the agent's
      `mcp-apps-ui` capability
- [ ] ADR 0004 invariants covered by automated tests (token isolation,
      allowlist, fallback)
- [ ] UI-smoke "observably-works" check authored for the Apps surface
- [ ] Additive migration only (no destructive schema change)
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO
