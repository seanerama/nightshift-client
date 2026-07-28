/**
 * Stage-5 integration: the native MCP client + ui-bridge against the REAL
 * mock agent shipped by agent-app-contract@v1.0.0 (real HTTP, real tool).
 *
 * Proves the contract path end to end: initialize → resources/list has the
 * ui:// resource → resources/read returns text/html → a simulated bridge
 * tools/call round-trip executes the real `status` tool and returns its real
 * result — and the security half: a non-allowlisted tools/call is refused
 * WITHOUT any HTTP reaching the agent (fetch spy), and a failed resource
 * read selects the fallback path.
 */

import {
  callTool,
  initialize,
  listResources,
  type McpConnection,
  readUiResourceHtml,
  toolResultText,
} from '../../src/mcp/client';
import { deriveAllowlist, RESOURCE_TOOLS_META_KEY } from '../../src/ui-bridge/allowlist';
import { createBridgeSession } from '../../src/ui-bridge/bridge';
import { reduceResourceView } from '../../src/ui-bridge/fallback';
import { type MockAgent, startMockAgent } from './mock-agent-harness';

const TOKEN = 'integration-test-token';
const CAPABILITIES = ['chat', 'mcp-tools', 'mcp-apps-ui'] as const;
/** The one resource the mock publishes (mock-agent source, UI_RESOURCE). */
const MOCK_UI_RESOURCE = 'ui://mock-agent/home@v1';

let agent: MockAgent;

const connection = (): McpConnection => ({
  baseUrl: agent.baseUrl,
  getToken: async () => TOKEN,
});

const waitFor = async (predicate: () => boolean, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

beforeAll(async () => {
  agent = await startMockAgent(TOKEN, { capabilities: [...CAPABILITIES] });
});

afterAll(async () => {
  await agent?.stop();
});

it('initialize handshake succeeds and advertises tools + resources', async () => {
  const result = await initialize(connection());
  expect(typeof result.protocolVersion).toBe('string');
  expect(result.capabilities).toMatchObject({ tools: {}, resources: {} });
});

it('resources/list contains the ui:// resource as text/html', async () => {
  const resources = await listResources(connection());
  expect(resources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ uri: MOCK_UI_RESOURCE, mimeType: 'text/html' }),
    ]),
  );
});

it('resources/read returns the resource html', async () => {
  const html = await readUiResourceHtml(connection(), MOCK_UI_RESOURCE);
  expect(html).toContain('mock-agent home');
});

it('bridge round-trip: allowlisted tools/call reaches the REAL tool and returns its real result', async () => {
  // The mock's own resource declares no MCP Apps tool metadata, so its
  // allowlist is empty by design. To exercise the ALLOWED path against the
  // real agent, derive the allowlist from a resource descriptor that declares
  // the real `status` tool — the shape an agent uses to grant access.
  const allowlist = deriveAllowlist({
    resource: { uri: MOCK_UI_RESOURCE, _meta: { [RESOURCE_TOOLS_META_KEY]: ['status'] } },
    capabilities: [...CAPABILITIES],
  });
  expect([...allowlist]).toEqual(['status']);

  const posted: string[] = [];
  const session = createBridgeSession({
    allowlist,
    callTool: (name, args) => callTool(connection(), name, args),
    post: (frame) => posted.push(frame),
  });

  // The exact frame a resource's inline script would postMessage.
  session.handleFrame(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'round-trip-1',
      method: 'tools/call',
      params: { name: 'status', arguments: {} },
    }),
  );
  await waitFor(() => posted.length === 1);
  session.dispose();

  const response = JSON.parse(posted[0] as string) as {
    jsonrpc: string;
    id: string;
    result: { content: Array<{ type: string; text: string }>; isError: boolean };
  };
  expect(response.jsonrpc).toBe('2.0');
  expect(response.id).toBe('round-trip-1');
  expect(response.result.isError).toBe(false);
  // The real tool's real payload: the mock's status tool reports ok + version.
  const text = toolResultText(response.result);
  expect(JSON.parse(text.split('\n\n')[0] as string)).toMatchObject({ ok: true });
});

it('non-allowlisted tools/call is refused with -32601 WITHOUT any HTTP to the agent', async () => {
  // The REAL mock resource: no declared metadata → empty allowlist.
  const resources = await listResources(connection());
  const mockResource = resources.find((r) => r.uri === MOCK_UI_RESOURCE);
  expect(mockResource).toBeDefined();
  const allowlist = deriveAllowlist({
    resource: mockResource as { uri: string; _meta?: Record<string, unknown> },
    capabilities: [...CAPABILITIES],
  });
  expect(allowlist.size).toBe(0);

  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  const posted: string[] = [];
  const session = createBridgeSession({
    allowlist,
    callTool: (name, args) => callTool(connection(), name, args),
    post: (frame) => posted.push(frame),
  });

  session.handleFrame(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'status', arguments: {} },
    }),
  );
  session.dispose();

  expect(posted).toHaveLength(1);
  expect(JSON.parse(posted[0] as string)).toMatchObject({ id: 2, error: { code: -32601 } });
  expect(session.counts().violations).toBe(1);
  // The agent was never contacted: the refusal happened entirely on-device.
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

it('a corrupted/failed resource read selects the fallback path', async () => {
  const failure = await readUiResourceHtml(connection(), 'ui://mock-agent/does-not-exist@v1').then(
    () => null,
    (err: Error) => err,
  );
  expect(failure).not.toBeNull();

  // Feed the failure into the view reducer exactly as the screen does.
  const state = reduceResourceView(
    { phase: 'loading' },
    { type: 'read-failed', detail: (failure as Error).message },
  );
  expect(state).toMatchObject({ phase: 'fallback', reason: 'read-failed' });
});

it('fails closed against the real server when the token is wrong', async () => {
  const bad = initialize({ baseUrl: agent.baseUrl, getToken: async () => 'wrong-token' });
  await expect(bad).rejects.toMatchObject({ name: 'McpClientError', kind: 'http', status: 401 });
});
