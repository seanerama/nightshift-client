/**
 * Unit: offline compose-queue drain — queued_at order, ORIGINAL messageId on
 * every re-POST (the contract dedup key that makes at-least-once safe),
 * success dequeues, hard failure falls to the failed/retry path, and a
 * network failure stops the drain leaving the remainder queued.
 */

import { randomUUID } from 'node:crypto';

import type { InboundMessage } from 'agent-app-contract/types';
import { ApiClientError } from '../api/client';
import type { ComposeQueueRow } from './chat-store';
import { drainComposeQueue } from './drain';
import { MemoryChatStore } from './memory';

const CID = 'conn-1';
const PERSON = 'owner-nightshift';

const row = (messageId: string, queuedAt: string, text = `text ${messageId}`): ComposeQueueRow => ({
  messageId,
  connectionId: CID,
  text,
  attachments: [],
  queuedAt,
});

const seed = async (rows: ComposeQueueRow[]): Promise<MemoryChatStore> => {
  const store = new MemoryChatStore();
  for (const r of rows) await store.enqueue(r);
  return store;
};

describe('drainComposeQueue', () => {
  it('re-POSTs every row with its ORIGINAL messageId, in queued_at order, and dequeues on 202', async () => {
    const store = await seed([
      row('m-late', '2026-07-27T00:02:00Z'),
      row('m-early', '2026-07-27T00:01:00Z'),
    ]);
    const posted: InboundMessage[] = [];
    const accepted: string[] = [];

    const result = await drainComposeQueue({
      store,
      connectionId: CID,
      personId: PERSON,
      newUuid: randomUUID,
      post: async (message) => {
        posted.push(message);
      },
      onAccepted: (id) => accepted.push(id),
    });

    expect(posted.map((m) => m.messageId)).toEqual(['m-early', 'm-late']);
    expect(posted.map((m) => m.personId)).toEqual([PERSON, PERSON]);
    expect(posted.map((m) => m.text)).toEqual(['text m-early', 'text m-late']);
    expect(accepted).toEqual(['m-early', 'm-late']);
    expect(result).toMatchObject({
      accepted: ['m-early', 'm-late'],
      failed: [],
      stoppedUnreachable: false,
    });
    expect(await store.listQueue(CID)).toHaveLength(0);
  });

  it('an http/shape failure dequeues and reports failed (the existing failed/retry path), then continues', async () => {
    const store = await seed([row('m-1', 't1'), row('m-2', 't2')]);
    const failed: string[] = [];

    const result = await drainComposeQueue({
      store,
      connectionId: CID,
      personId: PERSON,
      newUuid: randomUUID,
      post: async (message) => {
        if (message.messageId === 'm-1') {
          throw new ApiClientError('http', 'POST /app/v1/messages returned 500', { status: 500 });
        }
      },
      onFailed: (id) => failed.push(id),
    });

    expect(failed).toEqual(['m-1']);
    expect(result.accepted).toEqual(['m-2']);
    // The failed row leaves the queue — retry ownership moves to tap-to-retry.
    expect(await store.listQueue(CID)).toHaveLength(0);
  });

  it('a network failure stops the drain: that row and all later rows stay queued', async () => {
    const store = await seed([row('m-1', 't1'), row('m-2', 't2'), row('m-3', 't3')]);
    const posted: string[] = [];
    const unreachable: string[] = [];

    const result = await drainComposeQueue({
      store,
      connectionId: CID,
      personId: PERSON,
      newUuid: randomUUID,
      post: async (message) => {
        posted.push(message.messageId);
        if (message.messageId === 'm-2') {
          throw new ApiClientError('network', 'POST /app/v1/messages failed: fetch failed');
        }
      },
      onUnreachable: (id) => unreachable.push(id),
    });

    expect(posted).toEqual(['m-1', 'm-2']); // m-3 never attempted
    expect(unreachable).toEqual(['m-2']);
    expect(result).toMatchObject({ accepted: ['m-1'], failed: [], stoppedUnreachable: true });
    expect((await store.listQueue(CID)).map((r) => r.messageId)).toEqual(['m-2', 'm-3']);
  });

  it('a second drain after everything drained is a no-op (exactly-once from the queue’s side)', async () => {
    const store = await seed([row('m-1', 't1')]);
    const posted: string[] = [];
    const deps = {
      store,
      connectionId: CID,
      personId: PERSON,
      newUuid: randomUUID,
      post: async (message: InboundMessage) => {
        posted.push(message.messageId);
      },
    };

    await drainComposeQueue(deps);
    await drainComposeQueue(deps);

    expect(posted).toEqual(['m-1']); // one POST total across both drains
  });

  it('builds contract-shaped InboundMessages (schema, attachments carried through)', async () => {
    const store = await seed([{ ...row('m-1', 't1'), attachments: ['up_1'] }]);
    const posted: InboundMessage[] = [];

    await drainComposeQueue({
      store,
      connectionId: CID,
      personId: PERSON,
      newUuid: randomUUID,
      post: async (message) => {
        posted.push(message);
      },
    });

    expect(posted[0]).toMatchObject({ schema: 1, messageId: 'm-1', attachments: ['up_1'] });
    expect(typeof posted[0].receivedAt).toBe('string');
  });
});
