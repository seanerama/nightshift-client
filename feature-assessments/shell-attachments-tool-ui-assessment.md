# Feature assessment — shell polish, attachments, generated tool UI

- **Date:** 2026-07-28
- **Source:** six owner requests (architect pass, ADRs 0008–0010)
- **Verdict:** **ACCEPT, SPLIT into three stages** — 12 (shell polish),
  13 (attachments outbound), 14 (generated tool forms).

## Claim / reality — verified against live source before planning

| # | Claim or assumption | Reality | Verdict |
|---|---|---|---|
| 1 | Tab order is a config tweak | expo-router's `Tabs` **omits `initialRouteName`** from its navigator props (`TabsClient.d.ts`: `Omit<…, "initialRouteName" \| …>`), and a tab layout's initial route comes from its `index` file. The reorder requires a **file rename**, not a prop. | **HARDER THAN ASSUMED** |
| 2 | Reordering tabs is self-contained | `src/components/header-identity.tsx:57` does `router.navigate('/')` for "Manage connections…". After the rename `/` is Chat, so that link **silently lands on the wrong screen**. | **HIDDEN BREAKAGE** |
| 3 | Copy a message is pure UI, no deps | React Native removed `Clipboard` from core. **`expo-clipboard` is absent** from `package.json`. The architect addendum called stage A "no new deps" — wrong. | **CORRECTED** |
| 4 | The theme setting uses "existing app-level persistence" (ADR 0008) | **There is no app-level persistence.** The only stores are the connections SQLite DB (`connections`, `transcript_items`, `stream_cursors`, `compose_queue`; migrations v1–v3) and `expo-secure-store` for tokens. Async-storage is not a dependency. | **FALSE PREMISE — ADR corrected** |
| 5 | Stage A needs no migration | Given (4), the theme preference needs an **additive migration v4** (`app_settings`) on the existing DB, following the append-only runner + guard used for v3. The "additive migration only" acceptance condition is **live**, not N/A. | **SCOPE ADDED** |
| 6 | Dark mode is a toggle | **49 hardcoded colour literals across 7 files**, no theme module, `Settings` is an empty `PlaceholderScreen`. | **TRUE, and wide** |
| 7 | Resources will need theme work | They already have it — the ui-bridge pushes `ui/theme`, so **agent-served resources honour dark mode while the shell does not**. Only the *value* pushed changes (resolved setting, not raw device scheme). No contract change. | **BETTER THAN ASSUMED** |
| 8 | Attachments need contract work | **No.** `POST /app/v1/uploads` (**201**) and `GET /app/v1/files/<id>` are in frozen v1 and served by the mock; `InboundMessage.attachments` is already plumbed through `chat-store`, `inbound`, `drain`, `memory`, `sqlite-chat-store` and **migration v2** — always `[]`, commented "reserved for the attachments stage". | **ALREADY CONTRACT-READY** |
| 9 | `CAPABILITY_FILES` gates the composer | It is defined in `capabilities.ts` and **gates nothing**. `src/api/client.ts` exports `getManifest`, `postMessage`, `getOutbox`, `getHealth` — **no upload function**. | **UNBUILT** |
| 10 | Attachments need two new deps (ADR 0010) | **Three.** `expo-image-picker`, `expo-document-picker`, **and `expo-file-system`** — the last is required for ADR 0010's own offline-copy design and was undercounted. All verified absent. | **CORRECTED** |
| 11 | Tool forms are a re-skin of existing tool access | `listTools` exists in `src/mcp/client.ts` and is **called nowhere**. `tools/list` is dead code; tools reach the app only via resource HTML through the ui-bridge. | **NEW CAPABILITY** |
| 12 | Tool forms need no gating change | The Apps tab self-gates on `mcp-apps-ui` alone. It must widen to `mcp-apps-ui` **OR** `mcp-tools`, so an agent declaring only `mcp-tools` gets an Apps tab **for the first time**. | **USER-VISIBLE CHANGE** |

Items 1, 2, 4 and 10 are the ones that would have produced broken or
under-scoped work. Item 2 is the nastiest — a rename that leaves a navigation
link pointing at the wrong screen with no error anywhere.

## Corrections applied to the architect artifacts

Three statements were wrong and are fixed on this branch rather than inherited:

- **ADR 0008** claimed the setting would use "the existing app-level
  persistence". None exists; it now specifies additive migration v4.
- **ADR 0010** said "two new dependencies"; its own offline-copy design needs a
  third (`expo-file-system`).
- **`docs/design.md`** described stage A as "no contract, no new deps"; it needs
  `expo-clipboard` and a migration.

## Impact and contract safety

**No new contract; no frozen contract threatened.** `app-ingress` v1 and
`ui-bridge` v1 stay byte-unchanged across all three stages, and that is an
explicit acceptance condition on each. Attachments use routes and a field v1
already defines. Tool forms use `tools/list`/`tools/call` under the existing
`mcp-tools` capability. The theme setting changes the *value* computed for
`ui/theme`, not its shape.

Two things the Reviewer should watch:

- **The Apps gate widening (stage 14)** is the highest field-confusion risk in
  this batch — it is called out in that stage's smoke doc for exactly that
  reason.
- **Native tool forms are not an allowlist bypass**, though they resemble one.
  The ui-bridge allowlist constrains untrusted resource HTML; the owner tapping
  a native button is a different principal who already holds the bearer token.
  `deriveAllowlist` behaviour for WebView resources must be unchanged, and is an
  acceptance condition.

## Kill-switch decisions

- **Stage 12: waived** — presentation over existing behaviour, System default
  makes it a no-op until opted into, plus one additive table.
- **Stage 13: required** — net-new feature, new permission surface, new local
  file lifecycle.
- **Stage 14: required**, and it must gate the tools group only, so the existing
  `ui://` resource list keeps working with the flag off.

## Sequencing

12 → 13 → 14, owner-confirmed. Not arbitrary: the technical-guide import case
needs a file input, so 14 genuinely depends on 13; and 13 edits the composer
that 12 restyles, so running them the other way guarantees conflict.

## Also recorded

The v0.4.0 ship pass found `app.json` pins `expo.version: "0.1.0"` with nothing
syncing it from the tag, so every APK self-reports 0.1.0 and the build on a
device cannot be identified from the device. Deferred in stage 12 as its own
chore — it is release tooling, not shell polish.
