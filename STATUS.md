# Status & Handoff

> Runtime/ops truth (framework-spec §4.6). Generated from `.verity/runtime.json`
> by the Release/Deploy Operator. Secret LOCATIONS only — never values.

**Live version:** 0.2.0
**Deployed at:** (not deployed)
**Rollback from:** v0.1.3 APK on its GitHub Release (migration v2 is additive — rollback-safe)

## Environments
- **release:** {"tag":"v0.2.0","artifact":"nightshift-client-v0.2.0.apk @ GitHub Release v0.2.0 — transcript durability (stage 9)"}
- **device:** {"installed":"v0.2.0 — durability smoke PASS: history survives force-kill/restart, offline compose queue drains on reconnect"}

## Secret locations (names + on-disk locations only, never values)
- EXPO_TOKEN @ GitHub Actions secrets (seanerama/nightshift-client); Expo account seanmahoneyai; EAS-managed Android keystore on Expo servers (backup: npx eas-cli credentials -p android)

## Coordination notes
- (none)
