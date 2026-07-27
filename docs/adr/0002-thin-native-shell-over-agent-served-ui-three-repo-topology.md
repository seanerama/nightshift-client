# 0002. Thin native shell over agent-served UI, three-repo topology

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

The app is the generic mobile front door for agents built on the
nightshift-assistant architecture, replacing the Webex transport. Two topology
questions: (1) where does product UI live — in the app or on the agent; (2) how
many repos. The `stack-and-topology` guide leans modular-monolith / fewest
moving parts, and warns each extra repo/service multiplies CI and deploy surface.

## Decision

**Thin shell:** the native app owns only agent connections (URL + token), the
chat transcript, attachments, the sandboxed WebView renderer for MCP Apps
`ui://` resources, and settings. Agents own every dashboard, form, and custom
view as server-delivered UI resources. The app is agent-agnostic by
construction: it speaks exactly one contract (`app-ingress` v1) and holds N
connections; any conforming agent is a first-class citizen.

**Three repos:**

| Repo | Contents | Owns |
|---|---|---|
| `agent-app-contract` | `app-ingress.md` v1, JSON Schemas, example payloads, conformance harness, mock agent | the seam |
| `nightshift-client` (this repo) | Expo app | the shell |
| `nightshift-assistant` (+ future agents) | `src/transport/app/` behind `APP_TRANSPORT_ENABLED` | the brains |

The contract repo is neutral ground — neither the app nor any single agent owns
it. Agent CI runs the conformance harness against itself; app CI runs against a
mock agent generated from the same schemas. A new agent is "supported" when the
harness passes, with zero app changes. This repo vendors a read-only mirror of
the frozen contract under `contracts/` (pinned to a contract-repo commit) so
Verity's reviewer can gate PRs against it locally.

## Alternatives considered

- **Contract lives in this repo, extract later** — the guide-leaning option
  (fewer repos, Verity-native `contracts/` as canonical). Rejected by the owner:
  the conformance harness must be consumed symmetrically by agent CI and app CI
  from day one, and neutrality is the mechanism that keeps the app
  agent-agnostic rather than nightshift-assistant-shaped.
- **Contract lives in the agent repo.** Worst of both: the app would depend on
  one agent's repo, undermining the multi-agent goal.
- **Rich native app** (dashboards implemented natively). Rejected: every agent
  UI change would require an app release; the entire point is that the app
  ships rarely while agents iterate freely.

## Consequences

- A third repo to scaffold in Stage 0, with its own (small) CI.
- Contract changes have a two-step flow: change in `agent-app-contract`, bump
  the pin here. That friction is intentional — it is the additive-only gate.
- The app's feature ceiling is set by the contract + bridge surface; new native
  capabilities require contract additions, not ad-hoc coupling.
