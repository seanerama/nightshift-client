# Stage 8: Fix cleartext for real: expo-build-properties, manifest-verified

- **Type:** bug
- **Depends on:** none

## Objectives

Actually fix reopened issue #16. Stage 7's fix set
`expo.android.usesCleartextTraffic` — which is NOT a recognized Expo SDK 57
config field. Prebuild ignored it silently; manifest inspection of the shipped
v0.1.2 APK proved no cleartext attribute was emitted, and the device smoke
failed identically to v0.1.1. Root process failure: the fix was asserted at
the app.json level but never verified at the artifact level.

## What to build

- `expo-build-properties` (exact-pinned) configured in app.json plugins:
  `{ "android": { "usesCleartextTraffic": true } }` — the documented managed-
  workflow mechanism. Remove the inert `expo.android.usesCleartextTraffic` key.
- `scripts/check-release-config.mjs`: assertion rewritten to require the
  plugin entry (and to document the stage-7 lesson in place).
- **Artifact-level verification (the step stage 7 skipped):**
  `npx expo prebuild --platform android --no-install` locally and grep the
  generated `android/app/src/main/AndroidManifest.xml` for
  `android:usesCleartextTraffic="true"`; clean up the android/ dir after.
  Record the grep output in the PR.

## Interface contracts

- Nothing new; contracts untouched; config-only.

## Testing requirements

- check-release-config fails on the pre-fix tree (it did — the old assertion
  tripped the moment the inert field was removed) and passes after.
- Prebuild manifest grep evidence in the PR (fails-before is established by
  the v0.1.2 APK inspection recorded in issue #16).
- Device verification (operator): v0.1.3 add-connection over http succeeds.

## Acceptance conditions

- [ ] Reproduction + artifact-level evidence captured (v0.1.2 APK manifest
      inspection in #16); regression assertion targets the working mechanism
- [ ] Generated-manifest grep proof recorded in the PR
- [ ] Existing suite stays green; CI all-green

## Process note

Inline-executed (config-class, operator blocked). Lesson recorded for the
backlog: release verification for config-plugin changes must include an
artifact-level check, not just app.json assertions; and the app surfaces no
installed-version indicator (candidate chore for /verity:plan).

## Pipeline test: NO
