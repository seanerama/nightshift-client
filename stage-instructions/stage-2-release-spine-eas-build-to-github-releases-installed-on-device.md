# Stage 2: Release spine: EAS build to GitHub Releases, installed on device

- **Type:** chore
- **Depends on:** 1

## Objectives

Prove the deploy path before feature work (walking-skeleton principle): a
release tag produces an installable APK on the repo's GitHub Releases page,
and that APK installs and launches on the physical Android device. Kills the
"features done before the pipeline ever ran" failure at the root. ADR 0005.

## What to build

- EAS project link (`eas init`) + `eas.json`: `production` profile building an
  **APK** (sideload target — not AAB), EAS-managed Android keystore.
- Release workflow (`.github/workflows/release.yml`): on `v*` tag →
  `eas build --platform android --profile production --non-interactive --wait`
  → download artifact → attach APK to the GitHub Release for the tag
  (`GITHUB_TOKEN`, `contents: write`).
- `EXPO_TOKEN` documented as a required Actions secret (location recorded in
  `.verity/deploy-access.md`; the operator creates it — never committed).
- `STATUS.md` gains the release/installed-version convention the Operator
  (`/verity:ship`) maintains from here on.

## Interface contracts

- **Exposes:** the release pipeline every later stage ships through.
- **Consumes:** Stage 1's workspace. Deployment method `eas-github-releases`
  in the operator's global catalog; access via `.verity/deploy-access.md`.

## Testing requirements

- Workflow-level: a `v0.1.0` tag run completes end-to-end and the Release page
  holds the APK (this IS the test; record the run URL in the PR).
- Device smoke (operator step, documented in the PR): download APK on the
  phone → install → app launches to the placeholder tabs.

## Acceptance conditions

- [ ] Clear exit-state: tagged build lands on GitHub Releases and installs +
      launches on the physical device; `STATUS.md` records it
- [ ] No secrets in the repo; `EXPO_TOKEN` only in Actions secrets
- [ ] Existing suite stays green; CI all-green

## Pipeline test: YES — this stage is the pipeline
