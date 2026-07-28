/**
 * Open-resource semantics for the Apps tab (stage 11, **ADR 0007**).
 *
 * THE INVARIANT: a change to the resource list must never reload, remount, or
 * tear down a currently rendered resource.
 *
 * Why this needs its own module rather than a `list.find(…)` at the call site —
 * the concrete hazard, verified in stage-5 code:
 *
 *   ResourceView memoizes its bridge session on `[resource, connection,
 *   onClose]` and disposes the previous one. `listResources` builds FRESH
 *   descriptor objects on every fetch, so deriving the open resource from the
 *   live list gives it a new identity on every refresh — disposing the bridge
 *   session of a running resource and killing in-flight `tools/call`s.
 *
 * So the open resource is an OWNED SNAPSHOT, captured at open time and never
 * re-derived. It is intentionally allowed to diverge from the list: that
 * divergence is the feature, not a bug to be tidied away. A future reader who
 * "fixes" this back into a lookup silently restores the teardown above.
 *
 * A consequence worth stating because it is security-relevant: the running
 * resource keeps the allowlist derived from the snapshot it was opened with,
 * so a refresh can neither widen nor narrow a live resource's tool access
 * mid-flight (contracts/ui-bridge.md §Consumes). Freshly opened resources read
 * `_meta["ui/tools"]` from the refreshed list as usual.
 */

import type { McpResourceDescriptor } from '@/mcp/client';

/** Is this uri still offered by the agent? */
export const isStillListed = (resources: readonly McpResourceDescriptor[], uri: string): boolean =>
  resources.some((entry) => entry.uri === uri);

/**
 * The non-blocking notice shown when the user closes a resource that vanished
 * from the list while it was open (ADR 0007). Null when it is still listed —
 * the overwhelmingly common case, and no notice is the correct silence.
 *
 * Never a modal, never a FallbackCard, never an auto-close: the resource kept
 * running the whole time, so this is information, not an error.
 */
export const noticeForClosedResource = (
  closed: McpResourceDescriptor,
  resources: readonly McpResourceDescriptor[],
): string | null => {
  if (isStillListed(resources, closed.uri)) return null;
  return `${closed.name ?? closed.uri} is no longer offered by this agent.`;
};

/**
 * Should the manifest's `ui.home` be auto-opened right now?
 *
 * Once per connection, and NOT on refresh — a refresh that re-fired this would
 * yank the user back to the home resource mid-task. The caller records the
 * connection id it has already auto-opened for and passes it as `openedFor`.
 *
 * Fail-soft, unchanged from stage 5: a `ui.home` the agent does not actually
 * serve degrades to the plain list rather than erroring (the contract requires
 * home to name a served resource; a violation is the agent's problem).
 */
export const homeResourceToAutoOpen = ({
  uiHome,
  connectionId,
  openedFor,
  resources,
}: {
  uiHome: string | null;
  connectionId: string;
  openedFor: string | null;
  resources: readonly McpResourceDescriptor[];
}): McpResourceDescriptor | null => {
  if (uiHome === null) return null;
  if (openedFor === connectionId) return null;
  return resources.find((entry) => entry.uri === uiHome) ?? null;
};
