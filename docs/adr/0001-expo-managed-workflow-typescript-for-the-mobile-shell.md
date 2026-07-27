# 0001. Expo managed workflow + TypeScript for the mobile shell

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Nightshift Client is a cross-platform mobile app (Android first, iOS later) built
by a solo developer working in WSL2 with no Mac. The dev loop targets a physical
Android device over Wi-Fi; release artifacts must be buildable without local
Android/iOS toolchains. The `stack-and-topology` guide leans toward boring,
well-supported stacks and server-rendered UI before rich clients.

## Decision

Expo (managed workflow) + TypeScript, strict mode. Dev via the Expo dev client on
a physical Android device over Wi-Fi (Win11 mirrored networking + `adb pair`).
Release builds via EAS cloud builds (see ADR 0005). Dependencies pinned and the
lockfile committed from day one.

Key libraries fixed now to avoid churn later: `expo-secure-store` for tokens,
`expo-sqlite` for the local transcript/outbox mirror, FlashList for the
transcript, `react-native-webview` for the sandboxed `ui://` renderer.
TypeScript types for every wire shape are generated from the contract repo's
JSON Schemas in CI, so contract drift is a compile error.

## Alternatives considered

- **Server-rendered web app / PWA** (the guide's default lean). Rejected: the
  product *is* a native shell — SecureStore-held tokens, background-tolerant SSE,
  offline SQLite history, a sandboxed WebView with a mediated bridge, and later
  native capabilities (share sheet, voice, push). A PWA cannot provide the
  WebView-isolation security model in §ADR-0004 at all.
- **Bare React Native (no Expo)**. More control over native modules, but requires
  maintaining Android Studio/Gradle (and eventually Xcode) toolchains locally.
  Nothing in the MVP needs a custom native module; the managed workflow keeps the
  guide's "boring stack" property.
- **Flutter / Kotlin Multiplatform**. Viable, but abandons the TypeScript codegen
  story from the contract repo's JSON Schemas and the team's TS expertise.

The guide's server-rendered lean is honored *architecturally* in a different way:
all product UI beyond the shell is agent-served (`ui://` resources), so the app
ships rarely and iteration happens server-side — the same "fewer ways to ship a
blank page" outcome the guide is after.

## Consequences

- No Mac required at any point until the iOS stage (EAS handles both platforms).
- Managed workflow limits us to Expo-compatible native modules; acceptable for
  MVP, revisit only if a native capability stage demands prebuild.
- Codegen from schemas makes the contract the single source of truth, at the cost
  of a CI codegen step in the app repo.
