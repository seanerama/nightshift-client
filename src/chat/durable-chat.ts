/**
 * Durable chat facade (stage 9): everything the chat session needs from the
 * persistence layer, behind the `transcriptPersistenceEnabled` kill-switch.
 *
 * - The reducer stays PURE. `handle(action, prev, next)` is a write-through
 *   SUBSCRIBER: it observes each reducer transition and mirrors it into the
 *   store (user-row upserts, agent-row appends, cursor advances, queue
 *   removals on acceptance). Persistence failures are swallowed — a broken
 *   disk must degrade to stage-4 in-memory behavior, never break the chat.
 * - Writes are serialized on one promise chain so row order matches
 *   transition order even though callers fire-and-forget.
 * - Flag OFF → every method is a no-op and the store factory is NEVER
 *   invoked (no reads, no writes — spy-tested): byte-for-byte stage-4
 *   behavior. The migration is deliberately NOT gated here (additive schema
 *   stands alone).
 * - Tokens never pass through this module: nothing here takes or stores one,
 *   and the persisted rows are built only from transcript items/envelopes.
 */

import type { ChatStore, ComposeQueueRow } from './chat-store';
import { type DrainDeps, type DrainResult, drainComposeQueue } from './drain';
import { agentItemToRow, queuedMessageIdsOf, rowsToTranscript, userItemToRow } from './hydrate';
import type { TranscriptAction, TranscriptState, UserItem } from './transcript';

export interface DurableChatOptions {
  /** transcriptPersistenceEnabled (default ON — recorded planner deviation). */
  enabled: boolean;
  connectionId: string;
  /** Lazily invoked on first use; NEVER invoked when disabled. */
  storeFactory: () => Promise<ChatStore>;
}

export interface HydratedSession {
  state: TranscriptState;
  /** Persisted cursor — seeds BOTH catch-up `after` and SSE Last-Event-ID. */
  lastEventId: number | null;
}

export interface DurableChat {
  readonly enabled: boolean;
  /** Load history (newest 500), queue state, and cursor. Null when disabled. */
  hydrate(): Promise<HydratedSession | null>;
  /** Write-through subscriber over a reducer transition. Fire-and-forget. */
  handle(action: TranscriptAction, prev: TranscriptState, next: TranscriptState): void;
  /** Persist the cursor if it advanced (used on stream stop / catch-up end). */
  saveCursor(lastEventId: number | null): void;
  /** Queue an offline compose. Resolves false when disabled or the write
   * failed — the caller then falls back to the stage-4 failed path. */
  enqueue(input: {
    messageId: string;
    text: string;
    attachments: readonly string[];
    queuedAt: string;
  }): Promise<boolean>;
  /** Drain queued sends (queued_at order, original messageIds). Null when
   * disabled. */
  drain(deps: Omit<DrainDeps, 'store' | 'connectionId'>): Promise<DrainResult | null>;
  /** Await every pending persistence write (tests / ordered handoffs). */
  flush(): Promise<void>;
}

const findUserItem = (state: TranscriptState, messageId: string): UserItem | undefined =>
  state.items.find(
    (item): item is UserItem => item.kind === 'user' && item.messageId === messageId,
  );

const DISABLED: Omit<DurableChat, 'enabled'> = {
  hydrate: async () => null,
  handle: () => {},
  saveCursor: () => {},
  enqueue: async () => false,
  drain: async () => null,
  flush: async () => {},
};

export const createDurableChat = (options: DurableChatOptions): DurableChat => {
  if (!options.enabled) return { enabled: false, ...DISABLED };

  const connectionId = options.connectionId;
  let storePromise: Promise<ChatStore> | null = null;
  const getStore = (): Promise<ChatStore> => {
    storePromise ??= options.storeFactory();
    return storePromise;
  };

  /** Highest cursor already persisted — avoids rewriting on replayed events. */
  let persistedCursor: number | null = null;
  /** Serialized write chain: transitions land in dispatch order. */
  let tail: Promise<void> = Promise.resolve();
  const run = (op: (store: ChatStore) => Promise<void>): Promise<void> => {
    tail = tail.then(() => getStore().then(op)).catch(() => {});
    return tail;
  };

  const flush = async (): Promise<void> => {
    // Ops can append while we await; loop until the chain is quiescent.
    for (;;) {
      const settled = tail;
      await settled;
      if (settled === tail) return;
    }
  };

  const saveCursor = (lastEventId: number | null): void => {
    if (lastEventId === null) return;
    if (persistedCursor !== null && lastEventId <= persistedCursor) return;
    persistedCursor = lastEventId;
    void run((store) => store.setLastEventId(connectionId, lastEventId));
  };

  const persistUserItem = (state: TranscriptState, messageId: string): void => {
    const item = findUserItem(state, messageId);
    if (item === undefined) return;
    const row = userItemToRow(connectionId, item);
    void run((store) => store.upsertUserItem(row));
  };

  const handle = (action: TranscriptAction, prev: TranscriptState, next: TranscriptState): void => {
    switch (action.type) {
      case 'send':
      case 'send-failed':
      case 'send-queued':
        persistUserItem(next, action.messageId);
        return;
      case 'send-accepted':
        persistUserItem(next, action.messageId);
        // Accepted means the agent has it — the queue's job (if any) is done.
        void run((store) => store.dequeue(connectionId, action.messageId));
        return;
      case 'event': {
        const envelope = action.envelope;
        // Replay of an already-applied event (resume overlap / re-paged
        // catch-up): the reducer no-opped, so must we.
        if (prev.seenEventIds.has(envelope.id)) return;
        saveCursor(envelope.id);
        if (envelope.type === 'ack') {
          const messageId = envelope.payload.messageId;
          if (typeof messageId === 'string') {
            persistUserItem(next, messageId);
            void run((store) => store.dequeue(connectionId, messageId));
          }
          return;
        }
        // reply / notice (unknown types add nothing to items): persist the
        // appended agent item, if the reducer accepted the payload.
        const last = next.items[next.items.length - 1];
        if (next.items.length > prev.items.length && last !== undefined && last.kind === 'agent') {
          const row = agentItemToRow(connectionId, last);
          void run((store) => store.appendAgentItem(row));
        }
        return;
      }
      case 'reset':
        // Connection switch: rows are per-connection and must SURVIVE — the
        // durable transcript is exactly what outlives the in-memory session.
        return;
    }
  };

  return {
    enabled: true,
    async hydrate() {
      const store = await getStore();
      const [rows, queue, cursor] = await Promise.all([
        store.loadTranscript(connectionId),
        store.listQueue(connectionId),
        store.getLastEventId(connectionId),
      ]);
      persistedCursor = cursor;
      return { state: rowsToTranscript(rows, queuedMessageIdsOf(queue)), lastEventId: cursor };
    },
    handle,
    saveCursor,
    async enqueue(input) {
      const row: ComposeQueueRow = { ...input, connectionId };
      let ok = false;
      await run(async (store) => {
        await store.enqueue(row);
        ok = true;
      });
      return ok;
    },
    async drain(deps) {
      await flush(); // queued writes (enqueues, acks) must land before listing
      const store = await getStore();
      return drainComposeQueue({ ...deps, store, connectionId });
    },
    flush,
  };
};
