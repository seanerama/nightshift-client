# Contract: ui-bridge

- **Status:** frozen v1
- **Owner:** `nightshift-client` (the shell defines what resource HTML may do —
  ADR 0004). Agent-side resource authors are the consumers.

## Exposes

The postMessage JSON-RPC 2.0 surface available to agent-served `ui://` resource
HTML running inside the app's sandboxed WebView. This is the ONLY channel out
of a resource — no direct network, no navigation, no token (ADR 0004).

Methods callable by resource HTML (v1):

| Method | Behavior |
|---|---|
| `tools/call` | Invoke an MCP tool on the owning connection, `{ name, arguments }` → tool result. Only tools on the resource's **allowlist**; anything else → JSON-RPC error `-32601`, logged, never forwarded |
| `ui/ready` | Resource signals it has rendered; shell hides the loading state |
| `ui/close` | Ask the shell to dismiss the resource view |

Events pushed by the shell to the resource: `ui/theme` (light/dark + safe-area
insets on load and change).

## Consumes

- The native MCP client (per connection) to execute allowlisted `tools/call`
  requests — the shell attaches the bearer token; resource HTML never sees it.
- The per-resource allowlist: v1 derives it from the resource's declared MCP
  Apps metadata, intersected with the connection's manifest `capabilities`.

## Schema / wire

- Transport: `window.ReactNativeWebView.postMessage(JSON.stringify(rpc))` from
  resource → shell; shell → resource via injected `window.dispatchEvent` of a
  `message` event with a JSON-RPC payload. Strict JSON-RPC 2.0 envelopes;
  malformed frames are dropped and counted, never partially processed.
- Every request carries `id`; the shell always responds (result or error).
  Timeout is the shell's (30s v1) → error `-32000`.
- Sandbox invariants (enforced by the shell, part of the contract):
  one WebView per resource; JS injection disabled except this bridge;
  external navigation blocked; **no token in the WebView**.
- Mandatory fallback: on load failure, bridge violation, or render crash the
  shell replaces the resource with a plain-text/markdown rendering of the
  underlying tool result.

## Versioning

Frozen at **v1**. Changes are **additive only** — a breaking change is a NEW
contract, not an edit (framework-spec §4.3). Every consumer depends on this shape.
New methods (e.g. `ui/notify`, share-sheet, haptics) are added as new method
names with their own allowlist entries; existing method semantics never change.
