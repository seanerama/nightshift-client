# UI smoke — Stage 12: Shell polish (tab order, theme, copy)

Observably-works script for the app's own chrome. Needs one reachable agent;
step 8 needs a `ui://` resource, so use the mock with `mcp-apps-ui`:

```
npx mock-agent --token <t> --port 8787 --capabilities mcp-tools,mcp-apps-ui
```

No contract change and no new flag in this stage. It DOES carry an additive
migration (v4, `app_settings`) — an install upgrading from v0.4.0 must keep its
connections and transcripts.

## Steps

1. **Chat opens first.** Cold-launch the app. **Chat is the screen you land
   on** — not Connections. The tab bar reads, left to right:
   **Chat, Apps, Connections, Settings**.
   _(Before this stage the app opened on Connections.)_

2. **Upgrade preserved data.** If you sideloaded over v0.4.0 rather than a
   fresh install: your connections are still listed and chat history is intact.
   Migration v4 is additive; losing either is a FAIL.

3. **Settings is a real screen.** Open Settings → an **Appearance** section
   with **System / Light / Dark**, System selected, and a line explaining what
   the current choice means. (It was an empty placeholder before.)

4. **Dark applies everywhere, instantly.** Choose **Dark**. Without restarting,
   walk every surface and confirm each is dark with legible text and **no white
   flashes** as screens mount:
   - Chat — bubbles, the composer bar, the input, the stream banner
   - Apps — list rows, the heading, pull-to-refresh
   - Connections — rows, health dot, the **+** button
   - Add/Edit connection sheet — labels, inputs, buttons, the delete link
   - Quick switcher sheet (tap the header identity)
   - A fallback card (stop the agent, open a resource)

5. **Light applies the same way.** Choose **Light** → everything returns to the
   original look. Nothing should be washed out or unreadable.

6. **System follows the device.** Choose **System**, then flip the phone's
   own dark-mode toggle → the app follows both ways.

7. **The choice survives a restart.** Set Dark, force-close, relaunch → still
   dark, and Settings still shows Dark selected.

8. **AGENT-SERVED RESOURCES FOLLOW THE APP, NOT THE PHONE.** The important one.
   Set the **phone to Light** and the **app to Dark**. Open Apps → open a
   `ui://` resource → **the resource renders dark.** If it renders light, the
   raw device scheme is reaching the bridge instead of the resolved setting —
   which is the bug this stage exists to fix. Now set the app to **Light** with
   the **phone in Dark** and confirm the resource renders light.

9. **Copy a message.** Long-press one of **your own** messages → brief
   "Copied" → paste into any other app → exact text. Repeat on an **agent**
   reply that contains a code block → the pasted text includes the raw
   markdown fences, not just the visible lines.

10. **Copy does not disturb anything else.** A plain tap on a normal message
    does nothing; a tap on a **failed** message still retries (long-press it →
    copies instead of retrying).

11. **Manage connections still lands correctly.** Tap the header identity on
    Chat → **Manage connections…** → you arrive on **Connections**.
    _(`/` is Chat after this stage's rename; a link left pointing at `/` would
    silently land on Chat, which is why this step exists.)_

12. **Nothing else regressed.** Send a message and receive a reply; switch
    agents from the header; open and interact with a `ui://` resource.

## Record

- App version / APK:
- Upgrade or fresh install? (step 2 only applies to upgrades):
- Step 4 — any screen that stayed light or flashed white? (list them):
- Step 8 — resource followed the APP setting in both directions? (y/n):
- Step 9 — agent code-block copy included the fences? (y/n):
- Step 11 — landed on Connections? (y/n):
- Result: PASS / FAIL + notes
