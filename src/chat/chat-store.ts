/**
 * Durable chat storage seam (stage 9).
 *
 * Same pattern as the stage-3 ConnectionStore: a small interface hides the
 * sqlite adapter so every consumer (write-through subscriber, hydration,
 * catch-up, drain) unit-tests against the in-memory fake in jest's node
 * environment. Three concerns, all per-connection (multi-agent isolation):
 *
 * - transcript_items: the durable mirror of the reducer's TranscriptState;
 * - stream_cursors:   the persisted Last-Event-ID / ?after= cursor (one
 *                     cursor concept — contract invariant 2);
 * - compose_queue:    offline-composed messages awaiting drain.
 *
 * NO token material ever passes through this seam — rows carry message text,
 * ids, and timestamps only (stage-3 invariant, spy-tested in durable-chat).
 */

import type { SendState } from './transcript';

/** Hydration cap: only the newest N items per connection are kept/loaded.
 * Older rows are pruned at write time (runtime, additively to the schema —
 * the migration list itself stays free of destructive statements). */
export const TRANSCRIPT_CAP = 500;

/** One persisted transcript item. Exactly one of messageId (user rows) /
 * eventId (agent rows) is set — mirrors the TranscriptItem union. */
export interface TranscriptItemRow {
  connectionId: string;
  kind: 'user' | 'agent';
  /** User rows: the client-generated dedup key. */
  messageId: string | null;
  /** Agent rows: the envelope id (the outbox cursor). */
  eventId: number | null;
  /** Agent rows: 'reply' | 'notice'. */
  eventType: string | null;
  text: string;
  /** Agent rows: AssistantReply file ids. Empty for user rows. */
  files: readonly string[];
  /** User rows only. */
  sendState: SendState | null;
  /** ISO-8601 display timestamp. */
  at: string;
}

/** One offline-composed message awaiting drain. */
export interface ComposeQueueRow {
  /** ORIGINAL client messageId — the contract dedup key; drain re-POSTs it. */
  messageId: string;
  connectionId: string;
  text: string;
  /** Upload ids — reserved for the attachments stage; [] today. */
  attachments: readonly string[];
  /** ISO-8601; drain order is ascending queuedAt. */
  queuedAt: string;
}

export interface ChatStore {
  /** Newest TRANSCRIPT_CAP items for the connection, in insertion order
   * (oldest first) — ready to become TranscriptState.items. */
  loadTranscript(connectionId: string): Promise<TranscriptItemRow[]>;
  /** Insert or update the user row keyed by (connectionId, messageId). */
  upsertUserItem(row: TranscriptItemRow): Promise<void>;
  /** Append the agent row keyed by (connectionId, eventId); a duplicate
   * eventId is a no-op (dedup belt to the reducer's seenEventIds braces). */
  appendAgentItem(row: TranscriptItemRow): Promise<void>;
  getLastEventId(connectionId: string): Promise<number | null>;
  setLastEventId(connectionId: string, lastEventId: number): Promise<void>;
  /** Queue rows for the connection in drain order (ascending queuedAt). */
  listQueue(connectionId: string): Promise<ComposeQueueRow[]>;
  enqueue(row: ComposeQueueRow): Promise<void>;
  /** Remove a queue row; missing row is a no-op. */
  dequeue(connectionId: string, messageId: string): Promise<void>;
}
