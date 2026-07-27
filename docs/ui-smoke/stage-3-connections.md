# UI smoke: Stage 3 — Connections

Operator script for the Connections surface. Needs: the installed app and a
reachable conforming agent — either a live agent on the tailnet or the mock
agent from the contract package (`npx mock-agent --token <token> --port 8787`
from a machine the phone can reach). Have its URL and token ready.

1. Launch the app. The Connections tab shows "No agents yet".
2. Tap the "+" button. The Add connection form opens with URL and token fields
   (token entry is masked).
3. Enter a WRONG token with the correct URL and tap Save. An inline error
   appears ("The agent rejected the token…") and NO connection is added.
4. Enter the correct URL + token and tap Save. The form closes; the connection
   appears in the list showing the agent's name and version (from its
   manifest) and its base URL, marked Active.
5. Within a few seconds the health dot next to the name turns GREEN.
6. Open the Chat tab: it must NOT say "Add and activate a connection…" (with a
   chat-capable agent it shows the stage-4 placeholder). The Apps tab reflects
   the agent's `mcp-apps-ui` capability the same way.
7. Kill the agent process. Within ~30 seconds (or immediately after
   backgrounding and re-foregrounding the app) the dot turns RED. Restart the
   agent: the dot returns to GREEN.
8. Add a second connection (any conforming agent). It appears inactive; tap
   "Make active" and the health dot moves to it (grey "Checking…" first, then
   its real state).
9. Long-press a connection and confirm Delete (or open it and use "Delete this
   connection"). It disappears from the list.
10. Tap "+" and re-enter the SAME agent URL: the token field is empty — the
    deleted token is gone from secure storage and must be re-entered.
