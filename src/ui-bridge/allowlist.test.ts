/**
 * Allowlist derivation (contracts/ui-bridge.md §Consumes): declared MCP Apps
 * metadata ∩ manifest capabilities; declaring NOTHING yields an EMPTY
 * allowlist — fail closed, the security posture ADR 0004 requires.
 */

import { deriveAllowlist, RESOURCE_TOOLS_META_KEY } from './allowlist';

const CAPS = ['chat', 'mcp-tools', 'mcp-apps-ui'] as const;

const resource = (_meta?: Record<string, unknown>) => ({ uri: 'ui://mock-agent/home@v1', _meta });

describe('deriveAllowlist', () => {
  it('derives declared tools when the manifest grants mcp-tools', () => {
    const allowlist = deriveAllowlist({
      resource: resource({ [RESOURCE_TOOLS_META_KEY]: ['status', 'jobs_list'] }),
      capabilities: CAPS,
    });
    expect([...allowlist].sort()).toEqual(['jobs_list', 'status']);
  });

  it('a resource that declares nothing gets an EMPTY allowlist (fail closed)', () => {
    // The canonical mock agent's resource carries no _meta at all — exactly
    // this case: every tools/call through the bridge must be refused.
    expect(deriveAllowlist({ resource: resource(undefined), capabilities: CAPS }).size).toBe(0);
  });

  it('a _meta without the tools key yields an empty allowlist', () => {
    expect(
      deriveAllowlist({ resource: resource({ other: ['status'] }), capabilities: CAPS }).size,
    ).toBe(0);
  });

  it('a non-array declaration yields an empty allowlist', () => {
    expect(
      deriveAllowlist({
        resource: resource({ [RESOURCE_TOOLS_META_KEY]: 'status' }),
        capabilities: CAPS,
      }).size,
    ).toBe(0);
  });

  it('drops non-string and empty entries, keeps valid ones', () => {
    const allowlist = deriveAllowlist({
      resource: resource({ [RESOURCE_TOOLS_META_KEY]: ['status', 7, '', null, { name: 'x' }] }),
      capabilities: CAPS,
    });
    expect([...allowlist]).toEqual(['status']);
  });

  it('intersection with capabilities: no mcp-tools in the manifest → empty, even with declarations', () => {
    const allowlist = deriveAllowlist({
      resource: resource({ [RESOURCE_TOOLS_META_KEY]: ['status'] }),
      capabilities: ['chat', 'mcp-apps-ui'],
    });
    expect(allowlist.size).toBe(0);
  });

  it('deduplicates declared tool names', () => {
    const allowlist = deriveAllowlist({
      resource: resource({ [RESOURCE_TOOLS_META_KEY]: ['status', 'status'] }),
      capabilities: CAPS,
    });
    expect(allowlist.size).toBe(1);
  });
});
