# 0010. Attachments: capture and upload before send, with queue-safe local copies

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

The owner asked to take a photo and send it in chat, and to attach a file and
send it in chat. This is vision feature #2 ("attachments both directions"); this
ADR covers the outbound half.

**Verified state — the wire is ready, the client is not.**

- `contracts/app-ingress.md` v1 already defines `POST /app/v1/uploads` →
  **201** `{ ok, uploadId, path }` and `GET /app/v1/files/<id>`, both gated by
  the `files` capability, and the mock agent serves them.
- `InboundMessage.attachments` is "upload ids", and that field is already
  plumbed end to end client-side: `chat-store`, `inbound.ts`, `drain.ts`,
  `memory.ts`, `sqlite-chat-store`, and the v2 migration all carry it — every
  one commented "reserved for the attachments stage", always `[]`.
- `CAPABILITY_FILES` is defined in `capabilities.ts` and **gates nothing**.
- `src/api/client.ts` exports `getManifest`, `postMessage`, `getOutbox`,
  `getHealth` — and **no upload function**.

So no contract change is needed and no schema migration is needed. What is
missing is the client half: pickers, the multipart upload, and the composer UI.

The design question that actually matters is **ordering against the offline
queue** (stage 9). A queued message is drained later, possibly much later. If a
queued message referenced a local file path, that path can be gone by drain
time — Android aggressively reclaims camera and cache URIs — and the message
would drain with a broken attachment, silently.

## Decision

- **Upload first, then send.** An attachment becomes an `uploadId` *before* the
  message is enqueued. `InboundMessage.attachments` therefore only ever carries
  ids the agent has already accepted, and the drain path stays exactly what it
  is today: post a message with an array of strings. No new failure mode inside
  the queue.
- **Offline capture is kept, not dropped.** When there is no connectivity, the
  picked file is **copied into app-owned storage** and the message is queued as
  *pending-upload*. On drain: upload the copy, obtain the id, then post. The
  local copy is deleted once the upload succeeds. Copying is what makes this
  safe — a content URI from the camera or picker is not durable, our copy is.
- **Attachments gate on `files`.** The camera and attach affordances appear only
  when the active connection declares `files` — `CAPABILITY_FILES` finally gates
  something. An agent without it shows a text-only composer, as today.
- **Two entry points, one path.** "Take photo" (camera) and "Attach file"
  (document picker) differ only in how the local file is produced; both converge
  on one upload-and-attach routine.
- **Bounded and visible.** A size ceiling enforced client-side with a clear
  message (the contract defines a `413`-style body-too-large response, so the
  agent's limit is real); per-attachment progress and a cancel; a failed upload
  leaves the draft and the attachment in place to retry, and never silently
  sends a message missing its attachment.

## Alternatives considered

- **Queue the local file and upload at drain time for every send** (not just
  offline). Symmetrical and simple to describe. Rejected: it puts an operation
  that can fail on its own — and depends on a file still existing — inside the
  drain path, turning a durable "post this text" into "find this file, upload
  it, then post", which is exactly the fragility stage 9 was built to remove.
- **Reference local paths in the queue without copying.** Avoids duplicate
  bytes. Rejected: camera and picker URIs are not durable on Android; this is
  the silent-broken-attachment case.
- **Base64-inline small images into the message text.** No upload round-trip.
  Rejected: it bypasses the `files` capability the contract defines, bloats the
  transcript and outbox, and there is no message-side contract field for it —
  it would need a contract change to do properly, which the upload route already
  avoids.
- **Defer offline attachment capture entirely** (block the affordance when
  offline). Simplest correct thing. Rejected: "take a photo now, it sends when
  I'm back" is the actual use for a phone client whose agent lives on a tailnet;
  the copy-then-upload design buys it cheaply.

## Consequences

- **Two new dependencies**: `expo-image-picker` (camera + library) and
  `expo-document-picker`. Both are Expo-managed modules, consistent with
  ADR 0001. Camera and media permissions must be declared and requested, which
  is new permission surface for this app and a release-config check worth
  adding.
- **A new client-owned local-file lifecycle**: copies live in app storage until
  their upload succeeds. Orphans are possible if the app is killed mid-flight, so
  a sweep of unreferenced copies on startup belongs in the same stage that
  creates them.
- `src/api/client.ts` gains its first **multipart** request; everything there is
  JSON today. Fail-closed handling must match the existing house style, and the
  contract's **201** (not 200) is asserted exactly.
- The inbound half — rendering `AssistantReply.files` and downloading via
  `GET /app/v1/files/<id>` — is deliberately **not** in this ADR. It is additive
  and separately schedulable.
- This unblocks the useful version of ADR 0009: a generated tool form can offer
  a file input for tools like nightshift's technical-guide import, reusing this
  same upload routine.
