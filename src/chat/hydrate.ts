/**
 * Hydration (stage 9): persisted rows → the stage-4 TranscriptState shape,
 * plus the item→row mappers the write-through subscriber uses. Pure — the
 * reducer is untouched; hydration just rebuilds the state it would have
 * reached, including `seenEventIds` reconstructed from the agent rows (the
 * dedup set the resume-overlap window depends on).
 */

import type { ComposeQueueRow, TranscriptItemRow } from './chat-store';
import type { AgentItem, SendState, TranscriptItem, TranscriptState, UserItem } from './transcript';

/** Revive a persisted send state at hydration time. The process may have died
 * mid-flight, so states that imply "an attempt is running" cannot survive:
 * - a queue row exists  → 'queued' (the drain loop owns it);
 * - stored 'accepted'   → 'accepted' (a fact, not an attempt);
 * - anything else       → 'failed' (outcome unknown; tap-to-retry re-POSTs
 *   the SAME messageId, which contract dedup makes safe either way).
 */
const reviveSendState = (stored: SendState | null, hasQueueRow: boolean): SendState => {
  if (hasQueueRow) return 'queued';
  if (stored === 'accepted') return 'accepted';
  return 'failed';
};

/** Rebuild TranscriptState from persisted rows (insertion order) and the
 * connection's queued messageIds. Malformed rows are skipped, never thrown —
 * hydration must not brick the chat over one bad row. */
export const rowsToTranscript = (
  rows: readonly TranscriptItemRow[],
  queuedMessageIds: ReadonlySet<string>,
): TranscriptState => {
  const items: TranscriptItem[] = [];
  const seenEventIds = new Set<number>();
  for (const row of rows) {
    if (row.kind === 'agent') {
      if (row.eventId === null || seenEventIds.has(row.eventId)) continue;
      if (row.eventType !== 'reply' && row.eventType !== 'notice') continue;
      seenEventIds.add(row.eventId);
      items.push({
        kind: 'agent',
        eventId: row.eventId,
        eventType: row.eventType,
        text: row.text,
        files: [...row.files],
        at: row.at,
      });
    } else {
      if (row.messageId === null) continue;
      items.push({
        kind: 'user',
        messageId: row.messageId,
        text: row.text,
        sendState: reviveSendState(row.sendState, queuedMessageIds.has(row.messageId)),
        at: row.at,
      });
    }
  }
  return { items, seenEventIds };
};

export const userItemToRow = (connectionId: string, item: UserItem): TranscriptItemRow => ({
  connectionId,
  kind: 'user',
  messageId: item.messageId,
  eventId: null,
  eventType: null,
  text: item.text,
  files: [],
  sendState: item.sendState,
  at: item.at,
});

export const agentItemToRow = (connectionId: string, item: AgentItem): TranscriptItemRow => ({
  connectionId,
  kind: 'agent',
  messageId: null,
  eventId: item.eventId,
  eventType: item.eventType,
  text: item.text,
  files: [...item.files],
  sendState: null,
  at: item.at,
});

export const queuedMessageIdsOf = (queue: readonly ComposeQueueRow[]): ReadonlySet<string> =>
  new Set(queue.map((row) => row.messageId));
