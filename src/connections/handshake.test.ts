/**
 * Unit: handshake logic — persist on valid manifest, NOTHING persisted on any
 * failure (shape / http / network / wrong contract pin), edit replaces the
 * snapshot, and the metadata record never contains the token.
 */

import type { Manifest } from 'agent-app-contract/types';

import { ApiClientError, getManifest } from '../api/client';
import { addOrUpdateConnection, deleteConnection } from './handshake';
import { MemoryConnectionStore, MemoryTokenVault } from './memory';

const TOKEN = 'fake-test-token-not-a-real-secret';

const manifest = (overrides: Partial<Manifest> = {}): Manifest => ({
  schema: 1,
  agent: { name: 'mock-agent', version: '1.2.3' },
  contract: { name: 'app-ingress', version: 1 },
  capabilities: ['chat', 'files'],
  ...overrides,
});

const deps = () => ({
  store: new MemoryConnectionStore(),
  vault: new MemoryTokenVault(),
  now: () => new Date('2026-07-27T00:00:00.000Z'),
  newId: () => 'conn-1',
});

describe('addOrUpdateConnection — success path', () => {
  it('persists the metadata snapshot and the token on a valid manifest', async () => {
    const d = deps();
    const record = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787/', token: TOKEN },
      { ...d, fetchManifest: async () => manifest({ ui: { home: 'ui://mock/home@v1' } }) },
    );

    expect(record).toEqual({
      id: 'conn-1',
      baseUrl: 'http://agent.local:8787', // trailing slash normalized
      agentName: 'mock-agent',
      agentVersion: '1.2.3',
      capabilities: ['chat', 'files'],
      uiHome: 'ui://mock/home@v1',
      isActive: true, // first connection becomes active
      createdAt: '2026-07-27T00:00:00.000Z',
      personId: null, // no person id entered → use the app default
    });
    expect(await d.store.list()).toHaveLength(1);
    expect(await d.vault.getToken('conn-1')).toBe(TOKEN);
  });

  it('treats a missing ui.home as null', async () => {
    const d = deps();
    const record = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787', token: TOKEN },
      { ...d, fetchManifest: async () => manifest() },
    );
    expect(record.uiHome).toBeNull();
  });

  it('does not activate a second connection automatically', async () => {
    const d = deps();
    let nextId = 0;
    const newId = () => `conn-${++nextId}`;
    const fetchManifest = async () => manifest();
    await addOrUpdateConnection(
      { baseUrl: 'http://a:1', token: TOKEN },
      { ...d, newId, fetchManifest },
    );
    const second = await addOrUpdateConnection(
      { baseUrl: 'http://b:2', token: TOKEN },
      { ...d, newId, fetchManifest },
    );
    expect(second.isActive).toBe(false);
  });

  it('re-handshake on edit replaces the manifest snapshot, keeping id/createdAt/active', async () => {
    const d = deps();
    const original = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787', token: TOKEN },
      { ...d, fetchManifest: async () => manifest() },
    );

    const updated = await addOrUpdateConnection(
      { id: original.id, baseUrl: 'http://agent.local:9999', token: 'fake-rotated-token' },
      {
        ...d,
        now: () => new Date('2026-08-01T00:00:00.000Z'),
        fetchManifest: async () =>
          manifest({
            agent: { name: 'mock-agent', version: '2.0.0' },
            capabilities: ['chat', 'files', 'mcp-apps-ui'],
            ui: { home: 'ui://mock/jobs@v1' },
          }),
      },
    );

    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt); // not reset by edit
    expect(updated.isActive).toBe(original.isActive);
    expect(updated.agentVersion).toBe('2.0.0');
    expect(updated.capabilities).toEqual(['chat', 'files', 'mcp-apps-ui']);
    expect(updated.uiHome).toBe('ui://mock/jobs@v1');
    expect(await d.store.list()).toHaveLength(1);
    expect(await d.vault.getToken(original.id)).toBe('fake-rotated-token');
  });
});

describe('addOrUpdateConnection — per-connection personId (stage 10)', () => {
  const fetchManifest = async () => manifest();

  it('persists a trimmed person id from the form field', async () => {
    const d = deps();
    const record = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787', token: TOKEN, personId: '  owner-alpha  ' },
      { ...d, fetchManifest },
    );
    expect(record.personId).toBe('owner-alpha');
    expect((await d.store.get('conn-1'))?.personId).toBe('owner-alpha');
  });

  it('normalizes a blank/whitespace field to null ("use the app default")', async () => {
    const d = deps();
    for (const [id, personId] of [
      ['conn-1', ''],
      ['conn-2', '   '],
    ] as const) {
      const record = await addOrUpdateConnection(
        { baseUrl: `http://agent.local/${id}`, token: TOKEN, personId },
        { ...d, fetchManifest, newId: () => id },
      );
      expect(record.personId).toBeNull();
    }
  });

  it('edit with the field submitted replaces the stored value (and blank clears it)', async () => {
    const d = deps();
    const original = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787', token: TOKEN, personId: 'owner-alpha' },
      { ...d, fetchManifest },
    );

    const changed = await addOrUpdateConnection(
      { id: original.id, baseUrl: original.baseUrl, token: TOKEN, personId: 'owner-beta' },
      { ...d, fetchManifest },
    );
    expect(changed.personId).toBe('owner-beta');

    const cleared = await addOrUpdateConnection(
      { id: original.id, baseUrl: original.baseUrl, token: TOKEN, personId: '' },
      { ...d, fetchManifest },
    );
    expect(cleared.personId).toBeNull();
    expect((await d.store.get(original.id))?.personId).toBeNull();
  });

  it('edit WITHOUT the field (undefined) preserves the stored value', async () => {
    const d = deps();
    const original = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787', token: TOKEN, personId: 'owner-alpha' },
      { ...d, fetchManifest },
    );

    const updated = await addOrUpdateConnection(
      { id: original.id, baseUrl: original.baseUrl, token: TOKEN },
      { ...d, fetchManifest },
    );
    expect(updated.personId).toBe('owner-alpha');
  });

  it('persists nothing (including the person id) when the handshake fails', async () => {
    const d = deps();
    await expect(
      addOrUpdateConnection(
        { baseUrl: 'http://agent.local:8787', token: TOKEN, personId: 'owner-alpha' },
        {
          ...d,
          fetchManifest: async () => Promise.reject(new ApiClientError('network', 'down')),
        },
      ),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(await d.store.list()).toHaveLength(0);
  });
});

describe('addOrUpdateConnection — fail closed', () => {
  it.each([
    ['shape error', new ApiClientError('shape', 'not a manifest')],
    ['http 401', new ApiClientError('http', 'unauthorized', { status: 401 })],
    ['network failure', new ApiClientError('network', 'fetch failed')],
  ])('persists nothing when the handshake fails with a %s', async (_label, error) => {
    const d = deps();
    await expect(
      addOrUpdateConnection(
        { baseUrl: 'http://agent.local:8787', token: TOKEN },
        { ...d, fetchManifest: async () => Promise.reject(error) },
      ),
    ).rejects.toBe(error);

    expect(await d.store.list()).toHaveLength(0);
    expect(d.vault.size).toBe(0);
  });

  it('rejects a manifest with the wrong contract.version through the real client, persisting nothing', async () => {
    const d = deps();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...manifest(), contract: { name: 'app-ingress', version: 2 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    try {
      const attempt = addOrUpdateConnection(
        { baseUrl: 'http://agent.local:8787', token: TOKEN },
        { ...d, fetchManifest: getManifest },
      );
      await expect(attempt).rejects.toBeInstanceOf(ApiClientError);
      await expect(attempt).rejects.toMatchObject({ kind: 'shape' });
    } finally {
      fetchMock.mockRestore();
    }

    expect(await d.store.list()).toHaveLength(0);
    expect(d.vault.size).toBe(0);
  });

  it('rejects a manifest with the wrong contract.name through the real client, persisting nothing', async () => {
    const d = deps();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...manifest(), contract: { name: 'other-contract', version: 1 } }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    try {
      await expect(
        addOrUpdateConnection(
          { baseUrl: 'http://agent.local:8787', token: TOKEN },
          { ...d, fetchManifest: getManifest },
        ),
      ).rejects.toMatchObject({ kind: 'shape' });
    } finally {
      fetchMock.mockRestore();
    }

    expect(await d.store.list()).toHaveLength(0);
    expect(d.vault.size).toBe(0);
  });

  it('removes the just-stored token when the metadata write fails for a new connection', async () => {
    const d = deps();
    jest.spyOn(d.store, 'upsert').mockRejectedValueOnce(new Error('disk full'));

    await expect(
      addOrUpdateConnection(
        { baseUrl: 'http://agent.local:8787', token: TOKEN },
        { ...d, fetchManifest: async () => manifest() },
      ),
    ).rejects.toThrow('disk full');

    expect(d.vault.size).toBe(0);
  });
});

describe('token never in metadata', () => {
  it('the serialized connection record contains no token string', async () => {
    const d = deps();
    const record = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787', token: TOKEN },
      { ...d, fetchManifest: async () => manifest() },
    );

    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(TOKEN);
    expect(Object.keys(record)).not.toContain('token');

    const storedSerialized = JSON.stringify(await d.store.list());
    expect(storedSerialized).not.toContain(TOKEN);
  });
});

describe('deleteConnection', () => {
  it('removes both the metadata row and the vault token', async () => {
    const d = deps();
    const record = await addOrUpdateConnection(
      { baseUrl: 'http://agent.local:8787', token: TOKEN },
      { ...d, fetchManifest: async () => manifest() },
    );

    await deleteConnection(record.id, d);

    expect(await d.store.list()).toHaveLength(0);
    expect(await d.vault.getToken(record.id)).toBeNull();
  });
});
