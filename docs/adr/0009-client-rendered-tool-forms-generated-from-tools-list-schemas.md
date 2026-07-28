# 0009. Client-rendered tool forms generated from tools/list schemas

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

The owner asked that the Apps tab "default to build on for every tool
available" — a tool like nightshift's technical-guide should surface as an
import form plus a start button, without anyone hand-authoring a `ui://`
resource for it.

**Verified state.** `listTools` exists in `src/mcp/client.ts` and is **called
nowhere**. `tools/list` is entirely unused today: tools reach the app only when
resource HTML calls one through the ui-bridge. An agent that declares
`mcp-tools` but publishes no `ui://` resource is, from the app's side,
completely inert.

This request sits in real tension with **ADR 0002** — a thin native shell over
*agent-served* UI, an app that ships rarely. Generating forms in the client
means the client renders UI the client authored, which is the thing ADR 0002
set out to avoid.

The tension resolves once you separate the *renderer* from the *content*. What
ships in the app is one generic schema renderer. What decides the screens is
`tools/list` at runtime: the tool names, their `inputSchema`, their
descriptions. An agent that adds a tool gets a new form in the app **with no
app release** — which is ADR 0002's actual goal. This inverts ADR 0002's
mechanism (agent-authored HTML) while serving its intent, so it is an extension
of that decision rather than a reversal of it.

## Decision

**Generate a form for every tool the agent lists, merged into the Apps tab.**

- **One surface.** The Apps tab answers "what can this agent do for me": agent-
  published `ui://` resources in one group, generated tool forms in another. No
  fifth tab.
- **Published resources win.** A generated form is **hidden** for any tool
  already named in a listed resource's `_meta["ui/tools"]`. So when an agent
  later publishes hand-authored UI for a job, the polished screen replaces the
  generic form automatically — agent-side generative UI *upgrades* the tab
  instead of duplicating it. This reuses the metadata key the allowlist already
  reads; **no new `_meta` key, no contract change**.
- **Confirm on every call.** The run button opens a confirm sheet naming the
  tool and showing the exact arguments to be sent. Uniform, no guessing.
  app-ingress v1 carries no destructive flag, and inferring one from tool names
  (`session_rotate`? `cleanup_cache`?) is a coin flip where guessing wrong is
  the expensive direction.
- **Supported schema subset, with an honest fallback.** v1 renders `string`
  (single- and multi-line), `number`/`integer`, `boolean`, `enum`, and arrays of
  those, honoring `required`, `default`, `description`, and simple `min`/`max`.
  Anything outside that subset — nested objects, `oneOf`, `$ref` — degrades to a
  **raw JSON argument editor** for that tool, validated as JSON before sending.
  Degrade, never hide: a tool the renderer cannot pretty-print is still callable.
- **Results are shown, not swallowed.** A call renders its result through the
  same plain-text extraction the fallback card uses (`toolResultText`), so every
  tool has a readable outcome and errors surface verbatim.

## Alternatives considered

The **contracts-first guide** matters here only in the negative: this must not
require a contract change, and it does not — `tools/list` and `tools/call` are
app-ingress v1, gated by the existing `mcp-tools` capability.

- **A separate "Tools" tab.** A clean conceptual split — Apps is what the agent
  designed, Tools is everything it can do. Rejected: a fifth tab in a bar the
  owner just asked to reorder, and the two surfaces read as redundant the moment
  an agent publishes a resource that wraps a tool. The precedence rule above
  gives the same clarity inside one tab.
- **Tool invocation from the Chat composer.** Most discoverable and the best fit
  for conversational tools. Rejected for v1: it buries multi-field forms in a
  transcript and makes results transient, when the owner asked for a place to
  *return to* and start a process.
- **Per-connection opt-in in Settings.** Safest — nothing appears until enabled.
  Rejected as the default because it defeats the actual request ("default to
  build on for every tool available"); every new agent tool would need a manual
  step. Worth revisiting as an optional *hide* list if a noisy agent ever
  warrants it.
- **Heuristic destructive detection** from tool names, with a manual override.
  Fewer taps on read-only tools. Rejected as guessing, per the confirm rule
  above.

## Consequences

- **The Apps tab's gate widens.** It currently self-gates on `mcp-apps-ui`
  alone. With generated forms it must show for `mcp-apps-ui` **OR** `mcp-tools`,
  and each group within it gates on its own capability. An agent declaring only
  `mcp-tools` gets an Apps tab for the first time. This is a deliberate,
  user-visible gating change and must be called out in the stage spec and the
  smoke doc — it is exactly the kind of change that reads as a bug in the field.
- **The ui-bridge allowlist is untouched, and this is not a bypass of it.**
  Worth stating plainly because it looks like one. The allowlist exists to
  constrain **untrusted resource HTML** running in a WebView — a different
  security principal from the owner tapping a native button. The owner already
  holds the bearer token and can call any tool with `curl`; a native form grants
  no authority they did not already have. `contracts/ui-bridge.md` v1 stays
  byte-unchanged, and resource HTML remains confined to its declared
  `ui/tools`.
- `_meta["ui/tools"]` acquires a **second consumer** (form suppression, on top
  of allowlist derivation). Both are read-only interpretations of the same
  declared list, and a resource that declares nothing suppresses nothing —
  the safe direction.
- **Future refinement, additive and free:** MCP tool descriptors may carry
  `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`). The
  client's `McpToolDescriptor` does not read them today. When an agent supplies
  them they can tune the confirm sheet — lighter for read-only tools, harder for
  destructive ones — with no contract change, since they ride inside the
  standard MCP payload. Until then, confirm-everything stands.
- The generic renderer is a genuinely new surface to maintain, and JSON Schema
  is open-ended. The documented subset plus the raw-JSON fallback is what keeps
  it bounded; resist growing the subset without a reason from a real agent.
- The technical-guide example needs a **file input**, so the useful version of
  this depends on attachments (ADR 0010) landing first.
