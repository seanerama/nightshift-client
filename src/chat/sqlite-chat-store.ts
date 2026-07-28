/**
 * expo-sqlite implementation of ChatStore (stage 9). Message text, event ids,
 * and timestamps ONLY — the schema has no token column by design (stage-3
 * invariant), and this adapter never sees a token.
 *
 * Native module: this file must never be imported by unit tests (they use the
 * in-memory fake in ./memory.ts). Shares the connections database (and its
 * additive migrations runner — tables arrive with migration v2) with the
 * stage-3 connection store.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { getConnectionsDatabase } from '../connections/sqlite-store';
import {
  type ChatStore,
  type ComposeQueueRow,
  TRANSCRIPT_CAP,
  type TranscriptItemRow,
} from './chat-store';
import type { SendState } from './transcript';

interface RawItemRow {
  connection_id: string;
  kind: string;
  message_id: string | null;
  event_id: number | null;
  event_type: string | null;
  text: string;
  files: string | null;
  send_state: string | null;
  at: string;
}

interface RawQueueRow {
  message_id: string;
  connection_id: string;
  text: string;
  attachments: string;
  queued_at: string;
}

const parseStringArray = (json: string | null): string[] => {
  if (json === null) return [];
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const rowToItem = (row: RawItemRow): TranscriptItemRow => ({
  connectionId: row.connection_id,
  kind: row.kind === 'user' ? 'user' : 'agent',
  messageId: row.message_id,
  eventId: row.event_id,
  eventType: row.event_type,
  text: row.text,
  files: parseStringArray(row.files),
  sendState: (row.send_state as SendState | null) ?? null,
  at: row.at,
});

class SqliteChatStore implements ChatStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async loadTranscript(connectionId: string): Promise<TranscriptItemRow[]> {
    // Newest TRANSCRIPT_CAP rows, returned in insertion order.
    const rows = await this.db.getAllAsync<RawItemRow>(
      `SELECT * FROM (
         SELECT * FROM transcript_items WHERE connection_id = ?
         ORDER BY seq DESC LIMIT ${TRANSCRIPT_CAP}
       ) ORDER BY seq ASC`,
      connectionId,
    );
    return rows.map(rowToItem);
  }

  async upsertUserItem(row: TranscriptItemRow): Promise<void> {
    const updated = await this.db.runAsync(
      `UPDATE transcript_items SET text = ?, send_state = ?, at = ?
       WHERE connection_id = ? AND message_id = ?`,
      row.text,
      row.sendState,
      row.at,
      row.connectionId,
      row.messageId,
    );
    if (updated.changes > 0) return;
    await this.insert(row);
  }

  async appendAgentItem(row: TranscriptItemRow): Promise<void> {
    // OR IGNORE + the unique (connection_id, event_id) index: replaying an
    // already-persisted envelope is a no-op, mirroring reducer dedup.
    await this.insert(row, 'OR IGNORE');
  }

  async getLastEventId(connectionId: string): Promise<number | null> {
    const row = await this.db.getFirstAsync<{ last_event_id: number }>(
      'SELECT last_event_id FROM stream_cursors WHERE connection_id = ?',
      connectionId,
    );
    return row?.last_event_id ?? null;
  }

  async setLastEventId(connectionId: string, lastEventId: number): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO stream_cursors (connection_id, last_event_id) VALUES (?, ?)',
      connectionId,
      lastEventId,
    );
  }

  async listQueue(connectionId: string): Promise<ComposeQueueRow[]> {
    const rows = await this.db.getAllAsync<RawQueueRow>(
      `SELECT * FROM compose_queue WHERE connection_id = ?
       ORDER BY queued_at ASC, message_id ASC`,
      connectionId,
    );
    return rows.map((row) => ({
      messageId: row.message_id,
      connectionId: row.connection_id,
      text: row.text,
      attachments: parseStringArray(row.attachments),
      queuedAt: row.queued_at,
    }));
  }

  async enqueue(row: ComposeQueueRow): Promise<void> {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO compose_queue
        (message_id, connection_id, text, attachments, queued_at)
       VALUES (?, ?, ?, ?, ?)`,
      row.messageId,
      row.connectionId,
      row.text,
      JSON.stringify(row.attachments),
      row.queuedAt,
    );
  }

  async dequeue(connectionId: string, messageId: string): Promise<void> {
    await this.db.runAsync(
      'DELETE FROM compose_queue WHERE connection_id = ? AND message_id = ?',
      connectionId,
      messageId,
    );
  }

  private async insert(row: TranscriptItemRow, conflict: '' | 'OR IGNORE' = ''): Promise<void> {
    await this.db.runAsync(
      `INSERT ${conflict} INTO transcript_items
        (connection_id, kind, message_id, event_id, event_type, text, files, send_state, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.connectionId,
      row.kind,
      row.messageId,
      row.eventId,
      row.eventType,
      row.text,
      JSON.stringify(row.files),
      row.sendState,
      row.at,
    );
    // Runtime prune to the newest TRANSCRIPT_CAP rows for this connection.
    // (The migration list stays additive; pruning is a store-write concern.)
    await this.db.runAsync(
      `DELETE FROM transcript_items WHERE connection_id = ? AND seq < (
         SELECT MIN(seq) FROM (
           SELECT seq FROM transcript_items WHERE connection_id = ?
           ORDER BY seq DESC LIMIT ${TRANSCRIPT_CAP}
         )
       )`,
      row.connectionId,
      row.connectionId,
    );
  }
}

/** Open (once) the shared connections database and return the chat store. */
export const getSqliteChatStore = (): Promise<ChatStore> =>
  getConnectionsDatabase().then((db) => new SqliteChatStore(db));
