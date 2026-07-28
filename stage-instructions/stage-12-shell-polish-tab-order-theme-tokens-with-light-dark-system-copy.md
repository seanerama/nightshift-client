# Stage 12: Shell polish: tab order, theme tokens with Light/Dark/System, copy message

- **Type:** feature
- **Depends on:** 4,11

## Objectives

Three owner requests that share one surface — the app's own chrome. Grouped
because the theme sweep touches every screen and would collide with anything
else editing styles.

Governed by [ADR 0008](../docs/adr/0008-theme-tokens-with-an-explicit-light-dark-system-setting.md).

## What to build

### 1. Tab order — Chat first, Connections third

Target order: **Chat, Apps, Connections, Settings**, with Chat as the screen
that opens on launch.

**This cannot be done with a prop.** Verified: expo-router's `Tabs` **omits**
`initialRouteName` from its navigator props
(`node_modules/expo-router/build/layouts/TabsClient.d.ts` — `Omit<…,
"initialRouteName" | …>`), and expo-router takes a tab layout's initial route
from its `index` file. So:

- `src/app/chat.tsx` → `src/app/index.tsx` (Chat becomes `/`)
- current `src/app/index.tsx` (Connections) → `src/app/connections.tsx`
- `<Tabs.Screen>` declaration order sets the bar order: index (Chat), apps,
  connections, settings.
- **`src/components/header-identity.tsx:57` does `router.navigate('/')` for
  "Manage connections…"** — that link currently lands on Connections and would
  silently land on Chat after the rename. It must become `/connections`.
  `app.json` sets `experiments.typedRoutes: true`, so `tsc` will catch a missed
  route string; do not rely on that alone — check the switcher by hand.
- Keep `headerTitle: () => <HeaderIdentity … />` on Chat and Apps, and the
  stage-5 `href: APPS_TAB_ENABLED ? '/apps' : null` kill-switch, unchanged.

### 2. Theme tokens + Light/Dark/System setting

- **Token module** exporting semantic tokens (surface, surface-raised, border,
  text, text-muted, accent, danger, warn) for light and dark, consumed via a
  hook. Move **all 49 hardcoded colour literals** — `chat.tsx` 15,
  `connection-form.tsx` 10, `apps.tsx` 9, `index.tsx` 6, `quick-switcher.tsx` 5,
  `resource-view.tsx` 2, `fallback-card.tsx` 2 — onto tokens. After this stage a
  raw `#rrggbb` anywhere in `src/` is a defect.
- **Settings becomes a real screen** (it is an empty `PlaceholderScreen` today)
  with a Light / Dark / System control. **System is the default**, so anyone who
  never opens Settings sees exactly today's behaviour.
- **Persistence — read this before choosing an approach.** There is **no
  app-level persistence in this repo**: the only stores are the connections
  SQLite DB (tables `connections`, `transcript_items`, `stream_cursors`,
  `compose_queue`; migrations v1–v3) and `expo-secure-store` for tokens.
  Async-storage is **not** a dependency. Use an **additive migration v4**
  adding an `app_settings` key/value table to the existing DB, following the
  established append-only runner and extending its additive-regex guard — the
  same shape stage 10 used for v3. Do **not** add a storage dependency, and do
  **not** put a non-secret in the secure store.
- **The resolved scheme drives `ui/theme`.** `resource-view.tsx` currently
  pushes the raw `useColorScheme()` value to resource HTML. It must push the
  *resolved app theme*, so choosing Dark in Settings also darkens agent-served
  resources. No contract change — `ui/theme` already carries `scheme`; only the
  computed value changes.

### 3. Copy a chat message

Long-press a transcript message → copy its text. **Needs `expo-clipboard`**
(verified absent from `package.json`; React Native removed `Clipboard` from
core, so this is not dependency-free as the design addendum first implied).
Give brief confirmation feedback. Applies to both `UserItem` and `AgentItem`.

## Interface contracts

- **Exposes:** the theme token module + hook that every future screen consumes;
  an `app_settings` store for the next app-level (non-connection) preference.
- **Consumes:** frozen `contracts/app-ingress.md` (**untouched**) and
  `contracts/ui-bridge.md` (**untouched** — `ui/theme` shape is unchanged, only
  the value computed for `scheme`). Stage 4's transcript items; stage 11's Apps
  screen (restyled, behaviour unchanged). **No new contract.**

## Testing requirements

- **Unit (node):** token resolution for light/dark; the three-way setting
  reducer including System→device-scheme resolution; migration v4 (applies over
  v3, idempotent, additive-guard extended, v1–v3 untouched); the value pushed to
  `ui/theme` follows the *setting*, not the device, when they disagree.
- **Unit (tsx):** Settings renders the control and persists a change; long-press
  on a transcript row invokes the clipboard with the message's exact text.
- **Route check:** a test or typecheck-backed assertion that the "Manage
  connections…" action targets `/connections`, not `/`.
- **UI-smoke** (`docs/ui-smoke/stage-12-shell.md`): launch → **Chat is the tab
  that opens**; bar order is Chat, Apps, Connections, Settings; set Dark →
  every screen including Apps, the quick switcher, the connection form and the
  fallback card is dark, with **no white flashes**; **open a `ui://` resource
  with the app set to Dark while the device is Light** — the resource must be
  dark (this is the case that proves the resolved value reaches the bridge);
  set System and confirm it follows the device; long-press a message → copy →
  paste elsewhere; quick switcher → "Manage connections…" lands on Connections.

## Acceptance conditions

- [ ] Kill-switch flag — **WAIVED by planner, recorded:** pure presentation over
      existing behaviour plus one additive settings table; System default makes
      the theme change a no-op until the owner opts in; rollback is the previous
      APK. Any scope growth beyond this spec voids the waiver.
- [ ] UI-smoke asset authored, including the app-Dark/device-Light resource case
- [ ] **Additive migration only** — v4 appends; v1–v3 untouched; guard extended
- [ ] No raw colour literal left anywhere in `src/`
- [ ] `contracts/app-ingress.md` and `contracts/ui-bridge.md` byte-unchanged
- [ ] "Manage connections…" still lands on Connections after the rename
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO

## Deferred (recorded)

- Deriving `expo.version` from the release tag. Found during the v0.4.0 ship
  pass: `app.json` pins `expo.version: "0.1.0"` and nothing in `release.yml` or
  `check-release-config.mjs` syncs it, so every APK self-reports 0.1.0 and the
  build on the device cannot be identified from the device. Its own chore stage.
- Per-connection theme, and theming the tab bar/status bar beyond defaults.
