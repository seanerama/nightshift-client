import { ApiClientError, getHealth, getManifest } from './client';

const connection = { baseUrl: 'http://127.0.0.1:9', token: 'test-token' };

const validManifest = {
  schema: 1,
  agent: { name: 'mock-agent', version: '1.0.0' },
  contract: { name: 'app-ingress', version: 1 },
  capabilities: ['chat'],
};

const validHealth = { ok: true, version: '1.0.0', uptimeSec: 12 };

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
});

const requestOf = (call: unknown[]): { url: string; init: RequestInit } => ({
  url: String(call[0]),
  init: (call[1] ?? {}) as RequestInit,
});

describe('bearer token plumbing', () => {
  it('attaches the Authorization header to manifest requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validManifest));

    await getManifest(connection);

    const { url, init } = requestOf(fetchMock.mock.calls[0]);
    expect(url).toBe('http://127.0.0.1:9/app/v1/manifest');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('attaches the Authorization header to health requests too (no anonymous route)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validHealth));

    await getHealth(connection);

    const { url, init } = requestOf(fetchMock.mock.calls[0]);
    expect(url).toBe('http://127.0.0.1:9/app/v1/health');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('tolerates a trailing slash on the base URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validHealth));

    await getHealth({ ...connection, baseUrl: 'http://127.0.0.1:9/' });

    expect(requestOf(fetchMock.mock.calls[0]).url).toBe('http://127.0.0.1:9/app/v1/health');
  });
});

describe('fail closed on non-2xx', () => {
  it.each([
    [401, '{"ok":false,"error":"missing bearer token"}'],
    [500, 'internal'],
  ])('rejects manifest fetch on HTTP %d', async (status, body) => {
    fetchMock.mockResolvedValueOnce(new Response(body, { status }));

    const promise = getManifest(connection);
    await expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await expect(promise).rejects.toMatchObject({ kind: 'http', status });
  });

  it('rejects health fetch on HTTP 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":false,"error":"missing bearer token"}', { status: 401 }),
    );

    const promise = getHealth(connection);
    await expect(promise).rejects.toBeInstanceOf(ApiClientError);
    await expect(promise).rejects.toMatchObject({ kind: 'http', status: 401 });
  });

  it('rejects on network failure with a typed error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(getManifest(connection)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('fail closed on invalid shapes', () => {
  it('rejects a manifest whose contract.name is not app-ingress', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...validManifest, contract: { name: 'other-contract', version: 1 } }),
    );

    await expect(getManifest(connection)).rejects.toMatchObject({ kind: 'shape' });
  });

  it('rejects a manifest whose contract.version is not 1', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...validManifest, contract: { name: 'app-ingress', version: 2 } }),
    );

    await expect(getManifest(connection)).rejects.toMatchObject({ kind: 'shape' });
  });

  it('rejects a manifest missing capabilities rather than returning a partial object', async () => {
    const { capabilities: _dropped, ...partial } = validManifest;
    fetchMock.mockResolvedValueOnce(jsonResponse(partial));

    await expect(getManifest(connection)).rejects.toMatchObject({ kind: 'shape' });
  });

  it('rejects a non-JSON manifest body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 200 }));

    await expect(getManifest(connection)).rejects.toMatchObject({ kind: 'shape' });
  });

  it('rejects a malformed health body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: 'yes' }));

    await expect(getHealth(connection)).rejects.toMatchObject({ kind: 'shape' });
  });
});

describe('valid responses', () => {
  it('returns the manifest when the shape and contract pin are valid', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validManifest));

    const manifest = await getManifest(connection);
    expect(manifest.contract).toEqual({ name: 'app-ingress', version: 1 });
    expect(manifest.capabilities).toContain('chat');
  });

  it('returns health including ok:false (reachable but degraded is a valid response)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...validHealth, ok: false }));

    const health = await getHealth(connection);
    expect(health.ok).toBe(false);
  });
});
