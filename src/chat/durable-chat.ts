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

  // ---------------------------------------------------------------------
  // Cursor safety invariant: the DISK cursor must never point past an event
  // whose item row failed to persist. Resume is strictly-after the cursor,
  // so cursor-ahead-of-a-missing-row would be a PERMANENT silent gap in
  // durable history; cursor-behind is always safe (catch-up refetches and
  // reducer/OR-IGNORE dedup absorb the replay). Mechanics:
  // - `persistedCursor` mirrors DISK truth only — it is set after a
  //   setLastEventId succeeds, never optimistically, so a failed cursor
  //   write is retried on the next advance instead of being suppressed.
  // - Each event is ONE chain op: item write(s) first, then the cursor
  //   advance — the cursor moves only after the rows it vouches for exist.
  // - `cursorCeiling` freezes advances across LATER events too: if the item
  //   write for event N fails, no cursor value ≥ N is ever persisted this
  //   session (later successful appends land as rows but cannot lift the
  //   ceiling). After restart, catch-up resumes from < N and re-fetches the
  //   gap — the missing row lands, duplicates are ignored: self-healing.
  // ---------------------------------------------------------------------
  /** Highest cursor value actually ON DISK (null = none/unknown). */
  let persistedCursor: number | null = null;
  /** Max cursor value allowed to persist; lowered by item-write failures. */
  let cursorCeiling: number = Number.POSITIVE_INFINITY;

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

  /** Persist `min(requested, ceiling)` if it advances the disk cursor.
   * `persistedCursor` moves only on write SUCCESS (disk truth). */
  const writeCursorUpTo = async (store: ChatStore, requested: number): Promise<void> => {
    const target = Math.min(requested, cursorCeiling);
    if (target < 0) return;
    if (persistedCursor !== null && target <= persistedCursor) return;
    await store.setLastEventId(connectionId, target);
    persistedCursor = target;
  };

  /** ONE op per event: item write(s), THEN the cursor advance. An item-write
   * failure lowers the ceiling and skips the advance entirely. */
  const persistEvent = (
    eventId: number,
    itemWrites: ((store: ChatStore) => Promise<void>) | null,
  ): void => {
    void run(async (store) => {
      if (itemWrites !== null) {
        try {
          await itemWrites(store);
        } catch {
          // The row this event vouches for is NOT on disk: freeze the
          // cursor strictly below it for the rest of the session.
          cursorCeiling = Math.min(cursorCeiling, eventId - 1);
          return;
        }
      }
      await writeCursorUpTo(store, eventId);
    });
  };

  const saveCursor = (lastEventId: number | null): void => {
    if (lastEventId === null) return;
    // Runs on the SAME chain, i.e. after every already-enqueued per-event
    // op — so the ceiling clamp inside writeCursorUpTo reflects any item
    // failure among the events this raw cursor covers.
    void run((store) => writeCursorUpTo(store, lastEventId));
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
        if (envelope.type === 'ack') {
          const messageId = envelope.payload.messageId;
          if (typeof messageId !== 'string') {
            persistEvent(envelope.id, null); // nothing to vouch for
            return;
          }
          const item = findUserItem(next, messageId);
          const row = item === undefined ? null : userItemToRow(connectionId, item);
          persistEvent(envelope.id, async (store) => {
            if (row !== null) await store.upsertUserItem(row);
            await store.dequeue(connectionId, messageId);
          });
          return;
        }
        // reply / notice: persist the appended agent item (if the reducer
        // accepted the payload), then the cursor — same op. Unknown or
        // malformed events add no row, so a cursor-only advance is safe.
        const last = next.items[next.items.length - 1];
        if (next.items.length > prev.items.length && last !== undefined && last.kind === 'agent') {
          const row = agentItemToRow(connectionId, last);
          persistEvent(envelope.id, (store) => store.appendAgentItem(row));
        } else {
          persistEvent(envelope.id, null);
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
