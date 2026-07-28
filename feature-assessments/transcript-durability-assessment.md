# Feature assessment: transcript durability (stage 9)

*Intake/Planner Mode B, 2026-07-27. Request: vision feature #1 (idea.md §6),
invoked post-skeleton. Output: stage 9.*

## Claim/reality verification (live source)

| Claim | Reality | Consequence |
|---|---|---|
| Transcript is session-only | Confirmed: pure in-memory reducer (`src/chat/transcript.ts`), no persistence imports anywhere in `src/chat/` | Hydration + write-through layer needed |
| Cursor dies on restart | Confirmed: `lastEventIdRef` (hook ref), nulled on connection switch | Persist per-connection `last_event_id`; seed `initialLastEventId` |
| No catch-up client exists | Confirmed: no `/app/v1/outbox` caller in `src/api/` | New `getOutbox` — additive client function |
| Contract supports this as-is | Confirmed: `outbox-page.json` v1 — `{schema, events[]}` ascending; short/empty page = caught up; next cursor = last event id (single-cursor invariant, no second field) | No contract change; pagination loop is trivial |
| Schema can grow additively | Confirmed: migrations runner at v1, append-only by test | Migration v2; destructive-SQL regex guard extends |
| Reconnect/backoff needed | Already built (stage 4) with dedup-safe resume | OUT of scope — vision bullet partially pre-satisfied |

## Contract safety

`app-ingress` v1 untouched — the events/outbox triad was designed for exactly
this consumer behavior. `ui-bridge` unaffected. No new seam → no new
contract. No ADR: expo-sqlite as local state was decided at architecture time
(ADR 0001 / idea.md §4); this stage executes that decision.

## Decision: ACCEPT as ONE stage (9), depends-on 4

Not split: history persistence, cursor catch-up, and the offline queue share
one migration, one store seam, and one invariant ("state can't lie") —
shipping history without catch-up renders a transcript that lies about what
the agent said while the phone was away; a queue without persistence loses
composed text on process death. Reviewed as one coherent behavior.

## Kill-switch deviation (recorded)

Template default is OFF; stage 9 ships `transcriptPersistenceEnabled`
**default ON**: the installed cohort is the single owner, config flips
require a release anyway (sideload), and OFF-by-default ships the feature
inert. The flag's purpose here is fast kill, not dark launch. Migration v2 is
NOT gated (additive schema is safe standing alone).

## Carried forward (not this stage)

- Attachments both directions (vision #2) — `compose_queue.attachments`
  column reserved for it.
- Version indicator in Settings + release-cut/app.json version sync — chore
  candidates surfaced by the v0.1.x smoke cycles; next plan run.
- personId per-connection input (stage-4 note) — multi-agent stage.
