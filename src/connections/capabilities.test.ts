/** Unit: capability gating selectors (ADR 0002 — adapt to the manifest). */

import {
  CAPABILITY_CHAT,
  CAPABILITY_MCP_APPS_UI,
  gateCapability,
  hasCapability,
} from './capabilities';

describe('hasCapability', () => {
  it('is true only when the capability is present', () => {
    expect(hasCapability(['chat', 'files'], CAPABILITY_CHAT)).toBe(true);
    expect(hasCapability(['chat', 'files'], CAPABILITY_MCP_APPS_UI)).toBe(false);
  });

  it('is false for empty, null, or undefined capability lists', () => {
    expect(hasCapability([], CAPABILITY_CHAT)).toBe(false);
    expect(hasCapability(null, CAPABILITY_CHAT)).toBe(false);
    expect(hasCapability(undefined, CAPABILITY_CHAT)).toBe(false);
  });

  it('requires an exact match, not a prefix', () => {
    expect(hasCapability(['mcp-apps-ui'], 'mcp-apps')).toBe(false);
    expect(hasCapability(['mcp-tools'], CAPABILITY_MCP_APPS_UI)).toBe(false);
  });
});

describe('gateCapability', () => {
  it('gates on no active connection first', () => {
    expect(gateCapability(null, CAPABILITY_CHAT)).toBe('no-active-connection');
  });

  it('reports unsupported when the active agent lacks the capability', () => {
    expect(gateCapability({ capabilities: ['chat'] }, CAPABILITY_MCP_APPS_UI)).toBe('unsupported');
  });

  it('reports available when the active agent advertises the capability', () => {
    expect(gateCapability({ capabilities: ['chat', 'mcp-apps-ui'] }, CAPABILITY_MCP_APPS_UI)).toBe(
      'available',
    );
    expect(gateCapability({ capabilities: ['chat'] }, CAPABILITY_CHAT)).toBe('available');
  });
});
