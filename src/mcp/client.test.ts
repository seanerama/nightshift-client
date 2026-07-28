/**
 * Native MCP client unit tests: plain-JSON streamable-HTTP framing, bearer
 * auth read at call time (fail closed when the vault has no token), and
 * fail-closed typed errors on every off-shape response.
 */

import {
  callTool,
  initialize,
  listResources,
  listTools,
  McpClientError,
  readUiResourceHtml,
  toolResultText,
} from './client';

const TOKEN = 'unit-test-fake-token';

const connection = () => ({ baseUrl: 'http://agent.test', getToken: async () => TOKEN });

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>;

/** Mock fetch that echoes the request id into the configured result/error. */
const mockRpc = (body: (id: unknown, method: string) => unknown, status = 200): FetchMock => {
  const mock = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { id: unknown; method: string };
    return new Response(JSON.stringify(body(request.id, request.method)), { status });
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('transport', () => {
  it('POSTs a JSON-RPC 2.0 envelope to /app/v1/mcp with the bearer token', async () => {
    const mock = mockRpc((id) => ({
      jsonrpc: '2.0',
      id,
      result: { protocolVersion: 'x', capabilities: {} },
    }));
    await initialize(connection());

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://agent.test/app/v1/mcp');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('initialize');
    expect(typeof body.id).toBe('number');
  });

  it('fails closed with kind auth when the vault returns no token — no request is made', async () => {
    const mock = mockRpc((id) => ({ jsonrpc: '2.0', id, result: {} }));
    const bad = initialize({ baseUrl: 'http://agent.test', getToken: async () => null });
    await expect(bad).rejects.toMatchObject({ name: 'McpClientError', kind: 'auth' });
    expect(mock).not.toHaveBeenCalled();
  });

  it('maps network failure to kind network', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(initialize(connection())).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps a non-200 status to kind http', async () => {
    mockRpc((id) => ({ jsonrpc: '2.0', id, result: {} }), 404);
    await expect(initialize(connection())).rejects.toMatchObject({ kind: 'http', status: 404 });
  });

  it('maps a non-JSON body to kind shape', async () => {
    global.fetch = jest.fn(
      async () => new Response('not json', { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(initialize(connection())).rejects.toMatchObject({ kind: 'shape' });
  });

  it('rejects an envelope whose id does not match the request', async () => {
    mockRpc(() => ({ jsonrpc: '2.0', id: 999_999, result: {} }));
    await expect(initialize(connection())).rejects.toMatchObject({ kind: 'shape' });
  });

  it('maps a JSON-RPC error object to kind rpc with its code', async () => {
    mockRpc((id) => ({ jsonrpc: '2.0', id, error: { code: -32601, message: 'nope' } }));
    const bad = listTools(connection());
    await expect(bad).rejects.toBeInstanceOf(McpClientError);
    await expect(bad).rejects.toMatchObject({ kind: 'rpc', code: -32601 });
  });
});

describe('method shapes', () => {
  it('initialize validates the handshake result', async () => {
    mockRpc((id) => ({ jsonrpc: '2.0', id, result: { capabilities: {} } })); // missing protocolVersion
    await expect(initialize(connection())).rejects.toMatchObject({ kind: 'shape' });
  });

  it('resources/list returns descriptors and preserves _meta for allowlist derivation', async () => {
    mockRpc((id) => ({
      jsonrpc: '2.0',
      id,
      result: {
        resources: [
          {
            uri: 'ui://a/home@v1',
            name: 'home',
            mimeType: 'text/html',
            _meta: { 'ui/tools': ['status'] },
          },
        ],
      },
    }));
    const resources = await listResources(connection());
    expect(resources).toEqual([
      {
        uri: 'ui://a/home@v1',
        name: 'home',
        mimeType: 'text/html',
        _meta: { 'ui/tools': ['status'] },
      },
    ]);
  });

  it('resources/read returns the text/html text for the requested uri', async () => {
    mockRpc((id) => ({
      jsonrpc: '2.0',
      id,
      result: {
        contents: [{ uri: 'ui://a/home@v1', mimeType: 'text/html', text: '<p>hi</p>' }],
      },
    }));
    await expect(readUiResourceHtml(connection(), 'ui://a/home@v1')).resolves.toBe('<p>hi</p>');
  });

  it('resources/read fails closed when no text/html content matches the uri', async () => {
    mockRpc((id) => ({
      jsonrpc: '2.0',
      id,
      result: { contents: [{ uri: 'ui://a/home@v1', mimeType: 'text/plain', text: 'x' }] },
    }));
    await expect(readUiResourceHtml(connection(), 'ui://a/home@v1')).rejects.toMatchObject({
      kind: 'shape',
    });
  });

  it('tools/call sends { name, arguments } and validates the content array', async () => {
    const mock = mockRpc((id) => ({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: 'ok' }], isError: false },
    }));
    const result = await callTool(connection(), 'status', { verbose: true });
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);

    const body = JSON.parse(String((mock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.params).toEqual({ name: 'status', arguments: { verbose: true } });
  });

  it('tools/call fails closed on a result without content', async () => {
    mockRpc((id) => ({ jsonrpc: '2.0', id, result: { ok: true } }));
    await expect(callTool(connection(), 'status', {})).rejects.toMatchObject({ kind: 'shape' });
  });
});

describe('token isolation in errors', () => {
  it('no McpClientError message ever contains the token', async () => {
    mockRpc((id) => ({ jsonrpc: '2.0', id, error: { code: -32000, message: 'boom' } }));
    const err = await callTool(connection(), 'status', {}).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(TOKEN);

    mockRpc(() => ({ nonsense: true }));
    const err2 = await callTool(connection(), 'status', {}).catch((e: Error) => e);
    expect((err2 as Error).message).not.toContain(TOKEN);
  });
});

describe('toolResultText', () => {
  it('joins text content parts, skipping non-text entries', () => {
    expect(
      toolResultText({
        content: [
          { type: 'text', text: 'one' },
          { type: 'image', data: 'zzz' },
          { type: 'text', text: 'two' },
        ],
      }),
    ).toBe('one\n\ntwo');
  });

  it('returns empty string for junk', () => {
    expect(toolResultText(null)).toBe('');
    expect(toolResultText({ content: 'x' })).toBe('');
  });
});
