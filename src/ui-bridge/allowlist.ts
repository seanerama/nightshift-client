/**
 * Per-resource tool allowlist derivation (contracts/ui-bridge.md §Consumes):
 * "v1 derives it from the resource's declared MCP Apps metadata, intersected
 * with the connection's manifest capabilities."
 *
 * WHERE a resource declares its tools (recorded choice): the canonical
 * app-ingress contract names MCP Apps (SEP-1865) but pins no metadata key,
 * and the mock agent's `ui://` resource declares no `_meta` at all. `_meta`
 * is the MCP spec's extension point on resource descriptors, so this shell —
 * the OWNER of ui-bridge v1 — defines the v1 reading: the resource descriptor
 * declares its callable tools as an array of tool-name strings at
 * `_meta["ui/tools"]`. A resource that declares nothing (the mock's case)
 * gets an EMPTY allowlist — fail closed, every tools/call refused (-32601).
 *
 * Capability intersection: v1's manifest vocabulary gates ALL tool invocation
 * behind the `mcp-tools` capability (contracts/app-ingress.md §Capabilities);
 * there is no finer-grained per-tool capability in v1. So the intersection is:
 * no `mcp-tools` in the manifest → empty allowlist regardless of declarations.
 * A finer vocabulary later narrows this additively; it can never widen it.
 */

import { CAPABILITY_MCP_TOOLS, hasCapability } from '../connections/capabilities';

/** The `_meta` key (MCP extension point) where a ui:// resource declares the
 * tool names it may call through the bridge. */
export const RESOURCE_TOOLS_META_KEY = 'ui/tools';

export interface AllowlistSource {
  /** Resource descriptor fields relevant to derivation. */
  resource: { uri: string; _meta?: Record<string, unknown> };
  /** The owning connection's manifest `capabilities`. */
  capabilities: readonly string[];
}

/**
 * Derive the allowlist for one resource. Fail closed at every step: missing
 * `_meta`, missing key, a non-array value, and non-string / empty entries all
 * contribute NOTHING to the allowlist.
 */
export const deriveAllowlist = ({
  resource,
  capabilities,
}: AllowlistSource): ReadonlySet<string> => {
  // Manifest gate first: without mcp-tools, tools/call does not exist for
  // this connection at all — declared or not.
  if (!hasCapability(capabilities, CAPABILITY_MCP_TOOLS)) return new Set();

  const meta = resource._meta;
  if (meta === undefined) return new Set();
  const declared = meta[RESOURCE_TOOLS_META_KEY];
  if (!Array.isArray(declared)) return new Set();

  const allowed = new Set<string>();
  for (const entry of declared) {
    if (typeof entry === 'string' && entry.length > 0) allowed.add(entry);
  }
  return allowed;
};
