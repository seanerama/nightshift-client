# Stage 11: Live Apps refresh: reconciling resource list, pull-to-refresh, open-resource safety

- **Type:** feature
- **Depends on:** 5,10

## Objectives

Make the Apps tab reflect an agent's `ui://` resources as they are *now*, not as
they were the first time the tab was opened — without ever costing the user a
running resource.

Verified today: `resources/list` is fetched by one `useEffect` in
`src/app/apps.tsx` keyed on the active connection, so it runs on the **first
visit to the Apps tab** and again **only on connection switch**. Not on
re-focus, not on reconnect, never mid-session. Once generative UI lands
agent-side, newly published resources are invisible until force-close.

This stage builds the **whole refresh engine** — reconciliation, debounce,
failure tolerance, open-resource safety — and drives it from **pull triggers
only**. Genuine push is a separate, later stage: it requires an additive change
in `agent-app-contract`, and the brief's requirement 1 (subscribe to
`notifications/resources/list_changed`) is **not implementable** under its own
requirement 4 (no contract changes). See ADR 0006 for the evidence and the
split. The engine here is deliberately trigger-agnostic so the push stage adds
one event branch and no new refresh logic.

## What to build

Two ADRs govern this stage and are binding:
[0006](../docs/adr/0006-live-apps-refresh-via-pull-triggers-defer-push-to-an-additive-s.md),
[0007](../docs/adr/0007-rendered-resource-lifetime-is-decoupled-from-the-resource-list.md).

1. **Refresh engine as a pure module** (house style — `src/app/apps.tsx` must
   stay thin, like `resource-view.tsx`; all decisions live in tested pure
   modules under the node jest project).
   - A reducer over list state with the states the UI needs distinguished:
     *initial load* vs *refreshing over a known list* vs *failed refresh over a
     known list*. Today's single `{status:'loading'}` collapses the first two
     and blanks the tab; that is the bug behind requirements 1 and 3.
   - **Reconcile** a newly fetched list against the previous one: additions
     appear, removals leave, changed entries (name / mimeType / `_meta`, i.e. a
     version bump publishing `…@v2`) update. Deterministic ordering, so a
     refresh that changed nothing produces a stably-equal list and no visible
     churn.
   - **Debounce + coalesce:** bursts collapse; a refresh requested while one is
     in flight does not start a second fetch. Debounce interval is a named
     exported constant (mirroring `HEALTH_POLL_INTERVAL_MS`).
   - **Failure tolerance:** a failed refresh **keeps the last known list** and
     surfaces a non-blocking indication. `FallbackCard` stays reserved for the
     *initial* load failure, where there is no list to keep — do not widen it.
2. **Triggers**, all routed into the single `refreshResources()` entry point:
   - **Pull-to-refresh** — `RefreshControl` on the existing `ScrollView`,
     **replacing** the current "Refresh" text button (`apps.tsx`). The gesture
     is non-blocking by construction, which is what (1) needs.
   - **Tab focus** — `useFocusEffect`, exported by **expo-router** itself
     (`node_modules/expo-router/build/exports.d.ts`); **no new dependency**.
   - **Foreground-gated poll** — reuse `shouldPoll(AppState.currentState, …)`
     from `src/connections/health.ts` and the provider's start/stop +
     `AppState.addEventListener('change', …)` shape. Do not invent a second
     foreground-gating pattern. Interval is its own named constant; it is the
     slow backstop beneath focus and gesture, not the primary mechanism.
3. **Open-resource safety (ADR 0007) — the highest-risk item; verified hazard.**
   `ResourceView` builds its bridge session in a `useMemo` keyed
   `[resource, connection, onClose]` and disposes the old one via
   `useEffect(() => () => session.dispose(), [session])`. Two live problems:
   - `resource` currently comes from `list.resources.find(…)`, and
     `listResources` constructs **fresh descriptor objects** every fetch — so any
     refresh changes `resource` identity and **disposes the bridge session of a
     running resource, killing in-flight `tools/call`s.**
   - `onClose` is an inline arrow (`onClose={() => setOpenUri(null)}`), so it
     already gets a new identity on every `AppsBrowser` re-render — and a
     refresh causes a re-render.

   Required: pin the open resource to an **owned descriptor snapshot** captured
   at open time (never re-derived from the live list), give `onClose` a stable
   `useCallback` identity, and keep `ResourceView`'s React key stable. Comment
   the snapshot as *intentionally* divergent from the list, or a later reader
   will "fix" it back into a lookup and silently restore the teardown.
4. **Vanished-while-open notice.** A resource that disappears from the list
   while open keeps running. On next visit to the tab, a dismissible
   non-blocking line above the list says it is gone. Never a modal, never a
   `FallbackCard`, never an auto-close.
5. **`ui.home` auto-open must not re-fire on refresh.** Its guard already keys
   on `connection.id` but its effect keys on `list`; a refresh must not yank the
   user back to the home resource. Cover with a test.

Explicitly **not** in this stage: any MCP notification subscription, any
`Mcp-Session-Id` or listening-channel work, any change to `src/mcp/client.ts`'s
stateless request/response design.

## Interface contracts

- **Exposes:** `refreshResources()` as the single refresh entry point, plus the
  list reducer + reconciliation as pure modules — the seam the deferred push
  stage attaches its SSE event branch to.
- **Consumes:** frozen `contracts/app-ingress.md` (`POST /app/v1/mcp`,
  `resources/list` — **unchanged**, no new route, no new capability) and frozen
  `contracts/ui-bridge.md` (**unchanged**; sandbox invariants and the
  `_meta["ui/tools"]` allowlist derivation are untouched — a refreshed list
  re-reads them exactly as a first load does, and an open resource keeps the
  allowlist derived from the snapshot it was opened with, so a refresh can
  neither widen nor narrow a running resource's tool access mid-flight).
  Stage 5's `ResourceView`/bridge; stage 10's connections context (`active`
  identity is memoized on `[activeRecord, vault]` — health polling does **not**
  churn it, verified). **No new contract. ADRs 0006 + 0007 already written.**

## Testing requirements

House pattern: pure logic in the **node** jest project (`*.test.ts`); component
structure in the **jest-expo/android** project (`*.test.tsx`, react-test-renderer
— there is no `@testing-library/react-native` in this repo).

- **Unit (node), against a faked MCP client seam:**
  - Reconciliation: addition / removal / version bump (`@v1`→`@v2`) / `_meta`
    change / no-op refresh produces a stably-equal list.
  - Debounce + coalesce: a burst of N requests yields ONE fetch; a request
    during an in-flight fetch does not start a second.
  - Failure tolerance: fetch rejects → previous list intact, non-blocking
    indication set; a *later* success recovers. Distinguish initial-load
    failure (→ `FallbackCard`) from refresh failure (→ keep list).
  - Reducer never enters a state that blanks the tab when a known list exists.
- **Unit (tsx), the ADR 0007 invariant — standing regression gate:**
  - Open a resource, refresh with a list that (a) drops it and (b) bumps it;
    assert the rendered descriptor is the snapshot, the `ResourceView` instance
    is **not** remounted, and `session.dispose()` was **not** called.
  - `ui.home` auto-open fires once per connection and **not** on refresh.
  - Vanished-while-open: notice appears on return to the list, is dismissible,
    and does not replace the list.
- **Integration (mock agent):** the canonical mock **cannot change its resource
  list at runtime** (verified — static resources, no mutate hook). Cover what is
  coverable: pull-to-refresh against a **restarted mock with different
  `--capabilities`** produces a reconciled list without reconnecting the app.
  The live list-change case is **deferred**, not skipped — it lands with the
  upstream `--mutate-resources` hook (see *Deferred*). Do not block on it.
- **UI-smoke asset** (`docs/ui-smoke/stage-11-live-apps.md`, ~8 steps): connect
  → open Apps → pull-to-refresh → restart the mock with a different
  `--capabilities` → pull again, list reconciles with **no reconnect** → open a
  resource, refresh underneath it, confirm it keeps running and its state
  survives → confirm the vanished-while-open notice.
  **The doc MUST record which trigger fired** (gesture / focus / poll), so this
  stage is never later mistaken for the push stage.

## Acceptance conditions

- [ ] Kill-switch flag — **WAIVED by planner, recorded:** rides the existing
      `APPS_TAB_ENABLED` flag per the brief's house-style requirement (no new
      flag). Justified: no schema change, no new wire traffic beyond an existing
      authenticated `resources/list` call the tab already makes, and rollback is
      the previous APK. Any scope growth beyond this spec — in particular any
      MCP session/notification work — voids the waiver.
- [ ] UI-smoke "observably-works" check authored, **recording the trigger used**
- [ ] Additive migration only — **N/A, no schema change in this stage**
- [ ] ADR 0007 invariant covered by test: a refresh never remounts or disposes a
      running resource's bridge session
- [ ] A failed refresh provably leaves the last known list intact
- [ ] `contracts/app-ingress.md` and `contracts/ui-bridge.md` byte-unchanged
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO

## Deferred (recorded)

- **Push: `list_changed` → live update without a gesture.** Needs the additive
  upstream SSE event type (ADR 0006). Becomes its own small stage once
  `agent-app-contract` ships it; it wires into `refreshResources()` from this
  stage and adds no new refresh logic.
- **Upstream issue owed to `agent-app-contract`** — filed as
  `seanerama/agent-app-contract#14`; does not block this stage: (a) a **new
  event type** for "resources changed" on `GET /app/v1/events` — additive per
  invariant 3, and deliberately *not* a reuse of `notice`, whose payload is
  already defined as reply-shaped; (b) a `--mutate-resources` mock-agent hook so
  the live list-change case becomes integration-testable.
- **Version-bump reload prompt** ("this app was updated — reload?"). Rejected
  for v1 as unnecessary interruption (ADR 0007); clean additive follow-up.
- **Reusing an MCP session across refreshes.** Each refresh still calls
  `initialize` before `resources/list`; the client holds no session. Cheap
  against a local agent, and a client-internal optimization if it ever matters.
