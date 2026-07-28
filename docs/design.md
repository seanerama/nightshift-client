# Nightshift Client — Technical Design (Architect handoff)

*Produced by the Architect role, 2026-07-27. Source vision: [`idea.md`](../idea.md).
Consumed by `/verity:plan` to cut the initial backlog of stages.*

## Summary

A thin Expo (managed) + TypeScript Android app that is a native shell over
agent-served UI. It speaks exactly one wire contract, `app-ingress` v1, to any
conforming agent (nightshift-assistant first), and exposes exactly one surface
to agent-authored UI resources, `ui-bridge` v1. Everything else — dashboards,
forms, custom views — is server-delivered; the app ships rarely.

## Decisions (ADRs)

| ADR | Decision |
|---|---|
| [0001](adr/0001-expo-managed-workflow-typescript-for-the-mobile-shell.md) | Expo managed workflow + TypeScript; types codegen'd from contract schemas |
| [0002](adr/0002-thin-native-shell-over-agent-served-ui-three-repo-topology.md) | Thin shell over agent-served UI; three repos with neutral `agent-app-contract` |
| [0003](adr/0003-chat-over-rest-sse-with-durable-outbox-tools-and-ui-over-mcp.md) | Chat = REST + SSE + durable outbox; tools/UI = MCP; files = REST |
| [0004](adr/0004-webview-sandbox-no-token-in-webview-mediated-postmessage-bridge.md) | Per-resource sandboxed WebView; no token in WebView; mediated bridge; mandatory fallback |
| [0005](adr/0005-releases-via-eas-cloud-builds-published-to-github-releases.md) | EAS cloud builds → APK on GitHub Releases (catalog method `eas-github-releases`) |
| [0006](adr/0006-live-apps-refresh-via-pull-triggers-defer-push-to-an-additive-s.md) | Live Apps refresh: pull triggers now (no contract change); push deferred to an additive SSE event type |
| [0007](adr/0007-rendered-resource-lifetime-is-decoupled-from-the-resource-list.md) | A list change never reloads or tears down a rendered resource |

## Frozen contracts

- [`contracts/app-ingress.md`](../contracts/app-ingress.md) — v1, canonical in
  the `agent-app-contract` repo (this copy is the pinned mirror). Includes the
  optional manifest `ui.home` field (idea.md §7 open question: **resolved yes**,
  optional in v1).
- [`contracts/ui-bridge.md`](../contracts/ui-bridge.md) — v1, owned by this repo;
  the postMessage JSON-RPC surface for `ui://` resources.

Both are additive-only. The Reviewer gates every PR against them.

## Topology & deployment

- Repos: `agent-app-contract` (seam), `nightshift-client` (shell, this repo),
  `nightshift-assistant` (agent; work tracked there, dark behind
  `APP_TRANSPORT_ENABLED`).
- Images: none for the app itself — the deploy artifact is an APK.
  `ghcr.io/seanerama/nightshift-client` remains reserved for any future
  service (e.g. a hosted mock agent), extending per-service if ever needed.
- Delivery: tag → GitHub Actions → EAS build (Android, `production` profile,
  APK) → attached to the GitHub Release → sideload. Access details in
  `.verity/deploy-access.md` (gitignored).

## Accepted features

- **From the drop-in catalog:** none. `helper-bot` (In-App Help Agent) was
  offered and **declined** for MVP — the shell has no backend of its own; help
  can arrive later as an agent-served `ui://` resource with zero app changes.
- **From the vision (idea.md §6), in dependency order after Stage 0:**
  1. Transcript durability (SQLite history, cursor catch-up, offline queue, SSE reconnect/backoff)
  2. Attachments both directions
  3. Control surface (Apps screen, polished jobs dashboard, status resource)
  4. Multi-agent (N connections, isolation, capability gating)
  5. Parity dual-run & checklist (gates any Webex retirement — separate plan)
- **Deferred (all additive to v1):** push notifications, token streaming,
  generative UI, native bridge capabilities (voice/share/haptics), iOS.

## Walking skeleton — Stage 0 (blocks all feature stages)

The thinnest end-to-end slice proving the spine: contract → agent → phone →
`ui://` round-trip, green in CI, released.

1. **Contract repo exists:** `agent-app-contract` with `app-ingress.md` v1,
   JSON Schemas for every wire shape, example payloads, mock agent, and the
   conformance harness (`npx agent-app-conformance <url> --token <t>`); its CI
   runs the harness against the mock agent.
2. **Agent side (in nightshift-assistant):** `/app/v1/` routes live behind
   `APP_TRANSPORT_ENABLED` on the dev server; outbox migration; bearer auth;
   tailnet bind; MCP server with the five tools; `ui://nightshift/jobs@v1`.
   Harness passes over the tailnet. Smoke-tested with curl + an SSE client +
   MCP Inspector **before any mobile code exists**.
3. **App shell:** Expo app on the physical Android device; add connection
   (URL + token → SecureStore) → manifest fetch → send "ping" → `202` → reply
   arrives over SSE → renders in the transcript.
4. **UI round-trip:** fetch `ui://nightshift/jobs@v1`, render in the sandboxed
   WebView, one real action (tap Kill → bridge → MCP tool → job killed → UI
   refreshes), with the markdown fallback path exercised.
5. **CI green everywhere + released:** harness in contract & agent CI; mock-
   agent harness + typecheck + unit tests + schema codegen in app CI; one
   tagged EAS build lands on the GitHub Release page and installs on the
   device. `STATUS.md` updated.

**Exit criterion:** the phone converses with the live assistant and kills a
real job, with Webex still running untouched beside it.

## Standing risks (carried from idea.md §7)

- Mobile SSE suspension → Stage-1 reconnect + cursor catch-up; outbox
  durability is therefore Stage 0, not later.
- No typing indicator with `relay()` latency → v1 UX target is Webex parity;
  streaming deliberately deferred.
- WebView rigor is day-one (ADR 0004), not hardening.

---

# Addendum — Live Apps Refresh (2026-07-28)

*Architect pass over the "Live Apps Refresh" feature brief, against the shipped
v0.3.0 codebase. ADRs [0006](adr/0006-live-apps-refresh-via-pull-triggers-defer-push-to-an-additive-s.md)
and [0007](adr/0007-rendered-resource-lifetime-is-decoupled-from-the-resource-list.md).*

## Current behavior — verified, as the brief required

`resources/list` is fetched by a `useEffect` in `src/app/apps.tsx` keyed on the
active connection. It therefore runs:

- when `AppsBrowser` first mounts — **the first visit to the Apps tab**, not at
  connect time; and
- again **only when the active connection changes**.

Not on tab re-focus, not on reconnect, never mid-session. Each `load()` also
re-runs the MCP `initialize` handshake. A manual **"Refresh" text button already
exists** (`apps.tsx`). Two of its current behaviors are wrong for live refresh
and change in this feature: a refresh **blanks the tab** to a loading
placeholder, and a **failed refresh replaces the list with a `FallbackCard`**,
destroying the last known good list.

## The brief's internal conflict, and how it was resolved

Requirement 1 (subscribe to `notifications/resources/list_changed`) is **not
implementable under requirement 4** (no contract changes). app-ingress v1
defines exactly one MCP route, `POST /app/v1/mcp`, request→response; there is no
`GET /app/v1/mcp`, no `Mcp-Session-Id`, no SSE framing on the MCP endpoint, and
the canonical mock agent has no server→client MCP channel. `src/mcp/client.ts`
is stateless by design. **There is no MCP session to subscribe on.**

Resolved by splitting along that line (ADR 0006) — the owner chose this:

- **This stage (client-only, zero contract change):** the whole refresh engine,
  driven by pull triggers.
- **Follow-on stage (needs an additive upstream change):** genuine push, via a
  new event type on the existing SSE stream rather than a new MCP channel.

## Design of the refresh engine

One code path, `refreshResources()`, shared by every trigger — present and
future. The pieces:

| Concern | Design |
|---|---|
| Triggers (this stage) | pull-to-refresh gesture (`RefreshControl`, **replacing** the text button); tab focus; foreground-gated poll reusing `shouldPoll(AppState, …)` from `src/connections/health.ts` |
| Trigger (follow-on) | new SSE event type → same entry point, one new branch |
| Debounce | coalesce bursts; overlapping refreshes collapse to one in-flight fetch |
| Reconcile | additions appear, removals leave, version bumps update the list entry |
| Failure | **last known list stays intact**; `FallbackCard` is reserved for the *initial* load, where there is no list to keep |
| Open resource | untouched — pinned by an owned descriptor snapshot (ADR 0007) |
| Vanished-while-open | non-blocking dismissible notice on next visit to the tab; never a modal |
| Flag | rides the existing `APPS_TAB_ENABLED` — **no new flag** |

The reconciliation, debounce, and failure-tolerance logic is the substantive and
testable part, and it is **trigger-agnostic**: the follow-on push stage adds an
event branch, not new refresh logic.

## Contracts — unchanged

`app-ingress` v1 and `ui-bridge` v1 are **untouched**; no new contract is cut.
The sandbox, the allowlist derivation, and the `mcp-apps-ui` capability are
unchanged — a refreshed list re-reads each resource's `_meta["ui/tools"]`
exactly as a first load does. Deployment target is unchanged (ADR 0005).
No drop-in catalog feature applies (`helper-bot` remains declined).

## Owed upstream

One small issue in `agent-app-contract`, tracked there, blocking neither stage:

1. A **new event type** for "resources changed" on `GET /app/v1/events`
   (additive — invariant 3 states the event-type set is additively extensible,
   `type` is deliberately not an enum in `schemas/v1/event-envelope.json`, and
   unknown types MUST be ignored), which the follow-on push stage consumes.
   **Not** a reuse of `notice`: that type already carries a defined
   reply-shaped payload, so overloading it would corrupt an existing shape
   rather than extend the contract.
2. A `--mutate-resources` mock-agent hook, so the live list-change case becomes
   integration-testable. Until it exists, the integration case is covered by
   pull-to-refresh against a restarted mock with different `--capabilities`.

## Slice handed to `/verity:plan`

Stage 0 is long since done — the spine is proven and shipped through v0.3.0.
The thin slice for the next stage is:

1. `refreshResources()` with debounce, reconciliation, and keep-last-list-on-
   failure, unit-tested against a faked MCP client.
2. Pull-to-refresh replacing the Refresh button; focus + foreground-poll
   triggers.
3. The ADR 0007 invariant enforced and unit-tested: open resource survives a
   refresh that drops or bumps it; `ui.home` auto-open does not re-fire.
4. Vanished-while-open notice.
5. Suites green; UI smoke doc (`docs/ui-smoke/stage-11-live-apps.md`) recording
   **which trigger fired**, so this stage is never mistaken for the push stage.

The push stage follows once the upstream event-type extension lands.

## Handoff

Next: **`/verity:plan`** decomposes this design into the initial thin backlog —
Stage 0 first (it blocks everything), then feature stages 1–5 above.
