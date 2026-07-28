/**
 * Thin typed client for the app-ingress v1 surface (contracts/app-ingress.md).
 *
 * Stage 1 scope: base-URL + bearer-token plumbing and the two discovery calls,
 * GET /app/v1/manifest and GET /app/v1/health. Every route in the contract is
 * authenticated — there is NO anonymous route, health included — so the bearer
 * header is attached unconditionally.
 *
 * Fail closed: any non-2xx status, network failure, non-JSON body, or a body
 * that does not match the expected wire shape rejects with a typed
 * ApiClientError. A partial or unvalidated object is never returned.
 */

import type { HealthResponse, InboundMessage, Manifest } from 'agent-app-contract/types';

export type ApiErrorKind = 'network' | 'http' | 'shape';

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  /** HTTP status code, present for kind 'http' (and 'shape' when known). */
  readonly status?: number;
  /** Raw response body text, when one was received. */
  readonly body?: string;

  constructor(kind: ApiErrorKind, message: string, options?: { status?: number; body?: string }) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = options?.status;
    this.body = options?.body;
  }
}

export interface AgentConnection {
  /** e.g. "http://100.64.0.7:8787" — no trailing slash required. */
  baseUrl: string;
  /** Per-connection bearer token (NIGHTSHIFT_API_TOKEN pattern). */
  token: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Structural check for the Manifest wire shape, including the contract pin. */
const isManifest = (value: unknown): value is Manifest => {
  if (!isRecord(value)) return false;
  if (value.schema !== 1) return false;
  if (!isRecord(value.agent)) return false;
  if (typeof value.agent.name !== 'string' || typeof value.agent.version !== 'string') return false;
  if (!isRecord(value.contract)) return false;
  if (value.contract.name !== 'app-ingress' || value.contract.version !== 1) return false;
  if (!Array.isArray(value.capabilities)) return false;
  if (!value.capabilities.every((c) => typeof c === 'string')) return false;
  if (value.ui !== undefined) {
    if (!isRecord(value.ui)) return false;
    if (value.ui.home !== undefined && typeof value.ui.home !== 'string') return false;
  }
  return true;
};

/** Structural check for the HealthResponse wire shape. */
const isHealthResponse = (value: unknown): value is HealthResponse =>
  isRecord(value) &&
  typeof value.ok === 'boolean' &&
  typeof value.version === 'string' &&
  typeof value.uptimeSec === 'number';

const joinUrl = (baseUrl: string, path: string): string => `${baseUrl.replace(/\/+$/, '')}${path}`;

const getJson = async (connection: AgentConnection, path: string): Promise<unknown> => {
  const url = joinUrl(connection.baseUrl, path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        // Every route is authenticated; the contract has no anonymous route.
        Authorization: `Bearer ${connection.token}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new ApiClientError('network', `GET ${path} failed: ${(err as Error).message}`);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new ApiClientError('http', `GET ${path} returned ${response.status}`, {
      status: response.status,
      body,
    });
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiClientError('shape', `GET ${path} returned a non-JSON body`, {
      status: response.status,
      body,
    });
  }
};

/** GET /app/v1/manifest — discovery/handshake. Rejects unless the body is a
 * valid Manifest pinned to contract { name: "app-ingress", version: 1 }. */
export const getManifest = async (connection: AgentConnection): Promise<Manifest> => {
  const data = await getJson(connection, '/app/v1/manifest');
  if (!isManifest(data)) {
    throw new ApiClientError(
      'shape',
      'GET /app/v1/manifest body is not an app-ingress v1 manifest',
      { body: JSON.stringify(data) },
    );
  }
  return data;
};

/** Response body of POST /app/v1/messages — acceptance only, NEVER the reply
 * (async by construction; the reply arrives later as a `reply` SSE event). */
export interface MessageAccepted {
  ok: true;
  messageId: string;
}

const isMessageAccepted = (value: unknown): value is MessageAccepted =>
  isRecord(value) && value.ok === true && typeof value.messageId === 'string';

/** POST /app/v1/messages — submit an InboundMessage (stage 4).
 *
 * The contract's ONLY success status is 202 Accepted with `{ ok, messageId }`;
 * anything else fails closed, including a 200 (an agent answering a message
 * synchronously is off-contract). Re-POSTing the same messageId is safe by
 * contract invariant 5 — the dedup key makes retry-on-timeout non-duplicating. */
export const postMessage = async (
  connection: AgentConnection,
  message: InboundMessage,
): Promise<MessageAccepted> => {
  const url = joinUrl(connection.baseUrl, '/app/v1/messages');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(message),
    });
  } catch (err) {
    throw new ApiClientError('network', `POST /app/v1/messages failed: ${(err as Error).message}`);
  }

  const body = await response.text();
  if (response.status !== 202) {
    throw new ApiClientError('http', `POST /app/v1/messages returned ${response.status}`, {
      status: response.status,
      body,
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(body) as unknown;
  } catch {
    throw new ApiClientError('shape', 'POST /app/v1/messages returned a non-JSON body', {
      status: response.status,
      body,
    });
  }
  if (!isMessageAccepted(data) || data.messageId !== message.messageId) {
    throw new ApiClientError('shape', 'POST /app/v1/messages body is not { ok, messageId }', {
      status: response.status,
      body,
    });
  }
  return data;
};

/** GET /app/v1/health — authenticated liveness. A 200 with ok:false is a valid
 * response (reachable but degraded); non-2xx still rejects. */
export const getHealth = async (connection: AgentConnection): Promise<HealthResponse> => {
  const data = await getJson(connection, '/app/v1/health');
  if (!isHealthResponse(data)) {
    throw new ApiClientError('shape', 'GET /app/v1/health body is not a health response', {
      body: JSON.stringify(data),
    });
  }
  return data;
};
