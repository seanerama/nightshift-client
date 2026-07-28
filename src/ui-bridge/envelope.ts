/**
 * ui-bridge v1 envelope layer (contracts/ui-bridge.md — FROZEN).
 *
 * Strict JSON-RPC 2.0 over postMessage strings. Parsing is total: every
 * incoming frame classifies as request, notification, or malformed — a
 * malformed frame is DROPPED AND COUNTED by the caller, never partially
 * processed (contract §Schema/wire). Outgoing frames are built here so that
 * every response/event the shell emits is a valid envelope by construction.
 */

/** Allowlist violation / method not found (contract: violations → -32601). */
export const ERROR_METHOD_NOT_FOUND = -32601;
/** Shell-side timeout (contract: 30s v1 → -32000). */
export const ERROR_TIMEOUT = -32000;
/** Invalid params on an otherwise valid request (JSON-RPC 2.0 standard). */
export const ERROR_INVALID_PARAMS = -32602;
/** The forwarded call failed (network/agent error) — JSON-RPC server error. */
export const ERROR_CALL_FAILED = -32001;

export type BridgeRequestId = string | number;

export interface BridgeRequest {
  kind: 'request';
  id: BridgeRequestId;
  method: string;
  params: Record<string, unknown> | undefined;
}

export interface BridgeNotification {
  kind: 'notification';
  method: string;
  params: Record<string, unknown> | undefined;
}

export interface MalformedFrame {
  kind: 'malformed';
  reason: string;
}

export type BridgeFrame = BridgeRequest | BridgeNotification | MalformedFrame;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const malformed = (reason: string): MalformedFrame => ({ kind: 'malformed', reason });

/**
 * Classify one raw postMessage payload. Strict by the frozen contract:
 * `jsonrpc` must be exactly "2.0"; `method` must be a string; a request's
 * `id` must be a string or number (a null id is malformed — every request
 * carries a usable id, or the shell could not honor exactly-one-response);
 * `params`, when present, must be an object.
 */
export const parseBridgeFrame = (raw: unknown): BridgeFrame => {
  if (typeof raw !== 'string') return malformed('frame is not a string');

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return malformed('frame is not valid JSON');
  }

  if (!isRecord(value)) return malformed('frame is not a JSON object');
  if (value.jsonrpc !== '2.0') return malformed('jsonrpc is not "2.0"');
  if (typeof value.method !== 'string' || value.method.length === 0) {
    return malformed('method is not a non-empty string');
  }
  if (value.params !== undefined && !isRecord(value.params)) {
    return malformed('params is not an object');
  }
  const params = value.params as Record<string, unknown> | undefined;

  if ('id' in value) {
    const id = value.id;
    if (typeof id !== 'string' && typeof id !== 'number') {
      return malformed('id is not a string or number');
    }
    return { kind: 'request', id, method: value.method, params };
  }
  return { kind: 'notification', method: value.method, params };
};

/** Success response frame (serialized, ready to inject). */
export const buildResponseFrame = (id: BridgeRequestId, result: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, result: result ?? null });

/** Error response frame (serialized, ready to inject). */
export const buildErrorFrame = (id: BridgeRequestId, code: number, message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

/** Theme payload pushed by the shell (contract: light/dark + safe-area insets,
 * on load and on change). */
export interface ThemeParams {
  scheme: 'light' | 'dark';
  insets: { top: number; right: number; bottom: number; left: number };
}

/** `ui/theme` shell→resource event frame (a JSON-RPC notification). */
export const buildThemeFrame = (theme: ThemeParams): string =>
  JSON.stringify({ jsonrpc: '2.0', method: 'ui/theme', params: theme });
