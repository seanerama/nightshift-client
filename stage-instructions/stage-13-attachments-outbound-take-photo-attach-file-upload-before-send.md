# Stage 13: Attachments outbound: take photo, attach file, upload before send

- **Type:** feature
- **Depends on:** 9,12

## Objectives

Send a photo or a file with a chat message. Vision feature #2, outbound half.

Governed by [ADR 0010](../docs/adr/0010-attachments-capture-and-upload-before-send-with-queue-safe-loca.md).

**The wire is already built; the client half is not.** Verified: `POST
/app/v1/uploads` (→ **201** `{ ok, uploadId, path }`) and `GET
/app/v1/files/<id>` are in frozen app-ingress v1 and served by the mock agent;
`InboundMessage.attachments` is plumbed through `chat-store`, `inbound.ts`,
`drain.ts`, `memory.ts`, `sqlite-chat-store.ts` and the **v2 migration** —
always `[]`, commented "reserved for the attachments stage". So **no contract
change and no schema migration** are needed. What is missing: `CAPABILITY_FILES`
gates nothing, `src/api/client.ts` has no upload function, and there are no
pickers.

## What to build

1. **Upload client.** First **multipart** request in `src/api/client.ts` (all
   JSON today). Same fail-closed house style as its siblings; assert the
   contract's **201** exactly, not 2xx. Surface the contract's body-too-large
   response as a clear user-facing message.
2. **Two entry points, one path.** "Take photo" (`expo-image-picker`) and
   "Attach file" (`expo-document-picker`) differ only in how the local file is
   produced; both converge on one upload-and-attach routine.
   **Three new dependencies, all verified absent:** `expo-image-picker`,
   `expo-document-picker`, **and `expo-file-system`** — the last is required for
   the offline copy below and was undercounted as "two" in ADR 0010.
   Declare and request camera/media permissions; extend
   `scripts/check-release-config.mjs` so the new permission surface is checked
   at release time (memory: unknown `app.json` fields are silently ignored —
   verify at the artifact level, not the config level).
3. **Upload before send.** An attachment becomes an `uploadId` *before* the
   message is enqueued, so `attachments` only ever carries ids the agent has
   accepted and the stage-9 drain path stays "post text + array of strings".
   Nothing that can fail on its own moves into the drain.
4. **Offline capture, safely.** With no connectivity, copy the picked file into
   app-owned storage and queue the message as *pending-upload*; on drain, upload
   the copy → get the id → post → delete the copy. Copying is the point: camera
   and picker URIs are **not durable** on Android, and referencing one directly
   is the silent-broken-attachment case.
5. **Orphan sweep** on startup for local copies with no owning queue row (the
   app can be killed mid-flight).
6. **Gate on `files`.** The camera/attach affordances appear only when the
   active connection declares `files` — `CAPABILITY_FILES` finally gates
   something. Without it the composer is text-only, exactly as today.
7. **Composer UX.** Per-attachment progress and cancel; a failed upload leaves
   the draft *and* the attachment in place to retry; a message is **never** sent
   silently missing its attachment.

## Interface contracts

- **Exposes:** the upload-and-attach routine — reused by stage 14 for
  file-typed tool inputs.
- **Consumes:** frozen `contracts/app-ingress.md` — `POST /app/v1/uploads`,
  `GET /app/v1/files/<id>`, `InboundMessage.attachments`, the `files`
  capability. All pre-existing; **byte-unchanged**. Stage 9's durable queue and
  drain. `contracts/ui-bridge.md` untouched. **No new contract.**

## Testing requirements

- **Unit (node):** upload client — 201 accepted, non-201 rejected (including a
  200), malformed body rejected, oversize mapped to the user-facing message;
  upload-before-send ordering (a message is never enqueued with a local path);
  offline path — copy made, queued pending-upload, drain uploads then posts then
  deletes; a failed drain upload leaves the row queued and the copy intact;
  orphan sweep deletes unreferenced copies and **only** those.
- **Unit (tsx):** composer shows attach affordances only when `files` is
  declared; a failed upload keeps draft + attachment.
- **Integration (mock agent):** real multipart round-trip against the mock —
  upload → id → send a message carrying it → **agent accepts**; and an agent
  started **without** `files` (route 404s per contract) → the affordance is
  absent and nothing is uploaded.
- **UI-smoke** (`docs/ui-smoke/stage-13-attachments.md`): photo → send →
  appears; file → send → appears; airplane mode → take a photo → send → queued
  → restore connectivity → it drains and the agent receives it; oversize file →
  clear message, nothing sent; agent without `files` → no affordances.

## Acceptance conditions

- [ ] Kill-switch flag — **REQUIRED** (net-new feature, new permission surface,
      new local-file lifecycle). Default OFF; dark-launch in release builds
      following the `APPS_TAB_ENABLED` pattern in `src/config/flags.ts`.
- [ ] UI-smoke asset authored, including the offline-capture-then-drain case
- [ ] Additive migration only — **N/A, no schema change** (`attachments` already
      exists from migration v2)
- [ ] Upload asserts **201**, not 2xx
- [ ] No message can be enqueued referencing a local path
- [ ] `check-release-config.mjs` extended for the new permissions
- [ ] `contracts/app-ingress.md` and `contracts/ui-bridge.md` byte-unchanged
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO

## Deferred (recorded)

- **Inbound attachments** — rendering `AssistantReply.files` and downloading via
  `GET /app/v1/files/<id>`. Additive, separately schedulable, and the natural
  next stage.
- Image compression/resizing before upload; multiple attachments per message if
  one proves limiting.
