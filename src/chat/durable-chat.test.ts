/**
 * Unit: the durable-chat facade — write-through subscriber (every reducer
 * transition lands as the right upsert), cursor persistence, replay no-ops,
 * the flag-OFF contract (NO store calls, spy-verified), and the stage-3
 * invariant that no token material is ever serialized into a row.
 */

import type { EventEnvelope } from 'agent-app-contract/types';
import type { OutboxPage } from '../api/client';
import { runCatchUp } from './catch-up';
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
const makeSession = (durable: DurableChat, initial: TranscriptState = emptyTranscript) => {
  let state: TranscriptState = initial;
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

describe('the persisted cursor can never outrun the persisted transcript (review finding)', () => {
  // The asymmetry these tests pin down: a cursor BEHIND the rows on disk is
  // always safe (resume/catch-up replays, dedup + OR IGNORE absorb it); a
  // cursor AHEAD of a missing row is a permanent silent gap, because resume
  // is strictly-after the cursor. Failures may therefore hold the cursor
  // back, but must never let it advance past an event whose row write failed.

  const replyEnvelope = (id: number): EventEnvelope =>
    envelope(id, 'reply', { schema: 1, text: `reply ${id}`, files: [] });

  const applyReply = (session: ReturnType<typeof makeSession>, id: number) =>
    session.apply({ type: 'event', envelope: replyEnvelope(id) });

  /** Explicit delegation (interface methods, so no prototype spread). */
  const delegating = (inner: ChatStore): ChatStore => ({
    loadTranscript: (c) => inner.loadTranscript(c),
    upsertUserItem: (r) => inner.upsertUserItem(r),
    appendAgentItem: (r) => inner.appendAgentItem(r),
    getLastEventId: (c) => inner.getLastEventId(c),
    setLastEventId: (c, id) => inner.setLastEventId(c, id),
    listQueue: (c) => inner.listQueue(c),
    enqueue: (r) => inner.enqueue(r),
    dequeue: (c, m) => inner.dequeue(c, m),
  });

  const makeDurableWithStore = (store: ChatStore) =>
    createDurableChat({ enabled: true, connectionId: CID, storeFactory: async () => store });

  const diskEventIds = async (backing: ChatStoreBacking): Promise<number[]> =>
    (await new MemoryChatStore(backing).loadTranscript(CID)).flatMap((r) =>
      r.eventId === null ? [] : [r.eventId],
    );

  it('an append failure freezes the cursor below the failed event — later successes and raw stream saves cannot lift it past the gap', async () => {
    const backing = createChatStoreBacking();
    const inner = new MemoryChatStore(backing);
    const store = delegating(inner);
    store.appendAgentItem = async (row) => {
      if (row.eventId === 2) throw new Error('disk full');
      return inner.appendAgentItem(row);
    };
    const durable = makeDurableWithStore(store);
    const session = makeSession(durable);

    applyReply(session, 1); // persists: row 1 + cursor 1
    applyReply(session, 2); // row write FAILS → cursor must not reach 2
    applyReply(session, 3); // row 3 lands, but the gap at 2 pins the cursor
    durable.saveCursor(5); // raw stream cursor (stream-stop path) — clamped
    await durable.flush();

    // Cursor stays strictly below the missing row…
    expect(await inner.getLastEventId(CID)).toBe(1);
    // …while the disk may legitimately hold rows beyond it (behind-is-safe).
    expect(await diskEventIds(backing)).toEqual([1, 3]);
  });

  it('after a restart, catch-up from the held-back cursor re-fetches the gap and the missing row lands (self-healing)', async () => {
    // --- Life 1: same failure as above; disk ends with rows [1, 3], cursor 1.
    const backing = createChatStoreBacking();
    const inner1 = new MemoryChatStore(backing);
    const store1 = delegating(inner1);
    store1.appendAgentItem = async (row) => {
      if (row.eventId === 2) throw new Error('disk full');
      return inner1.appendAgentItem(row);
    };
    const durable1 = makeDurableWithStore(store1);
    const session1 = makeSession(durable1);
    applyReply(session1, 1);
    applyReply(session1, 2); // lost this session
    applyReply(session1, 3);
    await durable1.flush();

    // --- Life 2: healthy store over the same backing.
    const durable2 = makeDurable(backing);
    const hydrated = await durable2.hydrate();
    if (hydrated === null) throw new Error('unreachable');
    expect(hydrated.lastEventId).toBe(1); // held back — NOT 3

    // The agent's outbox still has everything after the cursor.
    const outbox = [replyEnvelope(2), replyEnvelope(3)];
    const fetchPage = async (after: number | null): Promise<OutboxPage> => ({
      schema: 1,
      events: outbox.filter((e) => e.id > (after ?? 0)),
    });
    const session2 = makeSession(durable2, hydrated.state);
    const cursor = await runCatchUp({
      after: hydrated.lastEventId,
      fetchPage,
      apply: (e) => session2.apply({ type: 'event', envelope: e }),
    });
    durable2.saveCursor(cursor);
    await durable2.flush();

    // The gap healed: row 2 is on disk now (3 was already there — its replay
    // was an ignore-no-op), and only then does the cursor pass the gap.
    expect(await diskEventIds(backing)).toEqual(expect.arrayContaining([1, 2, 3]));
    expect(await new MemoryChatStore(backing).getLastEventId(CID)).toBe(3);
    // In-memory state healed identically: event 2 exactly once.
    const ids = session2.state.items.flatMap((i) => (i.kind === 'agent' ? [i.eventId] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('an ack whose row write fails also freezes the cursor (its user-row update is what it vouches for)', async () => {
    const backing = createChatStoreBacking();
    const inner = new MemoryChatStore(backing);
    const store = delegating(inner);
    store.upsertUserItem = async (row) => {
      if (row.sendState === 'accepted') throw new Error('disk full'); // only the ack's write
      return inner.upsertUserItem(row);
    };
    const durable = makeDurableWithStore(store);
    const session = makeSession(durable);

    session.apply({ type: 'send', messageId: 'm-1', text: 'x', at: 't0' }); // persists fine
    session.apply({ type: 'event', envelope: envelope(5, 'ack', { messageId: 'm-1' }) }); // fails
    applyReply(session, 6); // row 6 lands; cursor still may not reach the ack
    await durable.flush();

    const cursor = await inner.getLastEventId(CID);
    expect(cursor).not.toBeNull();
    expect(cursor as number).toBeLessThan(5); // restart will re-fetch ack 5 and heal
    expect(await diskEventIds(backing)).toEqual([6]);
  });

  it('a failed cursor WRITE is retried on the next advance (bookkeeping mirrors disk, not intent)', async () => {
    const backing = createChatStoreBacking();
    const inner = new MemoryChatStore(backing);
    const store = delegating(inner);
    let failuresLeft = 1;
    store.setLastEventId = async (c, id) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('disk hiccup');
      }
      return inner.setLastEventId(c, id);
    };
    const durable = makeDurableWithStore(store);
    const session = makeSession(durable);

    applyReply(session, 1); // row lands; the cursor write itself fails
    await durable.flush();
    expect(await inner.getLastEventId(CID)).toBeNull(); // behind disk — safe

    durable.saveCursor(1); // stream-stop path retries the SAME value
    await durable.flush();
    expect(await inner.getLastEventId(CID)).toBe(1);
  });
});
