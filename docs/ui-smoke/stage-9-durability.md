# UI smoke — Stage 9: Transcript durability (restart history, offline queue, catch-up)

Operator script for the durability "observably works" check: history survives
a force-kill, offline composes queue and drain themselves, and events missed
while the app was away arrive via `/outbox` catch-up.

## Setup

1. Start the mock agent exactly as in `stage-4-chat.md` (same `--owner-id
   owner-nightshift` requirement), or use a live agent.
2. Launch the release/preview APK, add + activate the connection, open Chat.
3. Confirm the kill-switch is in its shipped position: `app.json`
   `expo.extra.transcriptPersistenceEnabled` is `true` (default ON — recorded
   planner deviation; setting it to `false` and rebuilding must restore the
   stage-4 in-memory behavior: empty transcript on every launch, offline
   sends fail instead of queueing).

## Script

| # | Step | Expect |
|---|------|--------|
| 1 | Send `ping`, wait for the reply | Same as stage 4: **Accepted** + `mock-agent received: ping` bubble |
| 2 | Force-kill the app (recents → swipe away, or Settings → Force stop) | App fully dead |
| 3 | Reopen the app, go to Chat | History present **instantly** on open — the `ping` exchange renders from local SQLite before the stream reconnects; no duplicate rows appear once it does (persisted cursor = `Last-Event-ID`) |
| 4 | Enable airplane mode | Banner degrades (Reconnecting…/Offline). The composer stays ENABLED |
| 5 | Compose `queued one`, tap Send | Bubble shows **Queued — sends when reconnected** (not Failed) |
| 6 | Compose `queued two`, tap Send | Second queued bubble under the first |
| 7 | Disable airplane mode | Both bubbles flip Sending… → **Accepted** in compose order; exactly ONE reply arrives for each (drain re-POSTs the original messageId — the dedup key); banner returns to Connected |
| 8 | Airplane mode ON again → compose `killed while queued` (shows Queued) → force-kill the app | App dead with a queued message on disk |
| 9 | Airplane mode OFF → reopen the app → Chat | The queued bubble is still there (hydrated as Queued), then drains: **Accepted** + exactly one reply. Nothing sent twice |
| 10 | With the app killed (not backgrounded), post extra agent traffic (e.g. from another tool: `curl -H "Authorization: Bearer <token>" -H 'content-type: application/json' -d '{"schema":1,"messageId":"<uuid>","personId":"owner-nightshift","text":"while you were away","attachments":[],"receivedAt":"<now>"}' http://<host>:8787/app/v1/messages`), then reopen | The missed reply appears via `/outbox` catch-up on session start — present in the transcript before/as the stream connects, exactly once |

## Notes

- Step 3 is the core claim of the stage: the transcript can no longer lie
  across restarts. If history is empty after a force-kill, persistence is
  broken (or the flag is OFF).
- Steps 5–9 exercise the queue exactly-once path end to end, including
  process death with rows queued.
- Kill-switch verification (release-blocking only if it fails CLOSED): a
  build with `transcriptPersistenceEnabled: false` must behave exactly like
  the stage-4 script (`stage-4-chat.md` steps 6–7: offline send = **Failed —
  tap to retry**; restart = empty transcript).
