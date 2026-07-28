# UI smoke — Stage 10: Multi-agent switcher (header identity, quick switch, per-connection personId)

Operator script for the multi-agent "observably works" check: the Chat/Apps
headers say WHICH agent is active, the header opens a quick switcher, and each
connection sends with its own owner person id (wrong id = the agent's 403).

## Setup

1. Start TWO mock agents with DIFFERENT owner ids (two terminals):
   - `npx mock-agent --token token-alpha --port 8787 --owner-id owner-alpha`
   - `npx mock-agent --token token-beta --port 8788 --owner-id owner-nightshift`
     (agent B deliberately uses the app default id — its connection's
     "Owner person id" field stays BLANK to prove the null→default fallback).
2. Launch the release/preview APK with a device/emulator that can reach both.

## Script

| # | Step | Expect |
|---|------|--------|
| 1 | Connections → add agent A (URL `:8787`, token `token-alpha`, **Owner person id** `owner-alpha`). Note the field's placeholder and help text | Placeholder shows the default (`owner-nightshift`); help text says blank = default and that the agent 403s mismatches. Connection saves; A is active (first connection) |
| 2 | Add agent B (URL `:8788`, token `token-beta`, Owner person id left **blank**) | B saves, A stays active |
| 3 | Open the Chat tab | Header shows **agent A's name + a health dot** (green once health polls), not the static "Chat" title |
| 4 | Send `hello alpha` | **Accepted** + `mock-agent received: hello alpha` reply — A accepted `owner-alpha` (per-connection id works) |
| 5 | Tap the header identity | Bottom sheet opens listing BOTH connections (name + base URL), with the check on A, plus a "Manage connections…" row |
| 6 | Tap agent B's row | Sheet closes; header now shows **B's name + dot**; the transcript swaps to B's (empty) history — `hello alpha` is gone from view |
| 7 | Send `hello beta` | **Accepted** + reply — B accepted the DEFAULT person id (blank field → `owner-nightshift`) |
| 8 | Tap the header → switch back to A | A's transcript returns exactly as left (`hello alpha` exchange, no `beta` rows); header shows A again |
| 9 | Open the Apps tab | Same header identity + tap-to-switch behavior as Chat (switcher opens from Apps too). "Manage connections…" lands on the Connections tab |
| 10 | Connections → edit A → set Owner person id to `owner-wrong` (re-enter the token) → save → Chat → send `should fail` | Bubble goes **Failed — tap to retry** (the agent refused with 403 — NOT "Queued"); fix the field back to `owner-alpha` (re-enter token), tap the failed bubble to retry → **Accepted** + reply |

## Notes

- Step 3/5/6 are the stage's core claim: with 2+ agents you can always SEE
  which agent will receive a send, and switch without leaving the screen.
- Step 10 verifies the 403 mismatch takes the failed/retry path (403 is an
  HTTP refusal, not unreachability — it must never sit in the offline queue).
- No kill-switch exists for this stage (waived by the planner: pure-UI
  affordances + an additive nullable column; rollback = previous APK).
- With NO active connection (delete/deactivate all), the Chat/Apps headers
  fall back to the static "Chat"/"Apps" titles and are not tappable.
