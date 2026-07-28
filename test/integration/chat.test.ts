/**
 * Integration (stage 4): the chat round-trip against the REAL mock agent from
 * agent-app-contract@v1.0.0, over real HTTP with Node's streaming fetch.
 *
 * Certifies the walking-skeleton slice: POST /messages → 202; `ack` + `reply`
 * arrive over SSE and land in the transcript store in order; a dropped stream
 * resumes with Last-Event-ID without duplication (contract invariant 2).
 */
import { randomUUID } from 'node:crypto';

import type { EventEnvelope } from 'agent-app-contract/types';
import { postMessage } from '../../src/api/client';
import { createEventStream, type EventStream, type StreamState } from '../../src/api/events';
import { buildInboundMessage } from '../../src/chat/inbound';
import { OWNER_PERSON_ID } from '../../src/chat/person-id';
import {
  emptyTranscript,
  type TranscriptState,
  transcriptReducer,
} from '../../src/chat/transcript';
import { type MockAgent, startMockAgent } from './mock-agent-harness';

const TOKEN = 'integration-test-token';
const deps = { newUuid: () => randomUUID() };

let agent: MockAgent;
const openCollectors: Collector[] = [];

// A FRESH mock per test: the mock replays its whole outbox to a new stream
// (a fresh connect is cursor 0), so a shared agent would leak events from
// earlier tests into later collectors.
beforeEach(async () => {
  // The app pins personId to the canonical owner id (src/chat/person-id.ts);
  // the mock is configured to match, exactly as a real operator would.
  agent = await startMockAgent(TOKEN, { ownerId: OWNER_PERSON_ID });
});

afterEach(async () => {
  // Stop streams FIRST (even ones a failed assertion left behind): an open
  // SSE socket blocks the mock's graceful shutdown.
  for (const collector of openCollectors.splice(0)) collector.stream.stop();
  await agent?.stop();
});

const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

interface Collector {
  events: EventEnvelope[];
  states: StreamState[];
  stream: EventStream;
}

/** Open a stream against the mock using Node's global fetch (streams fine).
 *
 * NOTE: the mock only flushes the SSE response headers with the first frame
 * it writes, so against an EMPTY outbox the connect stays pending (state
 * 'reconnecting') until an event exists — tests must not gate on 'connected'
 * before the first POST. The contract blesses this: clients MUST NOT infer
 * liveness from the absence of keep-alive pings (explicitly-unspecified #4). */
const openStream = (initialLastEventId: number | null = null): Collector => {
  const events: EventEnvelope[] = [];
  const states: StreamState[] = [];
  const stream = createEventStream({
    baseUrl: agent.baseUrl,
    getToken: async () => TOKEN,
    onEvent: (e) => events.push(e),
    onStateChange: (s) => states.push(s),
    fetchImpl: fetch,
    initialLastEventId,
  });
  const collector = { events, states, stream };
  openCollectors.push(collector);
  return collector;
};

it('POST /messages returns 202 { ok, messageId } — and never the reply', async () => {
  const message = buildInboundMessage({ text: 'ping', personId: OWNER_PERSON_ID }, deps);

  const result = await postMessage({ baseUrl: agent.baseUrl, token: TOKEN }, message);

  expect(result).toEqual({ ok: true, messageId: message.messageId });
});

it('a personId that is not the configured owner is refused with 403', async () => {
  const message = buildInboundMessage({ text: 'ping', personId: 'someone-else' }, deps);

  await expect(
    postMessage({ baseUrl: agent.baseUrl, token: TOKEN }, message),
  ).rejects.toMatchObject({ kind: 'http', status: 403 });
});

it('round-trip: send → 202 → ack + reply arrive over SSE → transcript holds them in order', async () => {
  const collector = openStream();

  const message = buildInboundMessage({ text: 'ping', personId: OWNER_PERSON_ID }, deps);
  let transcript: TranscriptState = transcriptReducer(emptyTranscript, {
    type: 'send',
    messageId: message.messageId,
    text: message.text,
    at: message.receivedAt,
  });

  await postMessage({ baseUrl: agent.baseUrl, token: TOKEN }, message);
  transcript = transcriptReducer(transcript, {
    type: 'send-accepted',
    messageId: message.messageId,
  });

  await waitFor(
    () =>
      collector.events.some((e) => e.type === 'ack' && e.payload.messageId === message.messageId) &&
      collector.events.some((e) => e.type === 'reply'),
    'ack + reply over SSE',
  );
  // The stream proved itself with data — the state signal must agree.
  expect(collector.states).toContain('connected');
  collector.stream.stop();

  for (const envelope of collector.events) {
    transcript = transcriptReducer(transcript, { type: 'event', envelope });
  }

  const kinds = transcript.items.map((i) => i.kind);
  expect(kinds).toEqual(['user', 'agent']);
  expect(transcript.items[0]).toMatchObject({
    messageId: message.messageId,
    sendState: 'accepted',
  });
  // The mock echoes: "mock-agent received: <text>" — read from its server.ts.
  expect(transcript.items[1]).toMatchObject({
    eventType: 'reply',
    text: `mock-agent received: ${message.text}`,
  });
});

it('re-POSTing the same messageId is a 202 no-op that emits no additional events', async () => {
  const collector = openStream();

  const message = buildInboundMessage({ text: 'retry me', personId: OWNER_PERSON_ID }, deps);
  await postMessage({ baseUrl: agent.baseUrl, token: TOKEN }, message);
  await waitFor(
    () => collector.events.filter((e) => e.type === 'reply').length >= 1,
    'first reply',
  );
  const seenBefore = collector.events.length;

  // Same dedup key again — the retry path after a lost 202.
  const again = await postMessage({ baseUrl: agent.baseUrl, token: TOKEN }, message);
  expect(again).toEqual({ ok: true, messageId: message.messageId });

  // Give the mock a beat: any wrongly re-emitted events would arrive now.
  await new Promise((r) => setTimeout(r, 300));
  expect(collector.events.length).toBe(seenBefore);
  collector.stream.stop();
});

it('Last-Event-ID resume: reconnect after a drop yields no duplicates and later events arrive', async () => {
  // Phase 1: connect, complete one exchange, then drop the stream.
  const first = openStream();

  const message1 = buildInboundMessage(
    { text: 'before the drop', personId: OWNER_PERSON_ID },
    deps,
  );
  await postMessage({ baseUrl: agent.baseUrl, token: TOKEN }, message1);
  await waitFor(
    () =>
      first.events.some((e) => e.type === 'ack' && e.payload.messageId === message1.messageId) &&
      first.events.some(
        (e) =>
          e.type === 'reply' &&
          (e.payload as { text?: string }).text === `mock-agent received: ${message1.text}`,
      ),
    'first exchange',
  );
  first.stream.stop();
  const cursor = first.stream.getLastEventId();
  expect(cursor).not.toBeNull();

  // Phase 2: while disconnected, another message produces events we missed.
  const message2 = buildInboundMessage(
    { text: 'while disconnected', personId: OWNER_PERSON_ID },
    deps,
  );
  await postMessage({ baseUrl: agent.baseUrl, token: TOKEN }, message2);

  // Phase 3: reconnect with the cursor — the contract resumes STRICTLY after it.
  const second = openStream(cursor);
  await waitFor(
    () =>
      second.events.some((e) => e.type === 'ack' && e.payload.messageId === message2.messageId) &&
      second.events.some(
        (e) =>
          e.type === 'reply' &&
          (e.payload as { text?: string }).text === `mock-agent received: ${message2.text}`,
      ),
    'missed events after resume',
  );
  second.stream.stop();

  // No overlap: every resumed event id is strictly greater than the cursor.
  const resumedIds = second.events.map((e) => e.id);
  expect(Math.min(...resumedIds)).toBeGreaterThan(cursor as number);

  // And a transcript fed both phases holds each event exactly once.
  let transcript = emptyTranscript;
  for (const envelope of [...first.events, ...second.events]) {
    transcript = transcriptReducer(transcript, { type: 'event', envelope });
  }
  const agentEventIds = transcript.items.flatMap((i) => (i.kind === 'agent' ? [i.eventId] : []));
  expect(new Set(agentEventIds).size).toBe(agentEventIds.length);
  expect(agentEventIds.length).toBe(
    [...first.events, ...second.events].filter((e) => e.type === 'reply').length,
  );
});
