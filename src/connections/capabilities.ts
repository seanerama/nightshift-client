/**
 * Capability gating selectors (ADR 0002: the app adapts to the manifest's
 * `capabilities` array rather than assuming features). Downstream tabs render
 * only what the active agent advertises.
 */

export const CAPABILITY_CHAT = 'chat';
export const CAPABILITY_FILES = 'files';
export const CAPABILITY_MCP_TOOLS = 'mcp-tools';
export const CAPABILITY_MCP_APPS_UI = 'mcp-apps-ui';

export type CapabilityGate =
  /** No active connection at all — point the user at the Connections tab. */
  | 'no-active-connection'
  /** Active agent does not advertise this capability. */
  | 'unsupported'
  /** Active agent advertises the capability. */
  | 'available';

export const hasCapability = (
  capabilities: readonly string[] | null | undefined,
  capability: string,
): boolean => Array.isArray(capabilities) && capabilities.includes(capability);

export const gateCapability = (
  active: { capabilities: readonly string[] } | null,
  capability: string,
): CapabilityGate => {
  if (active === null) return 'no-active-connection';
  return hasCapability(active.capabilities, capability) ? 'available' : 'unsupported';
};
