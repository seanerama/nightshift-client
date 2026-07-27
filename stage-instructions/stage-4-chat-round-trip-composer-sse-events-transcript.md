# Stage 4: Chat round-trip: composer, SSE events, transcript

- **Type:** feature
- **Depends on:** 3

## Objectives

The core walking-skeleton slice on the app side: send "ping" from the phone,
get `202`, receive the reply over SSE, render it in the transcript. Async by
construction — the POST never returns the reply (contract MUST).

## What to build

- **Chat screen:** transcript (FlashList + markdown renderer for
  `AssistantReply.text`), composer, connection-state banner
  (connected / reconnecting / offline).
- **Send path:** `POST /app/v1/messages` with the InboundMessage shape from
  `agent-app-contract/types` — client-generated UUID `messageId` (the dedup
  key), `personId` pinned to owner, `receivedAt` ISO-8601; optimistic
  transcript insert; `202 { ok, messageId }` marks it accepted.
- **Receive path:** SSE client on `GET /app/v1/events` (authenticated) for the
  active connection; handle `ack` | `reply` | `notice`; track the last event
  id and send `Last-Event-ID` on reconnect (in-session resume). Simple
  backoff-and-retry on drop. NOTE: React Native has no native EventSource —
  the builder picks an RN-compatible SSE client (or a small fetch-stream
  implementation) and records the choice in the PR.
- **Scope guard:** transcript persistence beyond the session, offline compose
  queue, and cross-restart cursor catch-up via `/outbox` are the *transcript
  durability* stage — NOT here. Keep this stage to the live round-trip.

## Interface contracts

- **Exposes:** transcript store + SSE event pump that the durability stage
  hardens; the send/receive plumbing the Apps stage's fallback rendering uses.
- **Consumes:** `contracts/app-ingress.md` — messages/events/outbox triad
  semantics, event envelope, InboundMessage/AssistantReply shapes. Stage 3's
  `activeConnection`.

## Testing requirements

- Unit: InboundMessage construction (UUID dedup key, shape validates against
  the schema), event-envelope parsing for all three v1 event types, backoff
  logic.
- Integration (CI): against the mock agent — post message → `202` → `ack` and
  `reply` arrive over SSE → transcript store holds them in order; drop the
  stream mid-conversation → reconnect with `Last-Event-ID` resumes without
  duplication.
- UI-smoke asset: documented script — send "ping" on the device → reply
  renders in the transcript; airplane-mode toggle → banner degrades and
  recovers.

## Acceptance conditions

- [ ] Kill-switch / dark-launch flag (default OFF) for this net-new feature —
      N/A accepted by planner (pre-first-release core surface; see stage 3
      rationale)
- [ ] UI-smoke "observably-works" check authored for the Chat surface
- [ ] Additive migration only (no destructive schema change)
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO

## External dependency (tracked, non-blocking for this stage)

Certification here is against the **mock agent**. The live-device smoke against
nightshift-assistant needs the agent-side `/app/v1/` transport module
(`APP_TRANSPORT_ENABLED`) — verified absent from
`nightshift-assistant/src/transport/` today; tracked as a cross-repo work item
in that repo. The walking-skeleton exit criterion (phone ↔ live assistant) is
gated on it, this stage's merge is not.
