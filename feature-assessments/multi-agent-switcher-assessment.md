# Feature assessment: multi-agent switcher (stage 10)

*Intake/Planner Mode B, 2026-07-28. Request: user discussion — "choosing the
active connection should change the UI" → the gaps that make 2+ connections
usable. Output: stage 10.*

## Claim/reality verification (live source)

| Claim | Reality | Consequence |
|---|---|---|
| Switching already re-keys the whole UI | Confirmed: `setActive` (atomic CASE in sqlite) → context refresh → chat effect keyed on activeId resets/hydrates/catches-up/re-streams (stage 9); capability gating re-evaluates; Apps refetches | Stage builds UI affordances ONLY — switching semantics already correct |
| No agent identity outside Connections | Confirmed: `_layout.tsx` static `title` strings for all four tabs | Header identity component (name + health dot) |
| No quick switcher | Confirmed: only `index.tsx`'s make-active pressable | Header-tap sheet, reusing the in-screen modal pattern |
| personId is global | Confirmed: `OWNER_PERSON_ID` constant used at `use-chat-session.ts:175` (send), `:264` (retry), and drain deps; no `person_id` column anywhere | Migration v3 nullable column + resolution fallback; second-agent correctness requirement, carried from the stage-9 assessment |

## Contract safety

`app-ingress` v1 untouched — personId semantics stay exactly contractual
(vestigial-but-required, out-of-band configured, 403 on mismatch); this stage
only moves WHERE the app sources the value. `ui-bridge` unaffected. No new
seam, no ADR (UI affordances + additive schema on decided storage).

## Decision: ACCEPT as ONE stage (10), depends-on 3,9

The three pieces are one usability unit: identity display without switching
is a tease, switching without identity is the wrong-agent hazard, and a
second connection without per-connection personId simply fails against any
agent whose owner id differs. **Deferred out**: unread/activity indicators
(need background polling or push — revisit with the push-notifications
decision).

## Kill-switch waiver (recorded)

Pure-UI affordances over already-shipped switching semantics + an additive
nullable column with default-preserving resolution. No data risk a flag could
mitigate; rollback = previous APK. Scope growth voids the waiver.

## Carried forward (not this stage)

- Unread/activity indicators (above).
- Attachments both directions (vision #2) — next natural feature stage.
- Version indicator in Settings + release-cut/app.json version sync (chores,
  still unplanned).
