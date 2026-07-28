# Status & Handoff

> Runtime/ops truth (framework-spec §4.6). Generated from `.verity/runtime.json`
> by the Release/Deploy Operator. Secret LOCATIONS only — never values.

**Live version:** 0.1.2
**Deployed at:** (not deployed)
**Rollback from:** (n/a)

## Environments
- **release:** {"tag":"v0.1.2","artifact":"nightshift-client-v0.1.2.apk @ GitHub Release v0.1.2"}
- **device:** {"installed":"pending — v0.1.2 sideload + full smoke (fixes #13 UI, #16 cleartext)"}

## Secret locations (names + on-disk locations only, never values)
- EXPO_TOKEN @ GitHub Actions secrets (seanerama/nightshift-client); Expo account seanmahoneyai; EAS-managed Android keystore on Expo servers (backup: npx eas-cli credentials -p android)

## Coordination notes
- (none)
