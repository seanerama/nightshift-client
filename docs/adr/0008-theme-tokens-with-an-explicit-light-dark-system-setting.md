# 0008. Theme tokens with an explicit Light/Dark/System setting

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

The owner asked for "a dark mode in settings". Two things make this more than a
toggle:

**Verified state.** There is no theme module. Colour is **49 hardcoded literals
across 7 files** (`chat.tsx` 15, `connection-form.tsx` 10, `apps.tsx` 9,
`index.tsx` 6, `quick-switcher.tsx` 5, `resource-view.tsx` 2,
`fallback-card.tsx` 2), all light-mode values. `useColorScheme` is called in
exactly one place — `resource-view.tsx` — and not to style the shell.

Which produces a real inversion today: `app.json` sets
`userInterfaceStyle: "automatic"`, and the ui-bridge pushes `ui/theme` with the
device scheme to every resource. **Agent-served resources already honour dark
mode; the native shell wrapping them does not.** A dark dashboard currently
renders inside a white app.

`Settings` is an empty `PlaceholderScreen`, so the settings surface itself is
also net-new.

## Decision

- **A token layer first.** One module exporting semantic tokens (surface,
  surface-raised, border, text, text-muted, accent, danger, warn) resolved for
  light and dark, consumed through a hook. Every one of the 49 literals moves to
  a token. Colour stops being spelled inline anywhere in `src/`.
- **Three-way setting, persisted:** System (default) / Light / Dark, applied
  instantly without a restart. **There is no app-level persistence in this repo
  to store it in** — the only stores are the connections SQLite DB and
  `expo-secure-store` for tokens, and async-storage is not a dependency. So this
  adds an **additive migration v4** creating an `app_settings` key/value table on
  the existing DB, using the established append-only runner and its additive
  guard (the shape stage 10 used for v3). No storage dependency is added, and a
  non-secret does not go in the secure store.
  "System" keeps today's `useColorScheme` behaviour, so the default is a no-op
  for anyone who does not open Settings.
- **The setting drives `ui/theme` too.** The scheme pushed to resource HTML is
  the *resolved* app theme, not the raw device scheme, so choosing Dark in
  Settings darkens agent-served resources as well. This needs **no contract
  change** — `ui/theme` already carries `scheme`; only the value we compute
  changes.
- **Settings becomes a real screen** with the theme control as its first
  content, replacing the placeholder.

## Alternatives considered

- **Follow the system scheme only, no setting.** Cheapest — style with
  `useColorScheme` and ship. Rejected: the owner explicitly asked for the
  control, and an app that is dark only when the whole phone is dark is not what
  "a dark mode in settings" means.
- **Ship the setting now, restyle screens incrementally.** Tempting, but a
  half-tokenised app in dark mode looks broken in exactly the places nobody
  revisited, and "which screens are done?" becomes tribal knowledge. The token
  sweep is the work; doing it once is cheaper than auditing it twice.
- **Adopt a UI kit** (Tamagui, RN Paper, NativeWind) for theming. Real theming
  infrastructure for free. Rejected as disproportionate: a 7-file app buying a
  styling dependency, its build integration, and its idioms to solve a problem a
  token module solves in one file — and it would contradict ADR 0001's thin
  managed-workflow posture.
- **Leave `ui/theme` on the raw device scheme.** Fewer moving parts. Rejected:
  the owner picking Dark and watching a resource stay light is the same bug this
  ADR exists to fix, one layer down.

## Consequences

- The token sweep touches all 7 styled files at once. It is mechanical and
  behaviour-preserving in light mode, which makes it reviewable, but it is a
  wide diff and should not be bundled with behavioural change in the same stage.
- Every future screen must take colour from tokens. Worth a lint rule or a
  review checklist item: a raw `#rrggbb` in `src/` is a defect after this lands.
- Dark mode becomes part of the UI-smoke surface — screens must be checked in
  both schemes, and the resource-theme path checked with the app override set
  against the device scheme (the case that proves the resolved value, not the
  device value, reaches the bridge).
- Persisting a preference is the first genuinely app-level (not per-connection)
  setting. It establishes where such settings live, which the next one inherits.
