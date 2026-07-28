/**
 * Unit: the in-memory ChatStore fake — the behavior contract the sqlite
 * adapter mirrors: insertion-order load, newest-500 cap with prune-at-write,
 * user upsert-in-place, agent insert-or-ignore, per-connection isolation,
 * queue ordering, and restart survival over a shared backing.
 */

import { TRANSCRIPT_CAP, type TranscriptItemRow } from './chat-store';
import { createChatStoreBacking, MemoryChatStore } from './memory';

const agentRow = (connectionId: string, eventId: number): TranscriptItemRow => ({
  connectionId,
  kind: 'agent',
  messageId: null,
  eventId,
  eventType: 'reply',
  text: `reply ${eventId}`,
  files: [],
  sendState: null,
  at: '2026-07-27T00:00:00.000Z',
});

const userRow = (
  connectionId: string,
  messageId: string,
  sendState: TranscriptItemRow['sendState'] = 'sending',
): TranscriptItemRow => ({
  connectionId,
  kind: 'user',
  messageId,
  eventId: null,
  eventType: null,
  text: `text ${messageId}`,
  files: [],
  sendState,
  at: '2026-07-27T00:00:00.000Z',
});

describe('MemoryChatStore transcript', () => {
  it('returns items in insertion order and isolates connections', async () => {
    const store = new MemoryChatStore();
    await store.upsertUserItem(userRow('c1', 'm-1'));
    await store.appendAgentItem(agentRow('c1', 1));
    await store.appendAgentItem(agentRow('c2', 99));

    const c1 = await store.loadTranscript('c1');
    expect(c1.map((r) => r.kind)).toEqual(['user', 'agent']);
    expect(await store.loadTranscript('c2')).toMatchObject([{ eventId: 99 }]);
  });

  it('upserting a user item updates state in place without reordering', async () => {
    const store = new MemoryChatStore();
    await store.upsertUserItem(userRow('c1', 'm-1'));
    await store.appendAgentItem(agentRow('c1', 1));
    await store.upsertUserItem({ ...userRow('c1', 'm-1'), sendState: 'accepted' });

    const rows = await store.loadTranscript('c1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ messageId: 'm-1', sendState: 'accepted' });
  });

  it('appending the same eventId twice is a no-op (insert-or-ignore)', async () => {
    const store = new MemoryChatStore();
    await store.appendAgentItem(agentRow('c1', 7));
    await store.appendAgentItem({ ...agentRow('c1', 7), text: 'dupe' });

    const rows = await store.loadTranscript('c1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'reply 7' });
  });

  it('caps each connection at the newest 500 items, pruning at write time', async () => {
    const store = new MemoryChatStore();
    for (let i = 1; i <= TRANSCRIPT_CAP + 25; i += 1) {
      await store.appendAgentItem(agentRow('c1', i));
    }
    await store.appendAgentItem(agentRow('c2', 1)); // other connection untouched

    const rows = await store.loadTranscript('c1');
    expect(rows).toHaveLength(TRANSCRIPT_CAP);
    expect(rows[0]).toMatchObject({ eventId: 26 }); // oldest 25 pruned
    expect(rows[rows.length - 1]).toMatchObject({ eventId: TRANSCRIPT_CAP + 25 });
    expect(await store.loadTranscript('c2')).toHaveLength(1);
  });
});

describe('MemoryChatStore cursor + queue', () => {
  it('stores one cursor per connection', async () => {
    const store = new MemoryChatStore();
    expect(await store.getLastEventId('c1')).toBeNull();
    await store.setLastEventId('c1', 12);
    await store.setLastEventId('c2', 3);
    expect(await store.getLastEventId('c1')).toBe(12);
    expect(await store.getLastEventId('c2')).toBe(3);
  });

  it('lists the queue in queued_at order regardless of insertion order', async () => {
    const store = new MemoryChatStore();
    await store.enqueue({
      messageId: 'b',
      connectionId: 'c1',
      text: '2',
      attachments: [],
      queuedAt: '2026-07-27T00:02:00Z',
    });
    await store.enqueue({
      messageId: 'a',
      connectionId: 'c1',
      text: '1',
      attachments: [],
      queuedAt: '2026-07-27T00:01:00Z',
    });
    await store.enqueue({
      messageId: 'z',
      connectionId: 'c2',
      text: 'x',
      attachments: [],
      queuedAt: '2026-07-27T00:00:00Z',
    });

    const rows = await store.listQueue('c1');
    expect(rows.map((r) => r.messageId)).toEqual(['a', 'b']);
  });

  it('dequeue removes exactly the named row; missing rows are a no-op', async () => {
    const store = new MemoryChatStore();
    await store.enqueue({
      messageId: 'a',
      connectionId: 'c1',
      text: '1',
      attachments: [],
      queuedAt: 't',
    });
    await store.dequeue('c1', 'a');
    await store.dequeue('c1', 'never-existed');
    expect(await store.listQueue('c1')).toHaveLength(0);
  });
});

describe('restart simulation (shared backing = same sqlite file)', () => {
  it('a new store over the same backing sees the previous store’s rows, cursor, and queue', async () => {
    const backing = createChatStoreBacking();
    const before = new MemoryChatStore(backing);
    await before.upsertUserItem(userRow('c1', 'm-1', 'accepted'));
    await before.appendAgentItem(agentRow('c1', 2));
    await before.setLastEventId('c1', 2);
    await before.enqueue({
      messageId: 'q-1',
      connectionId: 'c1',
      text: 'queued',
      attachments: [],
      queuedAt: 't',
    });

    const after = new MemoryChatStore(backing); // "process restart"
    expect(await after.loadTranscript('c1')).toMatchObject([
      { messageId: 'm-1', sendState: 'accepted' },
      { eventId: 2 },
    ]);
    expect(await after.getLastEventId('c1')).toBe(2);
    expect(await after.listQueue('c1')).toMatchObject([{ messageId: 'q-1' }]);
  });
});
