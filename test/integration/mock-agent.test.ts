/**
 * Integration: boot the mock agent shipped by agent-app-contract@v1.0.0 and
 * exercise the API client against it over real HTTP (node runtime).
 */
import { ApiClientError, getHealth, getManifest } from '../../src/api/client';
import { type MockAgent, startMockAgent } from './mock-agent-harness';

const TOKEN = 'integration-test-token';

let agent: MockAgent;

const connection = () => ({ baseUrl: agent.baseUrl, token: TOKEN });

beforeAll(async () => {
  agent = await startMockAgent(TOKEN);
});

afterAll(async () => {
  await agent?.stop();
});

it('manifest round-trip: contract is app-ingress v1', async () => {
  const manifest = await getManifest(connection());

  expect(manifest.contract).toEqual({ name: 'app-ingress', version: 1 });
  expect(manifest.schema).toBe(1);
  expect(manifest.agent.name).toBeTruthy();
  expect(manifest.capabilities).toContain('chat');
});

it('health round-trip: authenticated health returns ok', async () => {
  const health = await getHealth(connection());

  expect(health.ok).toBe(true);
  expect(typeof health.version).toBe('string');
  expect(health.uptimeSec).toBeGreaterThanOrEqual(0);
});

it('fails closed against the real server when the token is wrong', async () => {
  const bad = getHealth({ baseUrl: agent.baseUrl, token: 'wrong-token' });

  await expect(bad).rejects.toBeInstanceOf(ApiClientError);
  await expect(bad).rejects.toMatchObject({ kind: 'http', status: 401 });
});
