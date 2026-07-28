# Stage 10: Multi-agent switcher: header identity, quick switch, per-connection personId

- **Type:** feature
- **Depends on:** 3,9

## Objectives

Make holding N connections actually usable (vision feature #4, minus unread
indicators — deferred). Verified today: tab headers are static strings, so
nothing outside the Connections tab says WHICH agent you're talking to — with
2+ agents that is a send-to-the-wrong-agent hazard, not just polish; switching
is only possible from the Connections screen; and `personId` is a global
constant (`owner-nightshift`), which breaks the moment a second agent is
configured with a different owner id.

## What to build

1. **Header identity (Chat + Apps):** replace the static titles with a
   `headerTitle` component showing the active agent's name + the existing
   health dot (reuse `healthColor`/state from the connections context).
   No active connection → the static title stays.
2. **Quick switcher:** tapping the header identity opens a bottom
   sheet/modal (same in-screen modal pattern as the connection form — no new
   nav routes) listing all connections: agent name, base URL, active check.
   Tap → `setActive` (existing context call — stage-9 switching semantics:
   transcript hydrate, catch-up, stream re-key all already keyed off
   activeId) → sheet closes. Entry from both Chat and Apps headers.
   "Manage connections…" row links to the Connections tab.
3. **Per-connection personId (migration v3, additive):**
   - `connections` table: nullable `person_id` column (v3 append-only step);
     null semantics = "use the app default" (`OWNER_PERSON_ID`), so existing
     rows keep working unchanged.
   - Connection form: optional "Owner person id" field (defaulting
     placeholder shows the app default; help text explains the agent rejects
     mismatches with 403 — contract: configured out of band, like the token).
   - `ConnectionRecord`/`ActiveConnection` carry `personId` (resolved:
     stored value ?? `OWNER_PERSON_ID`); the THREE send sites use it —
     `use-chat-session` send + retry, and the drain deps. `person-id.ts`
     becomes the default only; no call site keeps a hardcoded constant.
   - personId is NOT a secret: plain column is correct (do not vault it).

## Interface contracts

- **Exposes:** header-identity + switcher components; resolved per-connection
  `personId` for every future send path (attachments stage).
- **Consumes:** frozen `contracts/app-ingress.md` (personId semantics
  unchanged — vestigial-but-required, 403 on mismatch); stage-3 connections
  store/context (setActive as-is); stage-9 per-connection isolation +
  migrations runner (v3 append; v1/v2 untouched). No new contract; no ADR.

## Testing requirements

- Unit: migration v3 (applies over v2, idempotent, additive-regex guard
  extended); record mapping with person_id null/set + resolution fallback;
  header-title selector logic (name + health, none-state); switcher list
  model (active marking, switch dispatch); every send path uses the ACTIVE
  connection's resolved personId (send, retry, drain — spy the built
  InboundMessage).
- Integration (mock agent): two mock agents with DIFFERENT `--owner-id`s —
  add both, switch between them, each send carries the matching personId and
  is accepted (and a deliberate mismatch still 403s → failed path).
  Switch-mid-session: transcripts stay isolated (extends the stage-9
  restart/catch-up scenarios across two live connections).
- UI-smoke asset (`docs/ui-smoke/stage-10-switcher.md`, ~10 steps): two
  connections → header shows active agent + dot → tap header → switch →
  chat history swaps to the other agent's, header updates → send to each →
  replies land in the right transcripts → edit one connection's person id to
  a wrong value → send fails with the rejected-token/403-style error.

## Acceptance conditions

- [ ] Kill-switch flag — WAIVED by planner, recorded: pure-UI affordances
      over existing switching semantics plus an additive nullable column with
      default-preserving resolution; no data risk a flag could mitigate;
      rollback = previous APK (migrations additive). Any scope growth beyond
      this voids the waiver.
- [ ] UI-smoke "observably-works" check authored (two-agent switch flows)
- [ ] Additive migration only (v3 append; v1/v2 untouched; regex guard
      extended)
- [ ] No hardcoded OWNER_PERSON_ID left at any send site (default-resolution
      only)
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO

## Deferred (recorded)

Unread/activity indicators for inactive connections — needs background
catch-up polling or push (its own deferred stage); revisit with the push
notifications decision.
