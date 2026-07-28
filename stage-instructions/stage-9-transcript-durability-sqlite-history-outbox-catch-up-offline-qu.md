# Stage 9: Transcript durability: SQLite history, outbox catch-up, offline queue

- **Type:** feature
- **Depends on:** 4

## Objectives

Make the conversation state unable to lie across restarts and dead zones —
the first post-skeleton feature stage (vision feature #1). Today (verified):
the transcript is an in-memory reducer, the resume cursor is a ref that dies
with the process, there is no `/outbox` client call, and messages composed
offline are simply failed sends. After this stage: history renders instantly
on open from local SQLite, missed events are recovered via cursor catch-up,
and offline-composed messages queue and send themselves when the link
returns. (SSE reconnect/backoff from the old vision bullet already exists —
stage 4 — and is NOT in scope.)

## What to build

1. **Migration v2 (append-only, additive):** per-connection tables —
   `transcript_items` (connection_id, kind user|agent, message_id nullable,
   event_id nullable, event_type, text, files JSON, send_state, at,
   insertion order key), `stream_cursors` (connection_id pk, last_event_id),
   `compose_queue` (message_id pk, connection_id, text, attachments JSON,
   queued_at). NO token columns anywhere (stage-3 invariant). Never touch
   migration v1.
2. **Persistence layer** (`src/chat/` beside the reducer, behind a store
   seam + in-memory fake like stage 3's): the reducer STAYS pure — a
   write-through subscriber maps reducer transitions to row upserts;
   hydration on connection activation loads history (cap: newest 500 items
   per connection, pruning additively) and seeds `initialLastEventId` from
   `stream_cursors` instead of null.
3. **Outbox catch-up** (`src/api/` addition `getOutbox(connection, after)`
   per contracts/app-ingress.md): on session start, foreground, and SSE
   reconnect, page `GET /app/v1/outbox?after=<cursor>` — ascending, next
   cursor IS the last event's `id`, a short/empty page means caught up
   (contract deliberately has no second cursor field) — feeding each event
   through the SAME reducer/dedup path as live SSE, then hand the stream the
   updated cursor. Catch-up and stream sharing one dedup set is what makes
   the overlap window safe (already true by stage-4 design).
4. **Offline compose queue:** a send attempted with no reachable agent (or
   while the stream is offline) persists as `send_state: queued`; a drain
   loop on reconnect/foreground re-POSTs each with its ORIGINAL messageId
   (contract dedup makes at-least-once safe — same invariant as stage-4
   retry). Extend SendState with 'queued'; composer stays enabled while
   offline. Failed-after-drain returns to the existing failed/retry path.
5. **Flag:** `transcriptPersistenceEnabled` (expo extra, same pattern as
   `appsTabEnabled`): OFF → stage-4 in-memory behavior exactly (no reads,
   no writes; migration still applies — additive schema is not gated).
   **Planner deviation from the default-OFF template, recorded:** default ON —
   the installed cohort is the single owner, sideload config flips require a
   new APK anyway, and OFF-by-default would ship the release inert. The flag
   exists to kill the feature in one config release if persistence
   misbehaves.

## Interface contracts

- **Exposes:** durable transcript + cursor + queue stores (the attachments
  stage will extend `compose_queue.attachments`; the multi-agent stage relies
  on per-connection isolation established here).
- **Consumes:** `contracts/app-ingress.md` §events/§outbox (frozen — the
  outbox-page envelope, event-envelope ids as the single cursor concept);
  stage-3 `ConnectionStore`/migrations runner; stage-4 reducer, SSE client,
  and dedup semantics. No new contract; no ADR (expo-sqlite already decided,
  ADR 0001 / idea.md §4).

## Testing requirements

- Unit: hydration mapping (rows → TranscriptState, including seen-event-id
  reconstruction from agent rows); write-through subscriber (every reducer
  transition lands as the right upsert; token strings never serialized);
  catch-up pagination (multi-page → short page terminates; events flow
  through dedup — replaying an applied page is a no-op); queue drain (same
  messageId re-POST, success → accepted, failure → failed; drain order =
  queued_at); migration v2 (applies over v1, idempotent, no destructive
  statements — extend the stage-3 regex test); flag OFF → no store calls
  (spy).
- Integration (mock agent, existing harness): compose while stream down →
  events accrue agent-side → catch-up returns them in order and the
  transcript converges (compare against a never-disconnected run); simulated
  restart (new store over the same sqlite fake / file) → history + cursor
  survive, stream resumes with `Last-Event-ID` from the persisted cursor and
  no duplicates; queued message drains on reconnect exactly once.
- UI-smoke asset (`docs/ui-smoke/stage-9-durability.md`, ~10 steps): chat →
  force-kill the app → reopen → history present instantly; airplane mode →
  compose two messages (show queued state) → airplane off → both send once,
  replies arrive; kill app while airplane-mode messages queued → reopen →
  queue drains.

## Acceptance conditions

- [ ] Kill-switch flag present (`transcriptPersistenceEnabled`; default ON —
      planner deviation recorded above; OFF restores stage-4 behavior)
- [ ] UI-smoke "observably-works" check authored (restart + airplane flows)
- [ ] Additive migration only (v2 append; regex guard extended; v1 untouched)
- [ ] No token material in any new table, row, or serialized state (test)
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO
