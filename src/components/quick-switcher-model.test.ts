/**
 * Unit: quick-switcher list model (stage 10) — row projection, active
 * marking, and the switch-dispatch decision.
 */

import type { ConnectionRecord } from '../connections/types';
import { buildSwitcherRows, shouldDispatchSwitch } from './quick-switcher-model';

const record = (overrides: Partial<ConnectionRecord>): ConnectionRecord => ({
  id: 'conn-1',
  baseUrl: 'http://a:1',
  agentName: 'agent-a',
  agentVersion: '1.0.0',
  capabilities: ['chat'],
  uiHome: null,
  isActive: false,
  createdAt: '2026-07-27T00:00:00.000Z',
  personId: null,
  ...overrides,
});

describe('buildSwitcherRows', () => {
  it('projects each connection to name, base URL, and active flag, keeping order', () => {
    const rows = buildSwitcherRows([
      record({ id: 'a', agentName: 'alpha', baseUrl: 'http://a:1', isActive: false }),
      record({ id: 'b', agentName: 'beta', baseUrl: 'http://b:2', isActive: true }),
    ]);
    expect(rows).toEqual([
      { id: 'a', name: 'alpha', baseUrl: 'http://a:1', isActive: false },
      { id: 'b', name: 'beta', baseUrl: 'http://b:2', isActive: true },
    ]);
  });

  it('marks exactly the active connection (or none)', () => {
    const none = buildSwitcherRows([record({ id: 'a' }), record({ id: 'b' })]);
    expect(none.filter((row) => row.isActive)).toHaveLength(0);

    const one = buildSwitcherRows([record({ id: 'a' }), record({ id: 'b', isActive: true })]);
    expect(one.filter((row) => row.isActive).map((row) => row.id)).toEqual(['b']);
  });

  it('handles the empty list', () => {
    expect(buildSwitcherRows([])).toEqual([]);
  });
});

describe('shouldDispatchSwitch', () => {
  it('dispatches setActive for an inactive row', () => {
    expect(shouldDispatchSwitch({ id: 'a', name: 'alpha', baseUrl: 'u', isActive: false })).toBe(
      true,
    );
  });

  it('is a no-op switch for the already-active row (the sheet still closes)', () => {
    expect(shouldDispatchSwitch({ id: 'a', name: 'alpha', baseUrl: 'u', isActive: true })).toBe(
      false,
    );
  });
});
