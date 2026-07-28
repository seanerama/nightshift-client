# 0006. Live Apps refresh via pull triggers; defer push to an additive SSE event type

- **Status:** Accepted
- **Date:** 2026-07-28

> Filename retains the original `…additive-s[se-notice]` slug: the first draft
> proposed reusing the existing `notice` event, and reading the canonical
> `schemas/v1/event-envelope.json` showed `notice` already has a defined
> reply-shaped payload. The decision below uses a **new event type** instead.
> ADR numbers are the identity; the slug is not worth breaking links over.

## Context

Once generative UI lands agent-side, a connected agent will publish new `ui://`
resources mid-session. Today the Apps tab never notices.

**Verified current behavior.** `resources/list` is fetched in
`src/app/apps.tsx` by a `useEffect` keyed on the active connection, so it runs
when `AppsBrowser` first mounts — the first visit to the Apps tab — and again
only when the active connection changes. Not on connect, not on tab re-focus,
never mid-session. Each `load()` also re-runs the MCP `initialize` handshake.
A manual "Refresh" text button already exists. Two of its behaviors are wrong
for a live-refresh world: a refresh blanks the whole tab to a loading
placeholder, and a failed refresh replaces the list with a `FallbackCard`,
destroying the last known good list.

The feature brief asked to subscribe to `notifications/resources/list_changed`
"on the MCP session" while making **no contract changes**. Those two
requirements are in direct conflict, and the conflict is not cosmetic:

- app-ingress v1 defines exactly one MCP route — `POST /app/v1/mcp`,
  request→response (canonical contract, routes table and §`POST /app/v1/mcp`).
  There is no `GET /app/v1/mcp`, no `Mcp-Session-Id`, and no SSE framing on the
  MCP endpoint.
- The canonical mock agent answers every MCP rpc with a single plain-JSON body
  and `202`s any client→server notification. There is no server→client MCP
  channel at all.
- `src/mcp/client.ts` is stateless by deliberate design (see its header):
  no session, no `notifications/initialized`, no listening stream.

**There is no MCP session to subscribe on.** `list_changed` is standard MCP, but
the `mcp-apps-ui` capability *as frozen* gates a request/response surface only.
Any push mechanism is therefore an additive change in `agent-app-contract`,
not a client-only change.

## Decision

Split the feature along the conflict line.

**Now, in this repo, with zero contract change** — build the entire refresh
engine and drive it from pull triggers:

- One `refreshResources()` code path, shared by every trigger.
- Triggers: **pull-to-refresh** on the Apps tab (replacing the text button —
  the `RefreshControl` spinner is non-blocking, which the failure-tolerance
  rule below requires anyway), **tab focus**, and a **foreground-gated poll**
  reusing the existing `shouldPoll(AppState, …)` house pattern from
  `src/connections/health.ts`.
- Debounce bursts; coalesce overlapping refreshes.
- Reconcile against the previous list: additions appear, removals leave,
  version bumps update.
- **A failed refresh leaves the last known list intact** — the `FallbackCard`
  stays reserved for the *initial* load failure, where there is no list to keep.

This works against every conforming agent, including agents that will never
emit a notification, and including today's mock.

**Later, as a separate small stage** — add genuine push by extending the SSE
stream the app already holds: the agent emits a **new event type** on
`GET /app/v1/events`, and the client routes it into the same
`refreshResources()`.

A **new type**, not a reuse of `notice`. `notice` already has a defined payload
meaning in the canonical contract — "proactive `send()` traffic, shaped like a
reply", which the conformance harness validates as reply-shaped. Overloading it
with a resources-changed body would corrupt an existing shape rather than extend
the contract. Invariant 3 sanctions exactly the alternative: the `type` set is
additively extensible, `type` is deliberately not an enum in
`schemas/v1/event-envelope.json`, and a v1.0 client MUST ignore types it does
not recognize. So a new type is the clean additive path — old clients and new
agents interoperate untouched, with no change to any existing shape.

It requires an upstream issue in `agent-app-contract` (the new event type plus a
`--mutate-resources` mock-agent hook so the case is testable), and does not
block this stage.

## Alternatives considered

The **contracts-first guide** says the seam is frozen and additive-only, and
that a breaking change is a new contract rather than an edit. Every option
below respects that; they differ in how much new surface they add.

- **Add `GET /app/v1/mcp` — a real MCP streamable-HTTP listening channel**,
  gated by a new capability string (the capability vocabulary is explicitly
  open). The most spec-correct answer, and the one that would carry *any*
  future MCP notification, not just this one. Rejected for now on cost: it
  means a new route, `Mcp-Session-Id` session machinery in a client whose
  statelessness is a documented simplification, plus mock-agent and
  conformance-harness work — a large surface bought for a single notification.
  If a second MCP notification is ever wanted, revisit this and supersede the
  SSE-event plan.
- **Do the upstream SSE work inside this stage**, shipping push and pull
  together. Meets the brief's Definition of Done in one pass, but makes a
  polish stage span two repos and blocks the client-side value — which is
  independently useful — behind upstream review. Rejected as scheduling, not
  as design: the SSE-event design itself is the one adopted above.
- **Poll `resources/list` aggressively as the only mechanism.** Simple, but a
  short interval burns battery and agent CPU for an event that is rare, while a
  long one misses the brief's "within seconds." Kept only as the slow
  backstop beneath the focus and gesture triggers.
- **Keep the existing Refresh button and add nothing else.** Honest about the
  contract limit, but leaves the discovery gesture non-standard and still
  destroys the list on a failed refresh. Rejected — the failure-tolerance and
  reconciliation work is needed regardless of what triggers it.

## Consequences

- The reconciliation, debounce, and failure-tolerance logic — the substantive
  and testable part of the brief — lands now and is trigger-agnostic. When the
  SSE event arrives it wires into an existing, already-tested seam: one new
  event branch, no new refresh logic.
- "Within seconds, no reconnect" is met by focus and poll rather than by push
  until that follow-on lands. The smoke doc must record which trigger fired,
  so the two stages are not confused for one another later.
- No change to app-ingress v1, ui-bridge v1, the sandbox, the allowlist, or the
  `mcp-apps-ui` capability. A refreshed list re-reads each resource's
  `_meta["ui/tools"]` exactly as a first load does.
- The refresh path continues to call MCP `initialize` before `resources/list`;
  the client holds no session to reuse. Cheap against a local agent, and
  revisiting it is a client-internal optimization, not a contract matter.
- One upstream issue is owed to `agent-app-contract`: the new event type
  and the `--mutate-resources` mock hook.
