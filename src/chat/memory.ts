/**
 * In-memory ChatStore fake (stage 9), same role as src/connections/memory.ts:
 * unit and integration tests run against it (expo-sqlite cannot load in
 * jest's node environment) with the same observable behavior as the sqlite
 * adapter, including the newest-500 cap and prune-at-write.
 *
 * The backing is separable so tests can simulate an app restart: build a new
 * MemoryChatStore over the SAME backing — exactly like reopening the same
 * sqlite file with a fresh process.
 */

import {
  type ChatStore,
  type ComposeQueueRow,
  TRANSCRIPT_CAP,
  type TranscriptItemRow,
} from './chat-store';

interface StoredItem extends TranscriptItemRow {
  seq: number;
}

/** The "database file": share one across store instances to simulate restart. */
export interface ChatStoreBacking {
  nextSeq: number;
  items: StoredItem[];
  cursors: Map<string, number>;
  queue: ComposeQueueRow[];
}

export const createChatStoreBacking = (): ChatStoreBacking => ({
  nextSeq: 1,
  items: [],
  cursors: new Map(),
  queue: [],
});

export class MemoryChatStore implements ChatStore {
  constructor(private readonly backing: ChatStoreBacking = createChatStoreBacking()) {}

  async loadTranscript(connectionId: string): Promise<TranscriptItemRow[]> {
    return this.backing.items
      .filter((item) => item.connectionId === connectionId)
      .sort((a, b) => a.seq - b.seq)
      .slice(-TRANSCRIPT_CAP)
      .map(({ seq: _seq, ...row }) => ({ ...row, files: [...row.files] }));
  }

  async upsertUserItem(row: TranscriptItemRow): Promise<void> {
    const existing = this.backing.items.find(
      (item) => item.connectionId === row.connectionId && item.messageId === row.messageId,
    );
    if (existing !== undefined) {
      existing.text = row.text;
      existing.sendState = row.sendState;
      existing.at = row.at;
      return;
    }
    this.insert(row);
  }

  async appendAgentItem(row: TranscriptItemRow): Promise<void> {
    const duplicate = this.backing.items.some(
      (item) => item.connectionId === row.connectionId && item.eventId === row.eventId,
    );
    if (duplicate) return; // same eventId: insert-or-ignore, like the sqlite index
    this.insert(row);
  }

  async getLastEventId(connectionId: string): Promise<number | null> {
    return this.backing.cursors.get(connectionId) ?? null;
  }

  async setLastEventId(connectionId: string, lastEventId: number): Promise<void> {
    this.backing.cursors.set(connectionId, lastEventId);
  }

  async listQueue(connectionId: string): Promise<ComposeQueueRow[]> {
    return this.backing.queue
      .filter((row) => row.connectionId === connectionId)
      .sort(
        (a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.messageId.localeCompare(b.messageId),
      )
      .map((row) => ({ ...row, attachments: [...row.attachments] }));
  }

  async enqueue(row: ComposeQueueRow): Promise<void> {
    // message_id is the primary key: re-queueing replaces, never duplicates.
    this.backing.queue = this.backing.queue.filter((r) => r.messageId !== row.messageId);
    this.backing.queue.push({ ...row, attachments: [...row.attachments] });
  }

  async dequeue(connectionId: string, messageId: string): Promise<void> {
    this.backing.queue = this.backing.queue.filter(
      (row) => !(row.connectionId === connectionId && row.messageId === messageId),
    );
  }

  private insert(row: TranscriptItemRow): void {
    this.backing.items.push({ ...row, files: [...row.files], seq: this.backing.nextSeq });
    this.backing.nextSeq += 1;
    // Prune additively-at-runtime: keep only the newest TRANSCRIPT_CAP rows
    // for this connection (other connections untouched — per-agent isolation).
    const forConnection = this.backing.items
      .filter((item) => item.connectionId === row.connectionId)
      .sort((a, b) => a.seq - b.seq);
    const excess = forConnection.length - TRANSCRIPT_CAP;
    if (excess > 0) {
      const dropped = new Set(forConnection.slice(0, excess).map((item) => item.seq));
      this.backing.items = this.backing.items.filter(
        (item) => item.connectionId !== row.connectionId || !dropped.has(item.seq),
      );
    }
  }
}
