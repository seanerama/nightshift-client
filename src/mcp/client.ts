/**
 * Minimal, hand-rolled MCP client over `POST /app/v1/mcp` (streamable HTTP —
 * contracts/app-ingress.md §MCP). Supports exactly what stage 5 needs:
 * `initialize`, `resources/list`, `resources/read` (ui:// → text/html),
 * `tools/list`, `tools/call`.
 *
 * FRAMING (recorded choice): the canonical mock agent answers every MCP
 * request with a single plain-JSON body (`content-type: application/json`),
 * never an SSE-framed response — see agent-app-contract
 * packages/mock-agent/src/server.ts (`sendJson` on every rpc branch). This
 * client therefore speaks plain JSON request→response. If a future agent
 * answers with `text/event-stream` framing, that is an additive extension
 * here, not a rewrite.
 *
 * DEPENDENCY (recorded choice): @modelcontextprotocol/sdk is NOT used — it is
 * not certified under RN/Hermes + expo fetch, and the five calls above need
 * ~200 lines. A minimal client is easier to certify against ADR 0004.
 *
 * TOKEN ISOLATION (ADR 0004): the bearer token is read via `getToken()` at
 * call time, attached to the request header, and NEVER stored on the client,
 * returned, logged, or embedded in errors. This module is the ONLY place
 * agent-bound MCP traffic acquires auth; the WebView never sees it.
 *
 * Fail closed like the stage-1 client: any network failure, non-200 status,
 * non-JSON body, envelope mismatch, or JSON-RPC error object rejects with a
 * typed McpClientError. A partial result is never returned.
 */

export type McpErrorKind = 'network' | 'http' | 'shape' | 'rpc' | 'auth';

export class McpClientError extends Error {
  readonly kind: McpErrorKind;
  /** HTTP status, for kind 'http'. */
  readonly status?: number;
  /** JSON-RPC error code, for kind 'rpc'. */
  readonly code?: number;

  constructor(kind: McpErrorKind, message: string, options?: { status?: number; code?: number }) {
    super(message);
    this.name = 'McpClientError';
    this.kind = kind;
    this.status = options?.status;
    this.code = options?.code;
  }
}

/** Connection seam: matches ActiveConnection (baseUrl + token accessor). */
export interface McpConnection {
  baseUrl: string;
  /** Read the bearer token at call time; null → fail closed ('auth'). */
  getToken: () => Promise<string | null>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** MCP protocol version offered on initialize. The contract pins none
 * ("Explicitly unspecified" §1); the server echoes or answers its own. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string };
}

/** A resource descriptor as listed by resources/list. `_meta` is the MCP
 * extension point where MCP Apps (SEP-1865) metadata lives; it is carried
 * through verbatim for allowlist derivation and never interpreted here. */
export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

let nextRequestId = 1;

/** Core JSON-RPC 2.0 round-trip. Returns the envelope's `result`. */
const rpc = async (
  connection: McpConnection,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> => {
  const token = await connection.getToken();
  if (token === null) {
    throw new McpClientError('auth', `MCP ${method}: no token available for this connection`);
  }

  const id = nextRequestId;
  nextRequestId += 1;
  const url = `${connection.baseUrl.replace(/\/+$/, '')}/app/v1/mcp`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        params === undefined
          ? { jsonrpc: '2.0', id, method }
          : { jsonrpc: '2.0', id, method, params },
      ),
    });
  } catch (err) {
    throw new McpClientError('network', `MCP ${method} failed: ${(err as Error).message}`);
  }

  const body = await response.text();
  if (response.status !== 200) {
    throw new McpClientError('http', `MCP ${method} returned HTTP ${response.status}`, {
      status: response.status,
    });
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(body) as unknown;
  } catch {
    throw new McpClientError('shape', `MCP ${method} returned a non-JSON body`);
  }

  if (!isRecord(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== id) {
    throw new McpClientError(
      'shape',
      `MCP ${method} response is not a JSON-RPC 2.0 reply to id ${id}`,
    );
  }
  if ('error' in envelope) {
    const error = envelope.error;
    const code = isRecord(error) && typeof error.code === 'number' ? error.code : undefined;
    const message =
      isRecord(error) && typeof error.message === 'string' ? error.message : 'unknown MCP error';
    throw new McpClientError('rpc', `MCP ${method} error: ${message}`, { code });
  }
  if (!('result' in envelope)) {
    throw new McpClientError('shape', `MCP ${method} response has neither result nor error`);
  }
  return envelope.result;
};

/** MCP initialize handshake. */
export const initialize = async (connection: McpConnection): Promise<McpInitializeResult> => {
  const result = await rpc(connection, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'nightshift-client', version: '0.1.0' },
  });
  if (
    !isRecord(result) ||
    typeof result.protocolVersion !== 'string' ||
    !isRecord(result.capabilities)
  ) {
    throw new McpClientError('shape', 'MCP initialize result is not an initialize response');
  }
  return result as unknown as McpInitializeResult;
};

/** resources/list → descriptors with `_meta` preserved for allowlist derivation. */
export const listResources = async (
  connection: McpConnection,
): Promise<McpResourceDescriptor[]> => {
  const result = await rpc(connection, 'resources/list');
  if (!isRecord(result) || !Array.isArray(result.resources)) {
    throw new McpClientError('shape', 'MCP resources/list result has no resources array');
  }
  const resources: McpResourceDescriptor[] = [];
  for (const entry of result.resources) {
    if (!isRecord(entry) || typeof entry.uri !== 'string') {
      throw new McpClientError('shape', 'MCP resources/list entry has no string uri');
    }
    resources.push({
      uri: entry.uri,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : undefined,
      _meta: isRecord(entry._meta) ? entry._meta : undefined,
    });
  }
  return resources;
};

/** resources/read for a ui:// resource — returns its text/html text, fail
 * closed on anything else (wrong uri, wrong mimeType, missing text). */
export const readUiResourceHtml = async (
  connection: McpConnection,
  uri: string,
): Promise<string> => {
  const result = await rpc(connection, 'resources/read', { uri });
  if (!isRecord(result) || !Array.isArray(result.contents)) {
    throw new McpClientError('shape', 'MCP resources/read result has no contents array');
  }
  for (const content of result.contents) {
    if (
      isRecord(content) &&
      content.uri === uri &&
      content.mimeType === 'text/html' &&
      typeof content.text === 'string'
    ) {
      return content.text;
    }
  }
  throw new McpClientError('shape', `MCP resources/read returned no text/html content for ${uri}`);
};

/** tools/list. */
export const listTools = async (connection: McpConnection): Promise<McpToolDescriptor[]> => {
  const result = await rpc(connection, 'tools/list');
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    throw new McpClientError('shape', 'MCP tools/list result has no tools array');
  }
  const tools: McpToolDescriptor[] = [];
  for (const entry of result.tools) {
    if (!isRecord(entry) || typeof entry.name !== 'string') {
      throw new McpClientError('shape', 'MCP tools/list entry has no string name');
    }
    tools.push(entry as unknown as McpToolDescriptor);
  }
  return tools;
};

/** Pure extractor: the plain-text rendering of a tool result (the fallback
 * card's "underlying tool result" — ADR 0004 mandates every result has one). */
export const toolResultText = (result: unknown): string => {
  if (!isRecord(result) || !Array.isArray(result.content)) return '';
  const parts: string[] = [];
  for (const entry of result.content) {
    if (isRecord(entry) && entry.type === 'text' && typeof entry.text === 'string') {
      parts.push(entry.text);
    }
  }
  return parts.join('\n\n');
};

/** tools/call — the ONLY path by which resource HTML reaches a tool, and only
 * ever behind the bridge's allowlist check (src/ui-bridge/bridge.ts). */
export const callTool = async (
  connection: McpConnection,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> => {
  const result = await rpc(connection, 'tools/call', { name, arguments: args });
  if (!isRecord(result) || !Array.isArray(result.content)) {
    throw new McpClientError('shape', 'MCP tools/call result has no content array');
  }
  return result as unknown as McpToolResult;
};
