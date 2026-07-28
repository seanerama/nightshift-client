/**
 * Unit: the durable-chat facade — write-through subscriber (every reducer
 * transition lands as the right upsert), cursor persistence, replay no-ops,
 * the flag-OFF contract (NO store calls, spy-verified), and the stage-3
 * invariant that no token material is ever serialized into a row.
 */

import type { EventEnvelope } from 'agent-app-contract/types';
import type { ChatStore } from './chat-store';
import { createDurableChat, type DurableChat } from './durable-chat';
import { type ChatStoreBacking, createChatStoreBacking, MemoryChatStore } from './memory';
import {
  emptyTranscript,
  type TranscriptAction,
  type TranscriptState,
  transcriptReducer,
} from './transcript';

const CID = 'conn-1';

const envelope = (id: number, type: string, payload: Record<string, unknown>): EventEnvelope => ({
  schema: 1,
  id,
  type,
  at: '2026-07-27T00:00:00.000Z',
  payload,
});

/** The production wiring in miniature: pure reducer + subscriber. */
const makeSession = (durable: DurableChat) => {
  let state: TranscriptState = emptyTranscript;
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

const makeDurable = (backing: ChatStoreBacking) =>
  createDurableChat({
    enabled: true,
    connectionId: CID,
    storeFactory: async () => new MemoryChatStore(backing),
  });

describe('write-through subscriber', () => {
  it('mirrors the full send lifecycle into user-row upserts', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'hello', at: 't0' });
    await durable.flush();
    expect(await store.loadTranscript(CID)).toMatchObject([
      { kind: 'user', messageId: 'm-1', sendState: 'sending', text: 'hello' },
    ]);

    session.apply({ type: 'send-accepted', messageId: 'm-1' });
    await durable.flush();
    expect(await store.loadTranscript(CID)).toMatchObject([{ sendState: 'accepted' }]);
  });

  it('persists failed and queued transitions', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'a', at: 't0' });
    session.apply({ type: 'send-failed', messageId: 'm-1' });
    session.apply({ type: 'send', messageId: 'm-2', text: 'b', at: 't1' });
    session.apply({ type: 'send-queued', messageId: 'm-2' });
    await durable.flush();

    expect(await store.loadTranscript(CID)).toMatchObject([
      { messageId: 'm-1', sendState: 'failed' },
      { messageId: 'm-2', sendState: 'queued' },
    ]);
  });

  it('appends reply/notice events as agent rows and advances the cursor', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);

    session.apply({
      type: 'event',
      envelope: envelope(4, 'reply', { schema: 1, text: 'the reply', files: ['up_1'] }),
    });
    session.apply({
      type: 'event',
      envelope: envelope(5, 'notice', { schema: 1, text: 'heads up', files: [] }),
    });
    await durable.flush();

    expect(await store.loadTranscript(CID)).toMatchObject([
      { kind: 'agent', eventId: 4, eventType: 'reply', files: ['up_1'] },
      { kind: 'agent', eventId: 5, eventType: 'notice' },
    ]);
    expect(await store.getLastEventId(CID)).toBe(5);
  });

  it('an ack upserts the accepted user row, dequeues it, and advances the cursor', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'x', at: 't0' });
    session.apply({ type: 'send-queued', messageId: 'm-1' });
    await durable.enqueue({ messageId: 'm-1', text: 'x', attachments: [], queuedAt: 't0' });

    session.apply({ type: 'event', envelope: envelope(9, 'ack', { messageId: 'm-1' }) });
    await durable.flush();

    expect(await store.loadTranscript(CID)).toMatchObject([{ sendState: 'accepted' }]);
    expect(await store.listQueue(CID)).toHaveLength(0);
    expect(await store.getLastEventId(CID)).toBe(9);
  });

  it('send-accepted also clears any queue row (202 finally landed for a queued send)', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'x', at: 't0' });
    await durable.enqueue({ messageId: 'm-1', text: 'x', attachments: [], queuedAt: 't0' });
    session.apply({ type: 'send-queued', messageId: 'm-1' });
    session.apply({ type: 'send-accepted', messageId: 'm-1' });
    await durable.flush();

    expect(await store.listQueue(CID)).toHaveLength(0);
  });

  it('replaying an already-applied event writes NOTHING (reducer no-op → store no-op)', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);
    const reply = envelope(4, 'reply', { schema: 1, text: 'once', files: [] });

    session.apply({ type: 'event', envelope: reply });
    await durable.flush();
    const before = JSON.stringify(backing);

    session.apply({ type: 'event', envelope: reply }); // resume-overlap replay
    await durable.flush();

    expect(JSON.stringify(backing)).toBe(before);
    expect(await store.loadTranscript(CID)).toHaveLength(1);
  });

  it('unknown event types advance the cursor but add no rows (additive tolerance)', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);

    session.apply({ type: 'event', envelope: envelope(11, 'stream-chunk', { t: 'x' }) });
    await durable.flush();

    expect(await store.loadTranscript(CID)).toHaveLength(0);
    expect(await store.getLastEventId(CID)).toBe(11);
  });

  it('reset does NOT wipe rows — the durable transcript outlives the in-memory session', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'keep me', at: 't0' });
    session.apply({ type: 'reset' });
    await durable.flush();

    expect(await store.loadTranscript(CID)).toHaveLength(1);
  });

  it('saveCursor only ever advances (a stale cursor cannot regress the resume point)', async () => {
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const store = new MemoryChatStore(backing);

    durable.saveCursor(10);
    durable.saveCursor(7); // stale — e.g. an overlap replay path
    durable.saveCursor(null);
    await durable.flush();
    expect(await store.getLastEventId(CID)).toBe(10);

    durable.saveCursor(12);
    await durable.flush();
    expect(await store.getLastEventId(CID)).toBe(12);
  });
});

describe('hydrate', () => {
  it('returns history, queue-aware send states, and the persisted cursor', async () => {
    const backing = createChatStoreBacking();
    const seedStore = new MemoryChatStore(backing);
    await seedStore.upsertUserItem({
      connectionId: CID,
      kind: 'user',
      messageId: 'm-1',
      eventId: null,
      eventType: null,
      text: 'queued offline',
      files: [],
      sendState: 'queued',
      at: 't0',
    });
    await seedStore.enqueue({
      messageId: 'm-1',
      connectionId: CID,
      text: 'queued offline',
      attachments: [],
      queuedAt: 't0',
    });
    await seedStore.appendAgentItem({
      connectionId: CID,
      kind: 'agent',
      messageId: null,
      eventId: 3,
      eventType: 'reply',
      text: 'earlier reply',
      files: [],
      sendState: null,
      at: 't1',
    });
    await seedStore.setLastEventId(CID, 3);

    const durable = makeDurable(backing);
    const hydrated = await durable.hydrate();

    expect(hydrated).not.toBeNull();
    expect(hydrated?.lastEventId).toBe(3);
    expect(hydrated?.state.items).toMatchObject([
      { kind: 'user', messageId: 'm-1', sendState: 'queued' },
      { kind: 'agent', eventId: 3 },
    ]);
    expect(hydrated?.state.seenEventIds.has(3)).toBe(true);
  });
});

describe('flag OFF (transcriptPersistenceEnabled=false) — stage-4 behavior exactly', () => {
  it('NEVER touches the store: the factory is not even invoked', async () => {
    const storeFactory = jest.fn<Promise<ChatStore>, []>(async () => new MemoryChatStore());
    const durable = createDurableChat({ enabled: false, connectionId: CID, storeFactory });
    const session = makeSession(durable);

    expect(await durable.hydrate()).toBeNull(); // no read
    session.apply({ type: 'send', messageId: 'm-1', text: 'x', at: 't0' });
    session.apply({ type: 'send-accepted', messageId: 'm-1' });
    session.apply({
      type: 'event',
      envelope: envelope(1, 'reply', { schema: 1, text: 'r', files: [] }),
    });
    durable.saveCursor(1);
    expect(
      await durable.enqueue({ messageId: 'm-2', text: 'y', attachments: [], queuedAt: 't1' }),
    ).toBe(false); // caller falls back to the stage-4 failed path
    expect(
      await durable.drain({ personId: 'p', newUuid: () => 'u', post: async () => {} }),
    ).toBeNull();
    await durable.flush();

    expect(storeFactory).not.toHaveBeenCalled();
    expect(durable.enabled).toBe(false);
  });

  it('the in-memory reducer behavior is untouched by the disabled subscriber', () => {
    const storeFactory = jest.fn<Promise<ChatStore>, []>(async () => new MemoryChatStore());
    const durable = createDurableChat({ enabled: false, connectionId: CID, storeFactory });
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'x', at: 't0' });
    session.apply({ type: 'send-accepted', messageId: 'm-1' });

    expect(session.state.items).toMatchObject([{ messageId: 'm-1', sendState: 'accepted' }]);
    expect(storeFactory).not.toHaveBeenCalled();
  });
});

describe('token material never reaches persistence (stage-3 invariant)', () => {
  it('a full session serializes NO token string and no token-named field into the backing', async () => {
    // The bearer token as the surrounding session would hold it. The durable
    // layer's API deliberately cannot accept it — this test locks the door:
    // if a future change threads connection/auth objects into rows, the
    // serialized backing would contain the sentinel and this fails.
    const TOKEN_SENTINEL = 'ns_secret_bearer_token_a1b2c3';
    const backing = createChatStoreBacking();
    const durable = makeDurable(backing);
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'regular message text', at: 't0' });
    session.apply({ type: 'send-accepted', messageId: 'm-1' });
    session.apply({ type: 'event', envelope: envelope(1, 'ack', { messageId: 'm-1' }) });
    session.apply({
      type: 'event',
      envelope: envelope(2, 'reply', { schema: 1, text: 'a reply', files: ['up_1'] }),
    });
    await durable.enqueue({
      messageId: 'm-2',
      text: 'queued text',
      attachments: [],
      queuedAt: 't1',
    });
    durable.saveCursor(2);
    await durable.flush();

    const serialized = JSON.stringify({
      items: backing.items,
      cursors: [...backing.cursors.entries()],
      queue: backing.queue,
    });
    expect(serialized).not.toContain(TOKEN_SENTINEL);
    expect(serialized.toLowerCase()).not.toContain('token');
    expect(serialized.toLowerCase()).not.toContain('bearer');
    expect(serialized.toLowerCase()).not.toContain('authorization');
  });
});
