import type { EventEnvelope } from 'agent-app-contract/types';
import {
  createEventStream,
  type EventStream,
  parseEventEnvelope,
  type StreamFetch,
  type StreamResponseLike,
  type StreamState,
} from './events';

const envelope = (id: number, type: string, payload: Record<string, unknown>): string =>
  JSON.stringify({ schema: 1, id, type, at: '2026-07-27T00:00:00.000Z', payload });

const sseFrame = (id: number, data: string): string => `id: ${id}\ndata: ${data}\n\n`;

/** A closed SSE body made of the given text chunks. */
const bodyOf = (chunks: string[], close = true): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
  });

const okResponse = (chunks: string[], close = true): StreamResponseLike => ({
  ok: true,
  status: 200,
  body: bodyOf(chunks, close),
});

/** Resolves once `predicate` holds; fails the test after ~2s. */
const waitFor = async (predicate: () => boolean): Promise<void> => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

interface Harness {
  events: EventEnvelope[];
  states: StreamState[];
  delays: number[];
  calls: { headers: Record<string, string> }[];
  stream: EventStream;
}

const startHarness = (
  responses: Array<() => Promise<StreamResponseLike>>,
  initialLastEventId: number | null = null,
): Harness => {
  const events: EventEnvelope[] = [];
  const states: StreamState[] = [];
  const delays: number[] = [];
  const calls: { headers: Record<string, string> }[] = [];
  let call = 0;

  const fetchImpl: StreamFetch = (_url, init) => {
    calls.push({ headers: init.headers });
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return next();
  };

  const stream = createEventStream({
    baseUrl: 'http://127.0.0.1:9',
    getToken: async () => 'fake-test-token',
    onEvent: (e) => events.push(e),
    onStateChange: (s) => states.push(s),
    fetchImpl,
    initialLastEventId,
    delayImpl: async (ms) => {
      delays.push(ms);
    },
  });
  return { events, states, delays, calls, stream };
};

/** A response whose body never closes — keeps the stream "connected". */
const hangingResponse = (): Promise<StreamResponseLike> =>
  Promise.resolve({
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': open\n\n'));
      },
    }),
  });

describe('parseEventEnvelope', () => {
  it('accepts the canonical envelope shape', () => {
    const parsed = parseEventEnvelope(envelope(42, 'reply', { schema: 1, text: 'hi', files: [] }));
    expect(parsed).toMatchObject({ schema: 1, id: 42, type: 'reply' });
  });

  it.each([
    ['non-JSON', 'not json'],
    ['wrong schema', JSON.stringify({ schema: 2, id: 1, type: 'x', at: 't', payload: {} })],
    ['missing id', JSON.stringify({ schema: 1, type: 'x', at: 't', payload: {} })],
    ['negative id', JSON.stringify({ schema: 1, id: -1, type: 'x', at: 't', payload: {} })],
    ['empty type', JSON.stringify({ schema: 1, id: 1, type: '', at: 't', payload: {} })],
    ['array payload', JSON.stringify({ schema: 1, id: 1, type: 'x', at: 't', payload: [] })],
  ])('rejects %s', (_name, data) => {
    expect(parseEventEnvelope(data)).toBeNull();
  });
});

describe('event delivery', () => {
  it('delivers known event types in order and ignores unknown types without dying', async () => {
    const chunks = [
      sseFrame(1, envelope(1, 'ack', { messageId: 'm-1' })),
      sseFrame(2, envelope(2, 'shiny-new-v1.7-type', { anything: true })),
      sseFrame(3, envelope(3, 'reply', { schema: 1, text: 'hello', files: [] })),
      sseFrame(4, envelope(4, 'notice', { schema: 1, text: 'fyi', files: [] })),
    ];
    const h = startHarness([() => Promise.resolve(okResponse(chunks, false))]);

    await waitFor(() => h.events.length === 3);
    expect(h.events.map((e) => e.type)).toEqual(['ack', 'reply', 'notice']);
    // The unknown type still advanced the cursor — additive tolerance.
    expect(h.stream.getLastEventId()).toBe(4);
    h.stream.stop();
  });

  it('skips malformed payloads without killing the stream', async () => {
    const chunks = [
      'data: definitely not an envelope\n\n',
      sseFrame(5, envelope(5, 'reply', { schema: 1, text: 'still alive', files: [] })),
    ];
    const h = startHarness([() => Promise.resolve(okResponse(chunks, false))]);

    await waitFor(() => h.events.length === 1);
    expect(h.events[0]?.id).toBe(5);
    h.stream.stop();
  });

  it('handles an event split across arbitrary chunk boundaries', async () => {
    const frame = sseFrame(8, envelope(8, 'reply', { schema: 1, text: 'chunked', files: [] }));
    const chunks = [frame.slice(0, 13), frame.slice(13, 27), frame.slice(27)];
    const h = startHarness([() => Promise.resolve(okResponse(chunks, false))]);

    await waitFor(() => h.events.length === 1);
    expect((h.events[0]?.payload as { text: string }).text).toBe('chunked');
    h.stream.stop();
  });
});

describe('resume with Last-Event-ID', () => {
  it('sends no Last-Event-ID on a fresh connect', async () => {
    const h = startHarness([hangingResponse]);
    await waitFor(() => h.calls.length === 1);
    expect(h.calls[0]?.headers['Last-Event-ID']).toBeUndefined();
    expect(h.calls[0]?.headers.Authorization).toBe('Bearer fake-test-token');
    expect(h.calls[0]?.headers.Accept).toBe('text/event-stream');
    h.stream.stop();
  });

  it('reconnects with the last received event id after a drop', async () => {
    const h = startHarness([
      // First connect: two events, then the server closes the stream.
      () =>
        Promise.resolve(
          okResponse([
            sseFrame(1, envelope(1, 'ack', { messageId: 'm' })),
            sseFrame(2, envelope(2, 'reply', { schema: 1, text: 'a', files: [] })),
          ]),
        ),
      hangingResponse,
    ]);

    await waitFor(() => h.calls.length === 2);
    expect(h.calls[1]?.headers['Last-Event-ID']).toBe('2');
    h.stream.stop();
  });

  it('starts from initialLastEventId when resuming an in-session stream', async () => {
    const h = startHarness([hangingResponse], 41);
    await waitFor(() => h.calls.length === 1);
    expect(h.calls[0]?.headers['Last-Event-ID']).toBe('41');
    h.stream.stop();
  });
});

describe('backoff and state signal', () => {
  it('backs off 1s, 2s, 4s ... capped at 30s across consecutive failures', async () => {
    const h = startHarness([
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
      hangingResponse,
    ]);

    await waitFor(() => h.delays.length === 7);
    expect(h.delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    h.stream.stop();
  });

  it('resets the backoff ladder after a successful event', async () => {
    const h = startHarness([
      () => Promise.reject(new Error('down')),
      () => Promise.reject(new Error('down')),
      // Third connect succeeds and delivers an event, then closes → reconnect.
      () => Promise.resolve(okResponse([sseFrame(1, envelope(1, 'ack', { messageId: 'm' }))])),
      () => Promise.reject(new Error('down')),
      hangingResponse,
    ]);

    await waitFor(() => h.delays.length === 4);
    // 1s, 2s (failures); the good event resets the ladder, so the stream-end
    // reconnect waits 1s again and the NEXT failure restarts at 2s (not 8s).
    expect(h.delays).toEqual([1_000, 2_000, 1_000, 2_000]);
    h.stream.stop();
  });

  it('signals reconnecting → connected → reconnecting → offline on stop', async () => {
    const h = startHarness([() => Promise.reject(new Error('down')), hangingResponse]);

    await waitFor(() => h.states.includes('connected'));
    h.stream.stop();
    await waitFor(() => h.states[h.states.length - 1] === 'offline');
    expect(h.states[0]).toBe('reconnecting');
    expect(h.states).toContain('connected');
  });

  it('gives up (offline) on 401 instead of hammering a bad token', async () => {
    const h = startHarness([() => Promise.resolve({ ok: false, status: 401, body: null })]);

    await waitFor(() => h.states[h.states.length - 1] === 'offline');
    expect(h.calls.length).toBe(1);
    expect(h.delays).toEqual([]);
  });
});
