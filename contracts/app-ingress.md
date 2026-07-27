# Contract: app-ingress

- **Status:** frozen v1
- **Owner:** `agent-app-contract` repo (neutral ground — ADR 0002). **Canonical
  is RELEASED: `github.com/seanerama/agent-app-contract` tag `v1.0.0`** — this
  file is the repo-local summary mirror; on any discrepancy the canonical
  `contracts/app-ingress.md` at the pinned tag wins. Consume via
  `npm i github:seanerama/agent-app-contract#v1.0.0` (root package exports
  `/types`, `/conformance`, `/mock-agent`, `/schemas/*`; bins
  `agent-app-conformance` and `mock-agent`; Node >= 22). Bump the pin to pick
  up additive changes; never edit shapes here first.

## Exposes

Agent-side HTTP surface, bearer-token auth on **every** route
(per-connection token, `NIGHTSHIFT_API_TOKEN` pattern), reachable over a
private network (tailnet); fail closed, ack fast, work off the request path.

| Route | Purpose |
|---|---|
| `GET /app/v1/manifest` | Discovery/handshake: agent name+version, contract name+version, `capabilities` array, optional `ui.home` |
| `POST /app/v1/messages` | Inbound chat; `202 { ok, messageId }` immediately, `relay()` off-path |
| `GET /app/v1/events` | SSE server→client: `reply`, `notice`, `ack`; supports `Last-Event-ID` resume |
| `GET /app/v1/outbox?after=<cursor>` | Catch-up fetch of undelivered events (durable outbox) |
| `POST /app/v1/uploads` | Multipart upload → **201 Created** `{ ok, uploadId, path }` (agent's `uploads/<ts>-<name>` layout) |
| `GET /app/v1/files/<id>` | Authenticated download for `AssistantReply.files` |
| `POST /app/v1/mcp` | MCP streamable HTTP: control tools + MCP Apps `ui://` resources |
| `GET /app/v1/health` | `{ ok, version, uptimeSec }` — **authenticated like every route; the contract has no anonymous route** |

MCP (canonical requirement): initialize + `tools/list` (gated by `mcp-tools`),
`resources/list` + at least one readable `ui://` resource in `text/html`, per
MCP Apps (SEP-1865), named `ui://<agent>/<name>@v<N>` (gated by `mcp-apps-ui`).
The five nightshift tools (`status`, `jobs_list`, `jobs_submit`, `jobs_kill`,
`session_rotate`) are **nightshift-assistant's implementation surface**, not a
contract requirement — the app must discover tools via `tools/list`, never
hardcode this list.

## Consumes

- **From the app:** InboundMessage shape reused verbatim — `schema: 1`,
  client-generated UUID `messageId` (dedup key), `personId` pinned to owner,
  `text`, `attachments` (upload ids), `receivedAt`.
- **From the agent's internals:** `App.jobs` / `App.sessions` (tools are 1:1
  wrappers); durable `outbox` table (id, type, payload, createdAt, deliveredAt)
  in the agent's SQLite.

## Schema / wire

Manifest (v1, with the optional `ui.home` addition decided at freeze):

```json
{
  "schema": 1,
  "agent": { "name": "nightshift-assistant", "version": "…" },
  "contract": { "name": "app-ingress", "version": 1 },
  "capabilities": ["chat", "files", "mcp-tools", "mcp-apps-ui"],
  "ui": { "home": "ui://nightshift/jobs@v1" }
}
```

- `ui` and `ui.home` are OPTIONAL; clients must treat their absence as "no home
  resource" and fall back to the MCP resource listing.
- The app adapts to `capabilities` rather than assuming them (an agent without
  `mcp-apps-ui` simply shows no Apps tab).
- SSE event envelope: `id` (outbox cursor), `event` (`reply` | `notice` |
  `ack`), `data` (JSON; `reply` carries the AssistantReply shape).
- Chat is REST+SSE, never MCP tool calls (ADR 0003). Messaging is async — no
  request/response replies.
- Canonical JSON Schemas for every shape, example payloads, the mock agent,
  and the conformance harness (`npx agent-app-conformance <url> --token <t>`)
  live in `agent-app-contract`. An agent is "supported" when the harness
  passes; app CI runs the harness's mock agent, agent CI runs it against
  itself. App TypeScript types are generated from those schemas in CI.

## Versioning

Frozen at **v1**. Changes are **additive only** — a breaking change is a NEW
contract, not an edit (framework-spec §4.3). Every consumer depends on this shape.
Known planned additions (all additive, deferred): push registration, a token
`stream` SSE event type, generative-UI resource endpoints.
