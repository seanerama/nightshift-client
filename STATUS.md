# Nightshift Client — Status & Handoff

> Runtime/ops truth (framework-spec §4.6). Owned by the **Release/Deploy Operator**,
> updated on every deploy. Records secret **locations** only — never values.

**As of:** not yet deployed

## TL;DR

Scaffolded by Verity. Nothing deployed yet.

## Live deployment

- (none)

## Releases

> Convention (Ship operator maintains this section): release = tag `vX.Y.Z` →
> Actions → APK on the GitHub Release page → sideload.

- **Current released tag:** none yet
- **Installed on device:** none yet
- Pipeline: `.github/workflows/release.yml` (ADR 0005); operator steps in
  `docs/release-runbook.md`. One-time setup (EAS project link + `EXPO_TOKEN`
  secret) not yet done.

## Images

- prefix: `ghcr.io/seanerama/nightshift-client`
- (no releases yet)

## Secrets

- `EXPO_TOKEN` — GitHub Actions secret on `seanerama/nightshift-client`
  (NOT yet created; operator setup in `docs/release-runbook.md`). Location
  only — never values.
- otherwise (none configured) — when set, list NAMES + LOCATIONS only, never values.

## Coordination notes

- (none)
