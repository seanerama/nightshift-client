# Status & Handoff

> Runtime/ops truth (framework-spec §4.6). Generated from `.verity/runtime.json`
> by the Release/Deploy Operator. Secret LOCATIONS only — never values.

**Live version:** 0.3.0
**Deployed at:** (not deployed)
**Rollback from:** v0.2.0 APK on its GitHub Release (migration v3 additive — rollback-safe)

## Environments
- **release:** {"tag":"v0.3.0","artifact":"nightshift-client-v0.3.0.apk @ GitHub Release v0.3.0 — multi-agent switcher (stage 10)"}
- **device:** {"installed":"pending — v0.3.0 sideload + two-agent switcher smoke"}

## Secret locations (names + on-disk locations only, never values)
- EXPO_TOKEN @ GitHub Actions secrets (seanerama/nightshift-client); Expo account seanmahoneyai; EAS-managed Android keystore on Expo servers (backup: npx eas-cli credentials -p android)

## Coordination notes
- (none)
