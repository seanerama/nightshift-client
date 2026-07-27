/**
 * Integration (stage 3): the full add-connection flow — real stage-1 client,
 * real handshake module, real mock agent over HTTP. In-memory storage seams
 * stand in for the native modules (identical interfaces).
 */
import { ApiClientError, getHealth, getManifest } from '../../src/api/client';
import { addOrUpdateConnection, deleteConnection } from '../../src/connections/handshake';
import { type HealthState, reduceHealth } from '../../src/connections/health';
import { MemoryConnectionStore, MemoryTokenVault } from '../../src/connections/memory';
import { type MockAgent, startMockAgent } from './mock-agent-harness';

const TOKEN = 'integration-test-token';

let agent: MockAgent;

beforeAll(async () => {
  agent = await startMockAgent(TOKEN);
});

afterAll(async () => {
  await agent?.stop();
});

it('add-connection flow: handshake persists the manifest snapshot and the token', async () => {
  const store = new MemoryConnectionStore();
  const vault = new MemoryTokenVault();

  const record = await addOrUpdateConnection(
    { baseUrl: agent.baseUrl, token: TOKEN },
    { store, vault },
  );

  // Metadata captured from the real manifest, including capabilities + ui.home.
  const manifest = await getManifest({ baseUrl: agent.baseUrl, token: TOKEN });
  expect(record.agentName).toBe(manifest.agent.name);
  expect(record.agentVersion).toBe(manifest.agent.version);
  expect(record.capabilities).toEqual(manifest.capabilities);
  expect(record.capabilities).toContain('chat');
  expect(record.uiHome).toBe(manifest.ui?.home ?? null);
  expect(record.isActive).toBe(true); // first connection auto-activates

  // Persisted: one row, token retrievable from the vault only.
  expect(await store.list()).toHaveLength(1);
  expect(await vault.getToken(record.id)).toBe(TOKEN);
  expect(JSON.stringify(await store.list())).not.toContain(TOKEN);
});

it('health dot logic sees ok through the real health route', async () => {
  const health = await getHealth({ baseUrl: agent.baseUrl, token: TOKEN });

  let state: HealthState = 'unknown';
  state = reduceHealth(state, { type: 'result', ok: health.ok });

  expect(state).toBe('ok');
});

it('wrong token: fails closed with the contract error shape and persists nothing', async () => {
  const store = new MemoryConnectionStore();
  const vault = new MemoryTokenVault();

  const attempt = addOrUpdateConnection(
    { baseUrl: agent.baseUrl, token: 'wrong-token' },
    { store, vault },
  );

  await expect(attempt).rejects.toBeInstanceOf(ApiClientError);
  await expect(attempt).rejects.toMatchObject({ kind: 'http', status: 401 });
  expect(await store.list()).toHaveLength(0);
  expect(vault.size).toBe(0);
});

it('delete removes the row and the token; re-add requires re-entry', async () => {
  const store = new MemoryConnectionStore();
  const vault = new MemoryTokenVault();
  const record = await addOrUpdateConnection(
    { baseUrl: agent.baseUrl, token: TOKEN },
    { store, vault },
  );

  await deleteConnection(record.id, { store, vault });

  expect(await store.list()).toHaveLength(0);
  expect(await vault.getToken(record.id)).toBeNull();
});
