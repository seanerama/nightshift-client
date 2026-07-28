/**
 * Integration (stage 9): transcript durability against the REAL mock agent
 * from agent-app-contract@v1.0.0, over real HTTP.
 *
 * Certifies the stage's three durability claims end to end:
 * 1. events that accrue agent-side while NO stream is attached are recovered
 *    by /outbox catch-up and the transcript CONVERGES with a run that never
 *    disconnected;
 * 2. a simulated app restart (new store over the same backing — the sqlite
 *    file survives, the process does not) restores history + cursor, and the
 *    stream resumes from the persisted cursor without duplicates;
 * 3. messages composed while the agent is unreachable queue durably (surviving
 *    a restart) and drain EXACTLY once when the link returns, re-POSTing the
 *    ORIGINAL messageId — the contract dedup key.
 *
 * The production wiring in miniature (pure reducer + durable write-through
 * subscriber) stands in for the React hook — jest's node environment cannot
 * render it; the modules composed here are exactly what the hook composes.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

import type { EventEnvelope } from 'agent-app-contract/types';
import { getOutbox, postMessage } from '../../src/api/client';
import { createEventStream, type EventStream } from '../../src/api/events';
import { runCatchUp } from '../../src/chat/catch-up';
import { createDurableChat, type DurableChat } from '../../src/chat/durable-chat';
import { buildInboundMessage } from '../../src/chat/inbound';
import {
  type ChatStoreBacking,
  createChatStoreBacking,
  MemoryChatStore,
} from '../../src/chat/memory';
import { OWNER_PERSON_ID } from '../../src/chat/person-id';
import {
  emptyTranscript,
  type TranscriptAction,
  type TranscriptState,
  transcriptReducer,
} from '../../src/chat/transcript';
import { type MockAgent, startMockAgent } from './mock-agent-harness';

const TOKEN = 'integration-test-token';
const CID = 'conn-durability';
const deps = { newUuid: () => randomUUID() };

let agent: MockAgent;
const openStreams: EventStream[] = [];

beforeEach(async () => {
  agent = await startMockAgent(TOKEN, { ownerId: OWNER_PERSON_ID });
});

afterEach(async () => {
  // Stop streams FIRST: an open SSE socket blocks the mock's graceful stop.
  for (const stream of openStreams.splice(0)) stream.stop();
  await agent?.stop();
});

const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** A 127.0.0.1 port with nothing listening — "the agent is unreachable". */
const unreachableBaseUrl = async (): Promise<string> => {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not allocate a port'));
        return;
      }
      const freed = address.port;
      server.close(() => resolve(freed));
    });
  });
  return `http://127.0.0.1:${port}`;
};

/** The hook's reducer+subscriber wiring, minus React. */
const makeSession = (durable: DurableChat, initial: TranscriptState = emptyTranscript) => {
  let state = initial;
  return {
    apply(action: TranscriptAction) {
      const prev = state;
      state = transcriptReducer(prev, action);
      durable.handle(action, prev, state);
    },
    get state() {
      return state;
    },
  };
};

const makeDurable = (backing: ChatStoreBacking): DurableChat =>
  createDurableChat({
    enabled: true,
    connectionId: CID,
    storeFactory: async () => new MemoryChatStore(backing),
  });

const openStream = (
  onEvent: (envelope: EventEnvelope) => void,
  initialLastEventId: number | null = null,
): EventStream => {
  const stream = createEventStream({
    baseUrl: agent.baseUrl,
    getToken: async () => TOKEN,
    onEvent,
    fetchImpl: fetch,
    initialLastEventId,
  });
  openStreams.push(stream);
  return stream;
};

const agentEventIds = (state: TranscriptState): number[] =>
  state.items.flatMap((item) => (item.kind === 'agent' ? [item.eventId] : []));

it('stream-down accrual: catch-up recovers the missed events in order and converges with a never-disconnected run', async () => {
  const conn = { baseUrl: agent.baseUrl, token: TOKEN };

  // CONTROL: a stream attached the whole time — the never-disconnected run.
  const controlEvents: EventEnvelope[] = [];
  openStream((e) => controlEvents.push(e));

  // DISCONNECTED run: compose with NO stream attached; the replies accrue in
  // the agent's durable outbox with nobody listening.
  const backing = createChatStoreBacking();
  const durable = makeDurable(backing);
  const session = makeSession(durable);
  const m1 = buildInboundMessage({ text: 'first while down', personId: OWNER_PERSON_ID }, deps);
  const m2 = buildInboundMessage({ text: 'second while down', personId: OWNER_PERSON_ID }, deps);
  for (const message of [m1, m2]) {
    session.apply({
      type: 'send',
      messageId: message.messageId,
      text: message.text,
      at: message.receivedAt,
    });
    await postMessage(conn, message);
    session.apply({ type: 'send-accepted', messageId: message.messageId });
  }
  await waitFor(
    () => controlEvents.filter((e) => e.type === 'reply').length >= 2,
    'both replies to reach the control stream',
  );

  // Catch-up: page /outbox from the beginning, through the SAME reducer path.
  const caughtUp: EventEnvelope[] = [];
  const cursor = await runCatchUp({
    after: null,
    fetchPage: (after) => getOutbox(conn, after),
    apply: (envelope) => {
      caughtUp.push(envelope);
      session.apply({ type: 'event', envelope });
    },
  });
  durable.saveCursor(cursor);
  await durable.flush();

  // Catch-up saw EXACTLY what the never-disconnected stream saw, in order.
  expect(caughtUp.map((e) => [e.id, e.type])).toEqual(controlEvents.map((e) => [e.id, e.type]));

  // And the transcript converges with the control transcript built from the
  // live stream: same send prefix, then each run's own event feed.
  const controlDurable = createDurableChat({
    enabled: false, // control run measures the reducer only
    connectionId: 'conn-control',
    storeFactory: async () => new MemoryChatStore(),
  });
  const control = makeSession(controlDurable);
  for (const message of [m1, m2]) {
    control.apply({
      type: 'send',
      messageId: message.messageId,
      text: message.text,
      at: message.receivedAt,
    });
    control.apply({ type: 'send-accepted', messageId: message.messageId });
  }
  for (const envelope of controlEvents) control.apply({ type: 'event', envelope });

  expect(session.state.items).toEqual(control.state.items);
  expect([...session.state.seenEventIds].sort()).toEqual([...control.state.seenEventIds].sort());

  // The final cursor is the last event id — persisted for the next session.
  expect(cursor).toBe(controlEvents[controlEvents.length - 1].id);
  expect(await new MemoryChatStore(backing).getLastEventId(CID)).toBe(cursor);

  // Replaying catch-up from the OLD cursor is a no-op (dedup absorbs it).
  const before = session.state;
  await runCatchUp({
    after: null,
    fetchPage: (after) => getOutbox(conn, after),
    apply: (envelope) => session.apply({ type: 'event', envelope }),
  });
  expect(session.state).toBe(before);
}, 20000);

it('simulated restart: history and cursor survive, the stream resumes from the persisted cursor with no duplicates', async () => {
  const conn = { baseUrl: agent.baseUrl, token: TOKEN };
  const backing = createChatStoreBacking();

  // --- Life 1: a normal live session, persisted write-through.
  const durable1 = makeDurable(backing);
  const session1 = makeSession(durable1);
  const stream1 = openStream((envelope) => session1.apply({ type: 'event', envelope }));

  const m1 = buildInboundMessage({ text: 'before the restart', personId: OWNER_PERSON_ID }, deps);
  session1.apply({ type: 'send', messageId: m1.messageId, text: m1.text, at: m1.receivedAt });
  await postMessage(conn, m1);
  session1.apply({ type: 'send-accepted', messageId: m1.messageId });
  await waitFor(
    () => session1.state.items.some((i) => i.kind === 'agent' && i.eventType === 'reply'),
    'the first reply to land in the live transcript',
  );
  stream1.stop();
  const cursorAtDeath = stream1.getLastEventId();
  expect(cursorAtDeath).not.toBeNull();
  durable1.saveCursor(cursorAtDeath);
  await durable1.flush();
  // The process "dies" here: durable1/session1 are never touched again.

  // --- While dead: the agent produces events nobody hears. Wait until the
  // reply actually sits in the agent's outbox (it is emitted off-path).
  const m2 = buildInboundMessage(
    { text: 'while the app was dead', personId: OWNER_PERSON_ID },
    deps,
  );
  await postMessage(conn, m2);
  {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const page = await getOutbox(conn, cursorAtDeath);
      if (page.events.some((e) => e.type === 'reply')) break;
      if (Date.now() > deadline) throw new Error('reply never reached the outbox');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  // --- Life 2: a NEW store over the SAME backing (same sqlite file).
  const durable2 = makeDurable(backing);
  const hydrated = await durable2.hydrate();
  expect(hydrated).not.toBeNull();
  if (hydrated === null) throw new Error('unreachable');

  // History survived: the pre-restart items are all there, states intact.
  expect(hydrated.state.items).toEqual(session1.state.items);
  // The cursor survived and seeds the resume.
  expect(hydrated.lastEventId).toBe(cursorAtDeath);
  // seenEventIds reconstructed from the hydrated AGENT rows — the ids that
  // can duplicate visible items. (Ack ids need no reconstruction: they sit
  // at or below the persisted cursor, and resume is strictly after it.)
  expect([...hydrated.state.seenEventIds].sort((a, b) => a - b)).toEqual(
    agentEventIds(session1.state).sort((a, b) => a - b),
  );

  const session2 = makeSession(durable2, hydrated.state);
  // Catch-up from the persisted cursor first (session start), then resume the
  // stream from the same cursor — the overlap is dedup-safe by construction.
  const caught: EventEnvelope[] = [];
  const cursor = await runCatchUp({
    after: hydrated.lastEventId,
    fetchPage: (after) => getOutbox(conn, after),
    apply: (envelope) => {
      caught.push(envelope);
      session2.apply({ type: 'event', envelope });
    },
  });
  durable2.saveCursor(cursor);

  // Everything recovered is strictly newer than the persisted cursor.
  expect(caught.length).toBeGreaterThan(0);
  expect(Math.min(...caught.map((e) => e.id))).toBeGreaterThan(cursorAtDeath as number);

  const stream2 = openStream((envelope) => session2.apply({ type: 'event', envelope }), cursor);
  const m3 = buildInboundMessage({ text: 'after the restart', personId: OWNER_PERSON_ID }, deps);
  session2.apply({ type: 'send', messageId: m3.messageId, text: m3.text, at: m3.receivedAt });
  await postMessage(conn, m3);
  session2.apply({ type: 'send-accepted', messageId: m3.messageId });
  await waitFor(
    () =>
      session2.state.items.some(
        (i) => i.kind === 'agent' && i.text === `mock-agent received: ${m3.text}`,
      ),
    'the post-restart reply',
  );
  stream2.stop();
  await durable2.flush();

  // No duplicates anywhere across death and resurrection: every agent event
  // exactly once, in ascending outbox order.
  const ids = agentEventIds(session2.state);
  expect(new Set(ids).size).toBe(ids.length);
  expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  // All three exchanges present: replies for m1 (pre-restart), m2 (recovered
  // by catch-up), m3 (live after resume).
  const texts = session2.state.items.flatMap((i) => (i.kind === 'agent' ? [i.text] : []));
  for (const m of [m1, m2, m3]) {
    expect(texts).toContain(`mock-agent received: ${m.text}`);
  }
}, 20000);

it('offline queue: unreachable sends queue durably, survive a restart, and drain exactly once on reconnect', async () => {
  const conn = { baseUrl: agent.baseUrl, token: TOKEN };
  const backing = createChatStoreBacking();
  const durable1 = makeDurable(backing);
  const session1 = makeSession(durable1);

  // --- Compose two messages while the agent is unreachable (dead port).
  const deadBaseUrl = await unreachableBaseUrl();
  // Distinct queuedAt stamps: drain order is ascending queuedAt by contract
  // of the store, and two composes in the same millisecond must not flake.
  const q1 = buildInboundMessage(
    { text: 'queued one', personId: OWNER_PERSON_ID },
    { ...deps, now: () => new Date('2026-07-27T00:00:01.000Z') },
  );
  const q2 = buildInboundMessage(
    { text: 'queued two', personId: OWNER_PERSON_ID },
    { ...deps, now: () => new Date('2026-07-27T00:00:02.000Z') },
  );
  for (const message of [q1, q2]) {
    session1.apply({
      type: 'send',
      messageId: message.messageId,
      text: message.text,
      at: message.receivedAt,
    });
    await expect(
      postMessage({ baseUrl: deadBaseUrl, token: TOKEN }, message),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(
      await durable1.enqueue({
        messageId: message.messageId,
        text: message.text,
        attachments: [],
        queuedAt: message.receivedAt,
      }),
    ).toBe(true);
    session1.apply({ type: 'send-queued', messageId: message.messageId });
  }
  await durable1.flush();
  expect(session1.state.items).toMatchObject([{ sendState: 'queued' }, { sendState: 'queued' }]);

  // --- Kill the app while messages are queued; reopen (same backing).
  const durable2 = makeDurable(backing);
  const hydrated = await durable2.hydrate();
  if (hydrated === null) throw new Error('unreachable');
  expect(hydrated.state.items).toMatchObject([
    { messageId: q1.messageId, sendState: 'queued' },
    { messageId: q2.messageId, sendState: 'queued' },
  ]);

  // --- The link returns: drain against the REAL agent, watching its events.
  const received: EventEnvelope[] = [];
  openStream((e) => received.push(e));
  const session2 = makeSession(durable2, hydrated.state);
  const posted: string[] = [];
  const result = await durable2.drain({
    personId: OWNER_PERSON_ID,
    newUuid: () => randomUUID(),
    post: async (message) => {
      posted.push(message.messageId);
      return postMessage(conn, message);
    },
    onSending: (row) =>
      session2.apply({ type: 'send', messageId: row.messageId, text: row.text, at: row.queuedAt }),
    onAccepted: (messageId) => session2.apply({ type: 'send-accepted', messageId }),
    onFailed: (messageId) => session2.apply({ type: 'send-failed', messageId }),
  });

  // Drained in queued_at order with the ORIGINAL messageIds.
  expect(posted).toEqual([q1.messageId, q2.messageId]);
  expect(result).toMatchObject({
    accepted: [q1.messageId, q2.messageId],
    failed: [],
    stoppedUnreachable: false,
  });
  expect(session2.state.items).toMatchObject([
    { sendState: 'accepted' },
    { sendState: 'accepted' },
  ]);
  expect(await new MemoryChatStore(backing).listQueue(CID)).toHaveLength(0);

  // Exactly once agent-side: one ack + one reply per message, no more.
  await waitFor(
    () => received.filter((e) => e.type === 'reply').length >= 2,
    'both drained replies',
  );
  const acks = received.filter((e) => e.type === 'ack').map((e) => e.payload.messageId);
  expect(acks.sort()).toEqual([q1.messageId, q2.messageId].sort());

  // A second drain is a no-op — nothing left to POST, no new events.
  const again = await durable2.drain({
    personId: OWNER_PERSON_ID,
    newUuid: () => randomUUID(),
    post: async (message) => {
      posted.push(message.messageId);
      return postMessage(conn, message);
    },
  });
  expect(again).toMatchObject({ accepted: [], failed: [] });
  expect(posted).toHaveLength(2);
  await new Promise((r) => setTimeout(r, 300));
  expect(received.filter((e) => e.type === 'reply')).toHaveLength(2);
  expect(received.filter((e) => e.type === 'ack')).toHaveLength(2);
}, 20000);
