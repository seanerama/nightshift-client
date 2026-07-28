# Status & Handoff

> Runtime/ops truth (framework-spec §4.6). Generated from `.verity/runtime.json`
> by the Release/Deploy Operator. Secret LOCATIONS only — never values.

**Live version:** 0.4.0
**Deployed at:** (not deployed)
**Rollback from:** v0.3.0 APK on its GitHub Release (no schema change in v0.4.0 — rollback-safe)

## Environments
- **release:** {"tag":"v0.4.0","artifact":"nightshift-client-v0.4.0.apk @ GitHub Release v0.4.0 (105.6 MB) — live Apps refresh (stage 11)"}
- **device:** {"installed":"v0.3.0 — v0.4.0 is BUILT AND PUBLISHED BUT NOT INSTALLED AND NOT SMOKED. The stage-11 UI smoke (docs/ui-smoke/stage-11-live-apps.md) is outstanding and needs TWO distinct agents; step 10 (agent isolation across a switch) is the one that caught a defect in review."}

## Secret locations (names + on-disk locations only, never values)
- EXPO_TOKEN @ GitHub Actions secrets (seanerama/nightshift-client); Expo account seanmahoneyai; EAS-managed Android keystore on Expo servers (backup: npx eas-cli credentials -p android)

## Coordination notes
- (none)
