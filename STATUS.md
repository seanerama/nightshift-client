# Status & Handoff

> Runtime/ops truth (framework-spec §4.6). Generated from `.verity/runtime.json`
> by the Release/Deploy Operator. Secret LOCATIONS only — never values.

**Live version:** 0.1.3
**Deployed at:** (not deployed)
**Rollback from:** v0.1.2 APK on its GitHub Release (config-only delta)

## Environments
- **release:** {"tag":"v0.1.3","artifact":"nightshift-client-v0.1.3.apk @ GitHub Release v0.1.3 — manifest-verified cleartext fix"}
- **device:** {"installed":"v0.1.3 — smoke PASS: connections (green dot), chat round-trip over SSE; Apps render check pending"}

## Secret locations (names + on-disk locations only, never values)
- EXPO_TOKEN @ GitHub Actions secrets (seanerama/nightshift-client); Expo account seanmahoneyai; EAS-managed Android keystore on Expo servers (backup: npx eas-cli credentials -p android)

## Coordination notes
- (none)
