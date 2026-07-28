/**
 * SSE event-stream client for GET /app/v1/events (contracts/app-ingress.md).
 *
 * React Native has no native EventSource, so this drives a streaming fetch
 * (production wires `expo/fetch`, whose response body is a ReadableStream;
 * tests wire Node's global fetch) through the pure SSE parser in sse-parser.ts.
 *
 * Behavior:
 * - Auth: bearer token fetched via `getToken()` at CONNECT time, per attempt —
 *   never cached here, never logged, never part of emitted state.
 * - Resume: tracks the last received event id (the envelope `id` IS the SSE
 *   `id:` field and the outbox cursor — contract invariant 2) and reconnects
 *   with a `Last-Event-ID` header; the server resumes strictly after it.
 * - Reconnect: capped exponential backoff (backoff.ts), attempt counter reset
 *   whenever a valid event arrives. Keeps trying until stop() — foreground
 *   gating is the caller's job (the hook stops the stream in background).
 * - Fatal auth (401/403): gives up and reports 'offline' — retrying with the
 *   same bad token would loop forever; a connection change restarts it.
 * - Envelope tolerance: each SSE data payload must parse as the v1
 *   EventEnvelope shape; known types (ack | reply | notice) are delivered,
 *   UNKNOWN types are ignored WITHOUT killing the stream (additive contract),
 *   and malformed payloads are skipped.
 */

import type { EventEnvelope } from 'agent-app-contract/types';
import { backoffDelayMs } from './backoff';
import { createSseParser } from './sse-parser';

export type StreamState = 'connected' | 'reconnecting' | 'offline';

/** v1 event types this client understands. NOT exhaustive by contract design. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(['ack', 'reply', 'notice']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Structural check for the EventEnvelope wire shape; null on any mismatch. */
export const parseEventEnvelope = (data: string): EventEnvelope | null => {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.schema !== 1) return null;
  if (typeof value.id !== 'number' || !Number.isInteger(value.id) || value.id < 0) return null;
  if (typeof value.type !== 'string' || value.type.length === 0) return null;
  if (typeof value.at !== 'string') return null;
  if (!isRecord(value.payload)) return null;
  return value as unknown as EventEnvelope;
};

/** The slice of a fetch response the stream client needs (expo/fetch and
 * Node's fetch both satisfy it structurally). */
export interface StreamResponseLike {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}

export type StreamFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal },
) => Promise<StreamResponseLike>;

export interface EventStreamOptions {
  /** e.g. "http://100.64.0.7:8787" — no trailing slash required. */
  baseUrl: string;
  /** Token accessor, called per connect attempt (ActiveConnection.getToken). */
  getToken: () => Promise<string | null>;
  /** Delivered for every valid envelope with a KNOWN type, in stream order. */
  onEvent: (envelope: EventEnvelope) => void;
  onStateChange?: (state: StreamState) => void;
  /** Streaming fetch. Production: expo/fetch. Tests: Node's global fetch. */
  fetchImpl: StreamFetch;
  /** Resume cursor from a previous stream in this session, if any. */
  initialLastEventId?: number | null;
  /** Injectable for tests. Default: cancellable setTimeout sleep. */
  delayImpl?: (ms: number) => Promise<void>;
}

export interface EventStream {
  /** Aborts the connection and stops reconnecting. Idempotent. */
  stop(): void;
  /** Cursor to hand to the next stream (in-session resume). */
  getLastEventId(): number | null;
}

export const createEventStream = (options: EventStreamOptions): EventStream => {
  const url = `${options.baseUrl.replace(/\/+$/, '')}/app/v1/events`;
  let stopped = false;
  let lastEventId: number | null = options.initialLastEventId ?? null;
  let attempt = 0;
  let state: StreamState | null = null;
  let controller: AbortController | null = null;
  let wakeUp: (() => void) | null = null;
  let cancelActiveReader: (() => void) | null = null;

  const setState = (next: StreamState): void => {
    if (state !== next) {
      state = next;
      options.onStateChange?.(next);
    }
  };

  const sleep = (ms: number): Promise<void> =>
    options.delayImpl
      ? options.delayImpl(ms)
      : new Promise((resolve) => {
          const timer = setTimeout(() => {
            wakeUp = null;
            resolve();
          }, ms);
          // stop() resolves the sleep immediately so shutdown is prompt even
          // mid-backoff (the loop re-checks `stopped` right after).
          wakeUp = () => {
            clearTimeout(timer);
            wakeUp = null;
            resolve();
          };
        });

  const connectOnce = async (): Promise<void> => {
    const token = await options.getToken();
    if (token === null) {
      // No credentials — treat like fatal auth; a connection change restarts.
      throw new FatalStreamError('token missing from vault');
    }

    controller = new AbortController();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    };
    if (lastEventId !== null) headers['Last-Event-ID'] = String(lastEventId);

    const response = await options.fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new FatalStreamError(`events stream refused with HTTP ${response.status}`);
    }
    if (!response.ok || response.body === null) {
      throw new Error(`events stream returned HTTP ${response.status}`);
    }

    setState('connected');
    const parser = createSseParser();
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    // stop() must end a pending read() even if the injected fetch does not
    // honor the abort signal; cancel() resolves the read as done.
    cancelActiveReader = () => {
      reader.cancel().catch(() => {});
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        for (const sse of parser.feed(decoder.decode(value, { stream: true }))) {
          const envelope = parseEventEnvelope(sse.data);
          if (envelope === null) continue; // malformed payload: skip, keep stream
          attempt = 0; // a valid event proves the link — reset the backoff ladder
          lastEventId = envelope.id; // envelope id IS the cursor (invariant 2)
          if (KNOWN_EVENT_TYPES.has(envelope.type)) options.onEvent(envelope);
        }
      }
    } finally {
      cancelActiveReader = null;
      reader.releaseLock();
    }
    if (!stopped) {
      // Server closed an accepted stream — reconnect through the normal path.
      throw new Error('events stream ended');
    }
  };

  const run = async (): Promise<void> => {
    while (!stopped) {
      try {
        if (state !== 'connected') setState('reconnecting');
        await connectOnce();
      } catch (err) {
        if (stopped) break;
        if (err instanceof FatalStreamError) {
          setState('offline');
          return;
        }
        setState('reconnecting');
        const delay = backoffDelayMs(attempt);
        attempt += 1;
        await sleep(delay);
      }
    }
    setState('offline');
  };

  void run();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      controller?.abort();
      cancelActiveReader?.();
      wakeUp?.();
    },
    getLastEventId: () => lastEventId,
  };
};

/** Internal marker: errors that must NOT be retried (auth / missing token). */
class FatalStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalStreamError';
  }
}
