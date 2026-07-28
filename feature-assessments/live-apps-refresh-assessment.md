# Feature assessment — Live Apps Refresh

- **Date:** 2026-07-28
- **Source:** owner feature brief, "Live Apps Refresh (nightshift-client)"
- **Verdict:** **ACCEPT (split)** — client-side engine as **stage 11**; push
  half **DEFERRED** to a later stage gated on an additive upstream change.
- **Artifacts:** ADR 0006, ADR 0007, `stage-instructions/stage-11-*.md`,
  design.md addendum.

## Claim / reality — verified against live source before planning

| # | Brief's claim or assumption | Reality in the codebase | Verdict |
|---|---|---|---|
| 1 | "Subscribe to `notifications/resources/list_changed` **on the MCP session**" | There is no MCP session. app-ingress v1 defines exactly one MCP route, `POST /app/v1/mcp`, request→response (canonical contract routes table + §`POST /app/v1/mcp`). No `GET /app/v1/mcp`, no `Mcp-Session-Id`, no SSE framing. The canonical mock agent answers every rpc with plain JSON and `202`s client→server notifications — **no server→client channel exists**. `src/mcp/client.ts` is stateless by documented design: no session, no `notifications/initialized`, no listening stream. | **FALSE** — not implementable client-side |
| 2 | "No contract changes" (req 4) | Holds for everything except (1). The two requirements are mutually exclusive. | **CONFLICT** — resolved by ADR 0006 |
| 3 | "`list_changed` is standard MCP within the existing `mcp-apps-ui` capability" | True of MCP-the-spec; **false of app-ingress v1 as frozen** — `mcp-apps-ui` gates a request/response surface only (`initialize`, `resources/list`, one `ui://` read). | **MISLEADING** |
| 4 | "Manual pull-to-refresh … as the universal fallback" | A plain **"Refresh" text button already exists** (`src/app/apps.tsx`). The pull *gesture* does not. | **PARTIALLY EXISTS** — upgrade, not net-new |
| 5 | "a re-fetch failure leaves the last known list intact" | Today a failed load sets `{status:'error'}` and the tab renders a `FallbackCard` **in place of the list**. | **MUST BE BUILT** |
| 6 | "A list change MUST NOT reload or tear down a currently rendered resource" | Worse than the brief assumes. `ResourceView` memoizes its bridge session on `[resource, connection, onClose]` and disposes the previous one. `resource` comes from `list.resources.find(…)`, and `listResources` builds **fresh objects every fetch** → any refresh changes identity → **`session.dispose()` on a running resource, killing in-flight `tools/call`s**. `onClose` is an inline arrow, so it already changes identity on every re-render. | **REAL HAZARD** — promoted to ADR 0007 |
| 7 | "rides the existing Apps feature flag (no new flag)" | `APPS_TAB_ENABLED` exists and gates the tab via `href: null` in `_layout.tsx`. | **TRUE** |
| 8 | "a refreshed list re-reads each resource's `_meta['ui/tools']` as usual" | `deriveAllowlist` reads exactly that key per resource, inside `ResourceView`'s memo. Unchanged by this work. | **TRUE** |
| 9 | "current mock-agent cannot change its list at runtime" | Confirmed — static resource set, no mutate hook. | **TRUE** |
| 10 | Implied: a tab-focus refresh needs new navigation plumbing | `useFocusEffect` is exported by **expo-router itself**. **No new dependency.** | **BETTER THAN ASSUMED** |
| 11 | Implied: foreground gating must be invented | `shouldPoll(appState, hasActive)` already exists in `src/connections/health.ts` with an established start/stop + `AppState` listener shape in the provider. | **REUSE EXISTS** |
| 12 | Implied risk: connection identity churn would defeat snapshotting | `active` is memoized on `[activeRecord, vault]`; `health` is **not** in its deps, so 30s health polling does **not** churn connection identity. No pre-existing teardown bug. | **SAFE** |

Item 6 is the finding that most changes the work: the brief framed open-resource
safety as a UX nicety ("the user discovers changes in the list, not by losing
state"), but the current wiring would dispose the **bridge session** — an
in-flight `tools/call` would die, not merely a scroll position. That is why it
became an ADR with a standing regression test rather than a spec bullet.

## Decision and rationale

**Split along the contract line** (owner-confirmed):

- **Stage 11 (accepted, client-only, zero contract change):** the entire refresh
  engine — reconciliation, debounce, keep-last-list-on-failure, open-resource
  safety — driven by pull-to-refresh + tab focus + a foreground-gated poll.
- **Deferred stage (blocked on upstream):** genuine push, via a **new event
  type** on the SSE stream the app **already holds and already reconnects**,
  rather than a new MCP channel. Additive by construction: invariant 3 states
  the event-type set is additively extensible, `type` is deliberately not an
  enum in `schemas/v1/event-envelope.json`, and clients MUST ignore
  unrecognized types — so old clients and new agents interoperate untouched.
  **Not** a reuse of `notice`: reading the canonical schema while filing the
  upstream issue showed `notice` already has a defined reply-shaped payload
  that the conformance harness validates, so overloading it would corrupt an
  existing shape rather than extend the contract. ADR 0006 corrected.

Rejected: adding `GET /app/v1/mcp` with real streamable-HTTP session machinery.
Most spec-correct and it would carry any future MCP notification, but it buys a
new route + session state in a deliberately stateless client + mock-agent and
conformance-harness work, all for one notification. Revisit only if a second MCP
notification is ever wanted (recorded in ADR 0006).

Rejected: doing the upstream work inside this stage. It would make a polish
stage span two repos and block independently useful client value behind upstream
review.

## Impact and contract safety

**No new contract; no frozen contract threatened.** `app-ingress` v1 and
`ui-bridge` v1 are byte-unchanged, and that is an explicit acceptance condition.
No new route, no new capability string, no new `_meta` key. The sandbox and
allowlist rules are untouched; notably, an open resource keeps the allowlist
derived from its opening snapshot, so a refresh can neither widen nor narrow a
running resource's tool access mid-flight — a security-relevant consequence of
ADR 0007 worth the Reviewer's attention.

No schema change, so the additive-migration condition is N/A. No new dependency.
The kill-switch condition is **waived** — the brief mandates riding
`APPS_TAB_ENABLED`, and the risk profile (no schema change, no new wire traffic
beyond a call the tab already makes, rollback = previous APK) does not warrant a
second flag. The waiver is void if scope grows into MCP session work.

## Honest gap against the brief's Definition of Done

"Publish a new resource mid-session → it appears within seconds, no reconnect"
is met by **focus + poll**, not by push, until the deferred stage lands. The
UI-smoke doc must record which trigger fired so the two stages are not conflated
in the release trail later. Everything else in the DoD — pull-to-refresh against
any agent, an open dashboard surviving a list change undisturbed, suites green,
smoke doc recorded — is fully in stage 11.

## Owed elsewhere — filed

**`seanerama/agent-app-contract#14`** (upstream repo; blocks neither stage):

- (a) a **new event type** for "resources changed" on `GET /app/v1/events` —
  additive per invariant 3, explicitly not a reuse of `notice`. Raises three
  open questions for the upstream planner: bare signal vs. describing payload
  (recommend bare), capability gating under `mcp-apps-ui`, and whether these
  events persist in the durable outbox or are live-only — the last is the one
  that could surprise an implementer, since a long catch-up would otherwise
  replay every historical resources-changed event.
- (b) a `--mutate-resources` mock-agent hook, so a mid-session list change is
  integration-testable at all. Independently useful; can land before (a).
