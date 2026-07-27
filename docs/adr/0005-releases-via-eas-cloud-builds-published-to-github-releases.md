# 0005. Releases via EAS cloud builds published to GitHub Releases

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

A mobile app has no "deploy to a server" step; the deploy surface is producing
an installable, versioned artifact and getting it onto the owner's device. None
of the four configured deployment methods in the global catalog (Cloudflare
Pages, NSAF dev server, Coolify, EC2) fit an APK. Development happens in WSL2
with no Mac and no local Android SDK requirement; distribution is
single-user/sideload for the MVP (no Play Store).

## Decision

- **Build:** EAS cloud builds (Expo Application Services), `production` profile
  producing an APK (not AAB — sideload target, no Play Store). Triggered from
  GitHub Actions on release tags via `eas build --non-interactive`.
- **Distribute:** the release APK is attached to a **GitHub Release** on this
  repo. Install = download the APK on the phone from the release page.
  Versioning follows the repo's release tags; `STATUS.md` records the currently
  installed version (the "deployed" state for this app).
- **Credentials:** `EXPO_TOKEN` lives in GitHub Actions secrets; the Android
  keystore is EAS-managed (backed up via `eas credentials`). Locations are
  documented in `.verity/deploy-access.md`; no secrets in git.
- Recorded in the global deployment catalog as method `eas-github-releases`.

## Alternatives considered

- **EAS internal distribution links.** Slightly less setup, but artifacts live
  on Expo's servers behind expiring links instead of a durable, versioned trail
  in the repo's releases. Chosen against by the owner.
- **Local Gradle builds (`expo prebuild`).** No EAS dependency or build-queue
  limits, but we would own the Android SDK + keystore toolchain in WSL2/CI, and
  it deviates from the managed-workflow decision in ADR 0001.
- **Play Store internal track.** Real distribution infrastructure, but requires
  a developer account and review latency for a single-user MVP; deferred until
  there is a second user.

## Consequences

- Release cadence is bounded by EAS build-queue times (fine for an app that
  ships rarely by design — ADR 0002).
- iOS later is the same pipeline plus TestFlight; do not buy the Apple
  developer account before that stage.
- The walking skeleton's "deploys" criterion = a tagged build lands on the
  GitHub Release page and installs on the physical device.
