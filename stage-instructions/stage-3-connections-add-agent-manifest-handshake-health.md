# Stage 3: Connections: add agent, manifest handshake, health

- **Type:** feature
- **Depends on:** 1

## Objectives

The multi-agent front door: add a connection (URL + token), handshake via the
manifest, show health. After this stage the app can hold N connections and
switch the active one — everything later (chat, apps) hangs off the active
connection.

## What to build

- **Connections screen:** list (agent name from manifest, health dot), add/edit
  form (URL + token), delete, switch-active.
- **Storage:** tokens in `expo-secure-store` ONLY (never in sqlite/AsyncStorage
  or logs). Connection metadata (id, URL, manifest snapshot, active flag) in an
  `expo-sqlite` store — additive migrations only from day one.
- **Handshake:** on add/edit, `GET /app/v1/manifest` (authenticated); persist
  the capability list; reject non-`app-ingress`/non-v1 manifests with a clear
  error. Capability gating starts here: downstream tabs render only what the
  active agent's capabilities allow (no `mcp-apps-ui` → no Apps tab), honoring
  optional `ui.home` if present.
- **Health:** foreground-only poll of `GET /app/v1/health` (authenticated —
  canonical contract has no anonymous route) driving the health dot.

## Interface contracts

- **Exposes:** `connections` store + `activeConnection` (URL, token accessor,
  capabilities) consumed by stages 4 and 5.
- **Consumes:** `contracts/app-ingress.md` — manifest, health, auth, error
  shape. Mock agent for dev/CI.

## Testing requirements

- Unit: manifest validation (accept v1, reject wrong contract/version),
  capability gating logic, secure-store token round-trip (mocked).
- Integration (CI): against the mock agent — add connection → manifest
  persisted → health dot logic sees ok; bad token → fails closed with the
  contract error shape.
- UI-smoke asset (for the Operator, post-release): documented script — launch
  app → add mock/live agent URL + token → agent name appears with green dot →
  kill agent → dot degrades.

## Acceptance conditions

- [ ] Kill-switch / dark-launch flag (default OFF) for this net-new feature —
      N/A accepted by planner: pre-first-release shell surface with zero
      installed users; there is no live cohort to protect. First release ships
      after this stage lands. (Record any deviation in the PR.)
- [ ] UI-smoke "observably-works" check authored for the Connections surface
- [ ] Additive migration only (no destructive schema change)
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO
