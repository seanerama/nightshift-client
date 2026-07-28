# UI smoke — Stage 4: Chat round-trip (composer, SSE events, transcript)

Operator script for the Chat surface's "observably works" check. Runs against
the mock agent (or a live agent once its `/app/v1/` transport ships).

## Setup

1. Start the mock agent on a machine the phone can reach (tailnet or LAN),
   with the owner id the app pins (`src/chat/person-id.ts`):

   ```sh
   npx --package=github:seanerama/agent-app-contract#v1.0.0 \
     mock-agent --token <a-fake-dev-token> --port 8787 --owner-id owner-nightshift
   ```

   The `--owner-id` flag matters: the app sends `personId: owner-nightshift`
   on every message and the agent 403s a mismatch (contract invariant 4). A
   live agent must have its owner id configured to the same value.

2. Launch the app (dev client or release APK) and, on the Connections tab,
   add the agent (`http://<host>:8787` + the token). Make it active; the
   health dot should go green.

## Script

| # | Step | Expect |
|---|------|--------|
| 1 | Open the Chat tab | Composer + empty transcript. Banner: against a live agent, **Connected** within a second or two. MOCK QUIRK: the mock only flushes the SSE response with its first event, so with an empty outbox the banner stays **Reconnecting…** until step 2's send — this is contract-legal (clients must not infer liveness from absent keep-alive pings) and not a bug |
| 2 | Type `ping` and tap Send | The message appears immediately, right-aligned, marked **Sending…** |
| 3 | Watch the same bubble | Marker flips to **Accepted** (202 + ack — sub-second against the mock) |
| 4 | Wait for the reply | `mock-agent received: ping` renders as an agent bubble. NOTE the recorded stage-4 markdown choice: plain text with paragraph spacing (+ monospaced fenced code blocks); inline `**bold**` renders literally |
| 5 | Enable airplane mode | Banner degrades to **Reconnecting…** (backoff retries continue while the app is foregrounded) |
| 6 | Send `hello?` while offline | The bubble goes **Failed — tap to retry** (fail-closed send) |
| 7 | Disable airplane mode | Banner recovers to **Connected**; any events missed during the drop catch up over the resumed stream (`Last-Event-ID`) without duplicating earlier ones |
| 8 | Tap the failed `hello?` bubble | Same bubble returns to **Sending…** then **Accepted**; exactly ONE reply arrives for it (retry reuses the same messageId — the dedup key) |
| 9 | Background the app ~10s, then foreground it | Stream stops in background (banner may show **Offline** on the way out); on return it reconnects and catches up, no duplicate transcript rows |
| 10 | Switch the active connection away and back (Connections tab) | Transcript clears on switch (in-memory, per-session by stage scope); the chat reconnects to the newly active agent |

## Out of scope here (durability stage)

Transcript persistence across app restarts, offline compose queue, and
`/outbox` cursor catch-up across restarts are explicitly NOT in stage 4 —
a restart starting from an empty transcript is correct behavior today.
