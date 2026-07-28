# UI smoke — Stage 11: Live Apps refresh

Observably-works script for the live Apps list. Run on a device/emulator with a
reachable agent that declares `mcp-tools` + `mcp-apps-ui`:

```
npx mock-agent --token <t> --port 8787 --capabilities mcp-tools,mcp-apps-ui
```

Rides the stage-5 flag — `expo.extra.appsTabEnabled` — and adds none of its own.
Contracts are unchanged: no new route, no new capability, no new `_meta` key.

## What this stage does and does not do — read before running

Stage 11 refreshes on **three pull triggers**: the pull-to-refresh gesture, tab
focus, and a foreground-gated poll (60s, `RESOURCE_POLL_INTERVAL_MS`). It does
**not** subscribe to agent push. Push needs an additive upstream change
(**ADR 0006**, `seanerama/agent-app-contract#14`) and lands as its own stage.

> **RECORD WHICH TRIGGER FIRED** in every observation below. A tester who writes
> only "the list updated" makes this stage indistinguishable from the push stage
> in the release trail. Say *gesture*, *focus*, or *poll*.

The mock agent cannot change its resource list at runtime, so steps 4–6 restart
it with different `--capabilities` to change what `resources/list` answers. That
is the closest available stand-in for a mid-session publish until the upstream
`--mutate-resources` hook exists.

## Steps

1. **Baseline.** Connect to the agent, open the Apps tab → the list renders
   (against the mock: one row, `ui://mock-agent/home@v1`). There is **no
   "Refresh" text button** any more; the gesture replaced it.
   _Trigger: initial load._

2. **Pull-to-refresh works.** Pull down on the list → a refresh spinner appears
   at the top and clears. **The list stays on screen the whole time** — it must
   never blank to a "Loading the agent's apps…" placeholder.
   _Trigger: **gesture**._

3. **Focus refresh.** Switch to the Chat tab, then back to Apps. The list
   refreshes silently (no spinner needed, no flicker, no reordering).
   _Trigger: **focus**._

4. **A degraded agent does NOT cost you the list.** Stop the mock and restart it
   **without** the UI capability:
   `npx mock-agent --token <t> --port 8787 --capabilities mcp-tools`
   Pull to refresh → an amber notice appears: *"Couldn't refresh — showing the
   last known list. Pull down to try again."* **The previous list is still
   listed below it.** No fallback card, no empty screen.
   _Trigger: **gesture**._

5. **Recovery.** Restart the mock **with** `mcp-apps-ui` again and pull to
   refresh → the amber notice clears and the list is normal again. No reconnect,
   no app restart, no re-adding the connection.
   _Trigger: **gesture**._

6. **The list reconciles without reconnecting.** With the agent restarted and
   the app untouched since step 1, confirm the rows match what the agent now
   serves. Entries that did not change must not flicker or reorder.
   _Trigger: **gesture** or **poll** — record which._

7. **AN OPEN RESOURCE KEEPS RUNNING (ADR 0007 — the one that matters).** Open a
   resource. If it has interactive state, put some in (scroll it, type in a
   field, start an action). Now leave it open and let a refresh land underneath
   it — wait out the 60s poll, or background/foreground the app.
   - The resource **must not** reload, flash, re-render from scratch, or lose
     its state.
   - An action in flight when the refresh lands **must still complete**.
   _Trigger: **poll**. Record the wait._

8. **Vanished-while-open notice.** With a resource still open, restart the mock
   **without** `mcp-apps-ui`, then **with** it again so the list is re-fetched
   — or use any agent that stops serving the open resource. The open resource
   **keeps running regardless**. Back out of it with "‹ Apps" → a blue,
   dismissible notice reads *"<name> is no longer offered by this agent."*
   above the list. Tap it → it dismisses. It is never a modal, never a fallback
   card, and it never closed the resource for you.

9. **ui.home is not sticky.** Against an agent that declares `ui.home`: it
   auto-opens once on connect; back out to the list; let a refresh land (poll or
   pull). **You must NOT be yanked back into the home resource.**
   _Trigger: **poll** or **gesture**._

10. **Nothing else regressed.** Chat still sends and receives; the header
    identity and quick switcher still work; switching connections re-fetches the
    Apps list for the newly active agent.

## Record

- App version / APK:
- Agent + capabilities used:
- Trigger observed at each of steps 2, 3, 6, 7, 9:
- Step 7 — did the open resource survive, and was an action in flight? (y/n)
- Step 8 — did the notice appear and dismiss? (y/n)
- Result: PASS / FAIL + notes
