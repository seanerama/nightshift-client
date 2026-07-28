# Stage 14: Generated tool forms in the Apps tab from tools/list schemas

- **Type:** feature
- **Depends on:** 11,13

## Objectives

"Default to build on for every tool available" — every tool the agent lists
gets a usable form and a run button, with no agent-side UI authoring.

Governed by [ADR 0009](../docs/adr/0009-client-rendered-tool-forms-generated-from-tools-list-schemas.md).

**Verified:** `listTools` exists in `src/mcp/client.ts` and is **called
nowhere**. `tools/list` is dead code today — tools reach the app only when
resource HTML calls one through the ui-bridge, so an agent declaring
`mcp-tools` with no `ui://` resource is currently inert in this app.

## What to build

1. **Wire `tools/list`** for the first time, through stage 11's existing
   `refreshResources()` path so tools refresh on the same triggers (gesture,
   focus, poll) and inherit its debounce, reconciliation and
   keep-last-known-list-on-failure behaviour. Do **not** add a second refresh
   mechanism.
2. **Schema → form renderer.** Supported subset: `string` (single- and
   multi-line), `number`/`integer`, `boolean`, `enum`, and arrays of those,
   honouring `required`, `default`, `description`, and simple `min`/`max`.
   Anything outside it — nested objects, `oneOf`, `$ref` — degrades to a **raw
   JSON argument editor**, validated as JSON before sending. **Degrade, never
   hide:** a tool the renderer cannot pretty-print must still be callable.
3. **Published resources win.** Suppress the generated form for any tool already
   named in a listed resource's `_meta["ui/tools"]`, so hand-authored agent UI
   *upgrades* the generic form instead of duplicating it. This gives
   `_meta["ui/tools"]` a **second consumer** alongside allowlist derivation —
   read-only, and a resource declaring nothing suppresses nothing.
4. **Confirm sheet on every call**, naming the tool and showing the exact
   arguments to be sent. app-ingress v1 carries no destructive flag and
   inferring one from tool names is guessing; uniform confirmation is the rule.
5. **Show results.** Render via the existing `toolResultText` extractor (the
   same one the fallback card uses); surface `isError` and JSON-RPC errors
   verbatim. A tool with no textual content still reports that it completed.
6. **File-typed inputs reuse stage 13's upload routine** — this is what makes
   the owner's technical-guide import case work: pick a file → upload → pass the
   resulting id as the argument.
7. **Widen the Apps gate.** The tab self-gates on `mcp-apps-ui` today; it must
   show for `mcp-apps-ui` **OR** `mcp-tools`, with each group gating on its own
   capability. **An agent declaring only `mcp-tools` gets an Apps tab for the
   first time** — user-visible, and the kind of change that reads as a bug in
   the field. Call it out in the smoke doc.

## Interface contracts

- **Exposes:** the schema→form renderer and the tool-invocation surface.
- **Consumes:** frozen `contracts/app-ingress.md` — `POST /app/v1/mcp`
  `tools/list` + `tools/call` under the existing `mcp-tools` capability, all
  pre-existing and **byte-unchanged**. Stage 11's refresh engine and
  `ResourceListState`; stage 13's upload routine.
  **`contracts/ui-bridge.md` is untouched, and this is NOT a bypass of its
  allowlist** — the allowlist constrains untrusted resource HTML in a WebView; a
  native form is the owner acting directly, a different security principal who
  already holds the bearer token. Resource HTML stays confined to its declared
  `ui/tools`. **No new contract.**

## Testing requirements

- **Unit (node):** renderer field-mapping for every supported type, `required`,
  `default`, `min`/`max`; unsupported schema → raw-JSON fallback (and invalid
  JSON is rejected before any call); suppression — a tool named in a listed
  resource's `_meta["ui/tools"]` produces no form, a resource declaring nothing
  suppresses nothing; argument assembly matches the schema; gate logic for
  `mcp-apps-ui` only / `mcp-tools` only / both / neither.
- **Unit (tsx):** the run button does **not** call the tool until the confirm
  sheet is accepted, and the sheet shows the exact arguments; cancel sends
  nothing; results and errors render.
- **Integration (mock agent):** `tools/list` against the real mock → forms
  generated; a real `tools/call` round-trip executes and returns its true
  result; an agent started with **only** `mcp-tools` (no `mcp-apps-ui`) shows
  the Apps tab with tools and no resources — and, per contract, `resources/*`
  must not be called against it.
- **UI-smoke** (`docs/ui-smoke/stage-14-tools.md`): connect → Apps shows a Tools
  group → open a tool with inputs → fill → run → **confirm sheet shows the exact
  arguments** → accept → real result; cancel sends nothing; a tool covered by a
  published resource shows the resource and **no** duplicate form; **an agent
  declaring only `mcp-tools` now shows an Apps tab** (state this explicitly, it
  is the change most likely to be mistaken for a bug); a tool with an exotic
  schema shows the JSON editor and still runs.

## Acceptance conditions

- [ ] Kill-switch flag — **REQUIRED** (net-new surface that can invoke **any**
      listed tool, including destructive ones). Default OFF; dark-launch
      following the `APPS_TAB_ENABLED` pattern. It must gate the tools group
      only — the existing `ui://` resource list keeps working with it off.
- [ ] UI-smoke asset authored, **explicitly covering the widened Apps gate**
- [ ] Additive migration only — **N/A, no schema change**
- [ ] No tool call reaches the agent without confirmation
- [ ] Unsupported schemas degrade to the JSON editor; no tool is silently hidden
- [ ] `contracts/app-ingress.md` and `contracts/ui-bridge.md` byte-unchanged;
      `deriveAllowlist` behaviour for WebView resources unchanged
- [ ] Existing suite stays green; CI all-green

## Pipeline test: NO

## Deferred (recorded)

- **MCP tool `annotations`** (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`) to tune the confirm sheet — lighter for read-only tools,
  harder for destructive ones. Rides inside the standard MCP payload, so it is
  additive with no contract change. Until an agent supplies them,
  confirm-everything stands.
- An optional per-connection **hide** list in Settings, if a noisy agent ever
  warrants it. Deliberately not the default — that would defeat "build on for
  every tool available".
- Persisting last-used arguments per tool.
