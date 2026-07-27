# 0003. Chat over REST+SSE with durable outbox; tools and UI over MCP

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The wire protocol between app and agent must survive the mobile network stack:
background suspension drops long-lived streams, the phone is frequently offline,
and there is no push channel in the MVP. The house design rules apply: fail
closed, ack fast and work off the request path, state can't lie, frozen v1 /
additive-only. MCP (with the Apps/SEP-1865 extension) exists as a plausible
transport for *everything*, so the split needs to be deliberate.

## Decision

Two planes inside one contract (`app-ingress` v1):

- **Chat plane — plain REST + SSE.** `POST /app/v1/messages` reuses the existing
  InboundMessage shape verbatim (client-generated UUID as dedup key) and returns
  `202` immediately; `relay()` runs off-path. Server→client traffic flows over
  `GET /app/v1/events` (SSE with `Last-Event-ID` resume) backed by a **durable
  outbox** table in the agent's SQLite; `GET /app/v1/outbox?after=<cursor>`
  provides catch-up on app open. Delivery model without push: "while connected,
  plus catch-up on open" — nothing is lost while the phone is away.
- **Tools + UI plane — MCP streamable HTTP** at `POST /app/v1/mcp`: five control
  tools (`status`, `jobs_list`, `jobs_submit`, `jobs_kill`, `session_rotate`)
  as thin doors over existing internals, and MCP Apps `ui://` resources
  (`text/html`) rendered by the app's sandboxed WebView.
- Files get dedicated authenticated REST endpoints (`/uploads`, `/files/<id>`),
  retiring the Webex chunker with no size caps.

## Alternatives considered

- **Everything over MCP** (chat as tool calls). Conversation through
  request/response tool-call semantics is awkward — no natural async reply,
  notices, or resumable delivery. Tools and UI are exactly what MCP is for;
  conversation is not.
- **WebSockets instead of SSE.** Bidirectional, but the client→server direction
  is already covered by plain POSTs (which compose with the offline queue and
  dedup UUIDs); SSE is simpler, proxies cleanly, and `Last-Event-ID` gives
  resume semantics for free.
- **Polling only (no stream).** Simplest, but turns Webex-parity latency into
  poll-interval latency and burns battery; the outbox + cursor design already
  provides the polling path as the *fallback* (catch-up), so the stream is pure
  upside.

## Consequences

- Outbox durability must exist in Stage 0 (it is the delivery guarantee, not an
  optimization); reconnect/backoff + cursor catch-up is the standing mitigation
  for mobile stream suspension.
- Token streaming later is additive: a new SSE event type, no contract break.
- Push notifications later change only the wake-up path; the outbox/cursor
  delivery model is unchanged.
