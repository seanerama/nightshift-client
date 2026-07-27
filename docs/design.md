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

## Handoff

Next: **`/verity:plan`** decomposes this design into the initial thin backlog —
Stage 0 first (it blocks everything), then feature stages 1–5 above.
