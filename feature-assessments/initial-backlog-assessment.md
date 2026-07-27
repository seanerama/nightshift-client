# Initial backlog assessment (Mode A decomposition)

*Intake/Planner, 2026-07-27. Input: `docs/design.md` (Architect handoff) +
`idea.md`. Output: stages 1–5 + one cross-repo work item.*

## Claim/reality verification (against live source)

| Claim (design / idea.md) | Reality (verified) | Impact on plan |
|---|---|---|
| Contract repo must be *created* in Stage 0 | **Already done and released**: `~/projects/agent-app-contract` = `seanerama/agent-app-contract` at tag **v1.0.0** — schemas/v1 (8 shapes), examples, conformance CLI (`agent-app-conformance`), mock agent serving the whole v1 surface, types package, green CI (built via its own Verity flow, stages 1–5 + release) | Walking-skeleton item 1 dropped; app stages **consume the pin** |
| App CI codegens TS types from JSON Schemas | Types are pre-built and shipped by the package (`agent-app-contract/types` export; `npm i github:seanerama/agent-app-contract#v1.0.0` builds workspaces via `prepare`) | No codegen step in this repo — amend ADR 0001's assumption; drift is still a compile error via the pinned tag |
| `ui.home` open question needs deciding | Canonical v1 manifest schema/example already includes optional `ui.home` | Matches the Architect's freeze; nothing to do |
| Uploads → `{ok, uploadId, path}` (status unstated, mirror implied 200) | Canonical: **201 Created** | Mirror corrected |
| Health mirrors existing `/health` (historically unauthenticated) | Canonical: **no anonymous route** — health is bearer-authenticated | Mirror corrected; stages 1/3 must auth health calls |
| Five MCP tools are part of the contract | Canonical requires initialize + `tools/list` + ≥1 `ui://` resource; the five tools are nightshift-assistant implementation detail | Mirror corrected; app discovers tools via `tools/list`, never hardcodes |
| Agent has `/app/v1/` routes behind `APP_TRANSPORT_ENABLED` | **Absent**: `nightshift-assistant/src/transport/` has only Webex-era modules (api, chunker, dedup, deliver, send, server, webex, remarkable); no `app/` dir, no flag. `NIGHTSHIFT_API_TOKEN` + fail-closed control pattern confirmed in `src/config.ts` | Cross-repo work item filed in `nightshift-assistant`; app stages certify against the mock agent meanwhile |
| InboundMessage reused verbatim | Confirmed in `nightshift-assistant/src/types.ts:8` (`schema: 1`, messageId, personId, text, attachments, receivedAt) and frozen in the contract's `inbound-message.json` | Import the shape from `agent-app-contract/types` |

## Contract safety

No new seams. Both frozen contracts (`app-ingress` v1 canonical in the contract
repo; `ui-bridge` v1 owned here) cover stages 1–5. The repo-local `app-ingress`
mirror was corrected to match canonical (201 uploads, authenticated health,
tools-are-agent-specific) — summary-mirror fix, not a shape change. No ADR
needed; the ADR 0001 codegen amendment is recorded here and in stage 1.

## Decision

**ACCEPT + SPLIT** the walking skeleton into five thin, dependency-ordered
stages (each one PR):

| Stage | Type | Depends | Slice |
|---|---|---|---|
| 1 | chore | — | Expo workspace + toolchain + contract consumption; CI spine |
| 2 | chore | 1 | Release spine: tag → EAS build → APK on GitHub Releases → device install |
| 3 | feature | 1 | Connections: add agent, manifest handshake, capability gating, health |
| 4 | feature | 3 | Chat round-trip: composer → 202 → SSE reply in transcript |
| 5 | feature | 3 | Apps: sandboxed WebView + ui-bridge v1 + one tool round-trip |

Release pipeline promoted to stage 2 (before features) per the
walking-skeleton principle — deploy proven before feature stages ship through
it.

**Walking-skeleton exit** (design.md): stages 1–5 done **plus** the agent-side
transport module — cross-repo item in `nightshift-assistant` (idea.md §5:
outbox migration, `send()` dual-write, `/app/v1/` routes, MCP server + five
tools, `ui://nightshift/jobs@v1`, harness green over the tailnet, all dark
behind `APP_TRANSPORT_ENABLED`). That work is planned and reviewed in that
repo's own flow; this repo only tracks the dependency.

**DEFERRED** (next /verity:plan runs, after the skeleton closes): transcript
durability, attachments both directions, control-surface polish, multi-agent
switching, parity dual-run checklist — the accepted list in `docs/design.md`.
Deferred-from-catalog: `helper-bot` (declined by owner at Architect stage).

## Kill-switch policy note

Stages 3 and 4 waive the feature-flag acceptance item (pre-first-release
surfaces; no installed cohort exists to protect — the first release IS these
stages). Stage 5 keeps a real flag (`APPS_TAB_ENABLED`) plus capability
self-gating, because it renders remote HTML and is the risk surface ADR 0004
exists for.
