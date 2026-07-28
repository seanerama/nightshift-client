/**
 * Unit: sqlite row → ConnectionRecord mapping (stage 10), with the migration
 * v3 person_id column — NULL (legacy rows / "use the app default") and set
 * both map through unchanged; resolution to the default happens ONLY in the
 * connections context via resolvePersonId, never in the mapping.
 */

import { resolvePersonId } from '../chat/person-id';
import { type ConnectionRow, rowToRecord } from './connection-row';

const row = (overrides: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: 'conn-1',
  base_url: 'http://100.64.0.7:8787',
  agent_name: 'mock-agent',
  agent_version: '1.2.3',
  capabilities: '["chat","files"]',
  ui_home: null,
  is_active: 1,
  created_at: '2026-07-27T00:00:00.000Z',
  person_id: null,
  ...overrides,
});

describe('rowToRecord', () => {
  it('maps a NULL person_id (pre-v3 row) to personId null', () => {
    const record = rowToRecord(row({ person_id: null }));
    expect(record).toEqual({
      id: 'conn-1',
      baseUrl: 'http://100.64.0.7:8787',
      agentName: 'mock-agent',
      agentVersion: '1.2.3',
      capabilities: ['chat', 'files'],
      uiHome: null,
      isActive: true,
      createdAt: '2026-07-27T00:00:00.000Z',
      personId: null,
    });
  });

  it('maps a stored person_id through verbatim', () => {
    const record = rowToRecord(row({ person_id: 'owner-alpha' }));
    expect(record.personId).toBe('owner-alpha');
  });

  it('maps is_active 0 to false and parses capabilities JSON', () => {
    const record = rowToRecord(row({ is_active: 0, capabilities: '[]' }));
    expect(record.isActive).toBe(false);
    expect(record.capabilities).toEqual([]);
  });

  it('resolution fallback: null resolves to the default, a stored value to itself', () => {
    // The mapping + resolver pair is exactly what ActiveConnection.personId is
    // built from (connections-context): stored value ?? OWNER_PERSON_ID.
    expect(resolvePersonId(rowToRecord(row({ person_id: null })).personId)).toBe(
      'owner-nightshift',
    );
    expect(resolvePersonId(rowToRecord(row({ person_id: 'owner-beta' })).personId)).toBe(
      'owner-beta',
    );
  });
});
