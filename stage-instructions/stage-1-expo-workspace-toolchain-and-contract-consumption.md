# Stage 1: Expo workspace, toolchain, and contract consumption

- **Type:** chore
- **Depends on:** none

## Objectives

A runnable Expo (managed) + TypeScript app skeleton in this repo, consuming the
**released** `agent-app-contract` v1.0.0 as a pinned dependency, with CI green.
This is the foundation every other stage builds on; no product UI yet.

## What to build

- Expo managed-workflow app (TypeScript, `strict: true`), Android-first config
  (`app.json`: package id, scheme). Tab scaffold for the four MVP screens
  (Connections / Chat / Apps / Settings) as empty placeholders — expo-router is
  the default choice unless the builder records a reason otherwise.
- Contract consumption (verified reality — this is how the repo ships):
  `npm i github:seanerama/agent-app-contract#v1.0.0`. Import wire types from
  `agent-app-contract/types` (they are pre-built in the package — do NOT add a
  codegen step; ADR 0001's codegen assumption is amended by the assessment).
  Node >= 22 required by the package — set `.nvmrc` and CI node accordingly.
- A thin typed API-client module (`src/api/`) skeleton: base-URL + bearer-token
  plumbing and the `GET /app/v1/manifest` + `GET /app/v1/health` calls only
  (both **authenticated** — canonical contract authenticates every route,
  including health). Stages 3–5 extend this module.
- Toolchain: lint/format (biome, matching the contract repo's convention),
  jest + testing-library for unit tests, pinned deps, committed lockfile.
- CI (`.github/workflows/ci.yml`): typecheck, lint, unit tests, and an
  integration job that boots the package's **mock agent** (`mock-agent` bin)
  and exercises the API client against it (manifest + health round-trip).

## Interface contracts

- **Exposes:** the app workspace, the typed API-client skeleton, and the CI
  spine that later stages extend.
- **Consumes:** `contracts/app-ingress.md` (mirror of canonical
  `agent-app-contract@v1.0.0`) — types, schemas, mock agent from the package.

## Testing requirements

- Unit: API client attaches bearer token to every request (including health);
  rejects/fails closed on non-2xx.
- Integration (CI): mock agent boots; manifest fetch returns
  `contract: { name: "app-ingress", version: 1 }`; health returns ok.

## Acceptance conditions

- [ ] Clear exit-state: `npx expo start` runs the placeholder app; CI runs
      typecheck + lint + unit + mock-agent integration, all green on a PR
- [ ] Contract dependency pinned at the `v1.0.0` tag; lockfile committed
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO
