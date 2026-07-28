/**
 * ui-bridge v1 session: the method router + response plumbing between ONE
 * resource WebView and the native MCP client (contracts/ui-bridge.md, FROZEN).
 *
 * Behavior implemented verbatim:
 * - `tools/call`: per-resource allowlist checked FIRST — a non-allowlisted
 *   tool is answered -32601, counted, and NEVER forwarded to the MCP client.
 * - `ui/ready` / `ui/close`: signals to the shell (loading state / dismiss).
 * - Every id-carrying request gets EXACTLY ONE response (result or error);
 *   the shell's timeout (30s v1) answers -32000 and a late tool resolution
 *   is then dropped, never double-sent.
 * - Malformed frames are dropped and counted, never partially processed.
 * - Shell→resource events: `ui/theme` on load and change (pushTheme).
 *
 * The session is pure plumbing — no React, no WebView, injectable clock —
 * so every branch above is unit-testable.
 */

import {
  type BridgeRequest,
  type BridgeRequestId,
  buildErrorFrame,
  buildResponseFrame,
  buildThemeFrame,
  ERROR_CALL_FAILED,
  ERROR_INVALID_PARAMS,
  ERROR_METHOD_NOT_FOUND,
  ERROR_TIMEOUT,
  parseBridgeFrame,
  type ThemeParams,
} from './envelope';

/** Contract v1: the shell answers -32000 after 30s. */
export const BRIDGE_TIMEOUT_MS = 30_000;

export interface BridgeCounts {
  /** Frames dropped for failing strict JSON-RPC 2.0 validation. */
  malformed: number;
  /** Allowlist / unknown-method violations (each answered -32601). */
  violations: number;
}

export interface BridgeSessionDeps {
  /** Per-resource allowlist (deriveAllowlist) — checked before forwarding. */
  allowlist: ReadonlySet<string>;
  /** Forward an ALLOWLISTED tools/call to the native MCP client. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Deliver a serialized frame to the resource WebView. */
  post: (frame: string) => void;
  /** Resource signaled it rendered — hide the loading state. */
  onReady?: () => void;
  /** Resource asked to be dismissed. */
  onClose?: () => void;
  /** Called after every malformed/violation increment (fallback storm gate). */
  onCounts?: (counts: BridgeCounts) => void;
  /** Injectable clock for tests. Defaults: setTimeout/clearTimeout, 30s. */
  timeoutMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface BridgeSession {
  /** Handle one raw frame from the WebView's onMessage. Never throws. */
  handleFrame: (raw: unknown) => void;
  /** Push the ui/theme event (on load and on every theme/inset change). */
  pushTheme: (theme: ThemeParams) => void;
  counts: () => BridgeCounts;
  /** Cancel all pending timers; further frames are ignored. */
  dispose: () => void;
}

export const createBridgeSession = (deps: BridgeSessionDeps): BridgeSession => {
  const timeoutMs = deps.timeoutMs ?? BRIDGE_TIMEOUT_MS;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = deps.cancel ?? ((handle: unknown) => clearTimeout(handle as number));

  const counts: BridgeCounts = { malformed: 0, violations: 0 };
  /** In-flight request ids → timeout handles. Key is type-tagged so string id
   * "1" and number id 1 never collide into one entry. */
  const pending = new Map<string, unknown>();
  let disposed = false;

  const pendingKey = (id: BridgeRequestId): string =>
    typeof id === 'number' ? `n:${id}` : `s:${id}`;

  const countMalformed = () => {
    counts.malformed += 1;
    deps.onCounts?.({ ...counts });
  };
  const countViolation = () => {
    counts.violations += 1;
    deps.onCounts?.({ ...counts });
  };

  /** Exactly-one-response gate: sends only if the id is still pending. */
  const settle = (id: BridgeRequestId, frame: string) => {
    const key = pendingKey(id);
    if (!pending.has(key)) return; // already answered (e.g. late result after timeout)
    const handle = pending.get(key);
    pending.delete(key);
    cancel(handle);
    if (!disposed) deps.post(frame);
  };

  /** Immediate (non-forwarded) answer to a request — no timer involved. */
  const answer = (frame: string) => {
    if (!disposed) deps.post(frame);
  };

  const handleToolsCall = (request: BridgeRequest) => {
    const params = request.params;
    const name = params?.name;
    const args = params?.arguments;

    // Allowlist FIRST (contract): an unknown or non-allowlisted tool name is
    // -32601 and never reaches the MCP client — even before params shape.
    if (typeof name !== 'string' || !deps.allowlist.has(name)) {
      countViolation();
      answer(
        buildErrorFrame(
          request.id,
          ERROR_METHOD_NOT_FOUND,
          'tools/call target is not on this resource’s allowlist',
        ),
      );
      return;
    }
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      answer(buildErrorFrame(request.id, ERROR_INVALID_PARAMS, 'arguments must be an object'));
      return;
    }

    const key = pendingKey(request.id);
    if (pending.has(key)) {
      // A second in-flight request reusing an id would break the
      // exactly-one-response invariant; drop it as malformed.
      countMalformed();
      return;
    }
    const handle = schedule(() => {
      settle(request.id, buildErrorFrame(request.id, ERROR_TIMEOUT, 'tools/call timed out'));
    }, timeoutMs);
    pending.set(key, handle);

    deps
      .callTool(name, (args as Record<string, unknown> | undefined) ?? {})
      .then((result) => settle(request.id, buildResponseFrame(request.id, result)))
      .catch(() =>
        // Deliberately no error detail: agent-side error text stays out of the
        // WebView; nothing here can carry the token or agent internals.
        settle(request.id, buildErrorFrame(request.id, ERROR_CALL_FAILED, 'tools/call failed')),
      );
  };

  const handleFrame = (raw: unknown): void => {
    if (disposed) return;
    const frame = parseBridgeFrame(raw);

    if (frame.kind === 'malformed') {
      countMalformed(); // dropped and counted, never partially processed
      return;
    }

    switch (frame.method) {
      case 'tools/call':
        if (frame.kind === 'request') {
          handleToolsCall(frame);
        } else {
          // A tools/call with no id could never receive its response —
          // "every request carries id" — drop and count.
          countMalformed();
        }
        return;
      case 'ui/ready':
        deps.onReady?.();
        if (frame.kind === 'request') answer(buildResponseFrame(frame.id, null));
        return;
      case 'ui/close':
        deps.onClose?.();
        if (frame.kind === 'request') answer(buildResponseFrame(frame.id, null));
        return;
      default:
        // Unknown method: not on the v1 surface. Requests are answered
        // -32601 (the shell always responds); either way it counts as a
        // violation toward the fallback storm gate.
        countViolation();
        if (frame.kind === 'request') {
          answer(
            buildErrorFrame(frame.id, ERROR_METHOD_NOT_FOUND, `unknown method: ${frame.method}`),
          );
        }
    }
  };

  return {
    handleFrame,
    pushTheme: (theme: ThemeParams) => {
      if (!disposed) deps.post(buildThemeFrame(theme));
    },
    counts: () => ({ ...counts }),
    dispose: () => {
      disposed = true;
      for (const handle of pending.values()) cancel(handle);
      pending.clear();
    },
  };
};
