/**
 * Unit: hydration mapping (stage 9) — persisted rows rebuild the exact
 * TranscriptState the reducer would have reached, including seenEventIds
 * reconstruction from agent rows, send-state revival rules, and tolerance
 * for malformed rows.
 */

import type { TranscriptItemRow } from './chat-store';
import { agentItemToRow, queuedMessageIdsOf, rowsToTranscript, userItemToRow } from './hydrate';
import { type SendState, transcriptReducer } from './transcript';

const CID = 'conn-1';

const userRow = (messageId: string, sendState: SendState, text = 'hi'): TranscriptItemRow => ({
  connectionId: CID,
  kind: 'user',
  messageId,
  eventId: null,
  eventType: null,
  text,
  files: [],
  sendState,
  at: '2026-07-27T00:00:00.000Z',
});

const agentRow = (
  eventId: number,
  eventType = 'reply',
  text = 'reply text',
  files: string[] = [],
): TranscriptItemRow => ({
  connectionId: CID,
  kind: 'agent',
  messageId: null,
  eventId,
  eventType,
  text,
  files,
  sendState: null,
  at: '2026-07-27T00:00:01.000Z',
});

describe('rowsToTranscript', () => {
  it('rebuilds items in row order and reconstructs seenEventIds from agent rows', () => {
    const state = rowsToTranscript(
      [userRow('m-1', 'accepted'), agentRow(4, 'reply'), agentRow(7, 'notice', 'heads up')],
      new Set(),
    );

    expect(state.items.map((i) => i.kind)).toEqual(['user', 'agent', 'agent']);
    expect(state.items[0]).toMatchObject({ messageId: 'm-1', sendState: 'accepted' });
    expect(state.items[1]).toMatchObject({ eventId: 4, eventType: 'reply' });
    expect(state.items[2]).toMatchObject({ eventId: 7, eventType: 'notice', text: 'heads up' });
    // The dedup set the resume-overlap window depends on:
    expect([...state.seenEventIds].sort((a, b) => a - b)).toEqual([4, 7]);
  });

  it('replaying an already-hydrated event through the reducer is a no-op (dedup survives restart)', () => {
    const state = rowsToTranscript([agentRow(4, 'reply', 'once')], new Set());

    const replayed = transcriptReducer(state, {
      type: 'event',
      envelope: {
        schema: 1,
        id: 4,
        type: 'reply',
        at: '2026-07-27T00:00:01.000Z',
        payload: { schema: 1, text: 'once', files: [] },
      },
    });

    expect(replayed.items).toHaveLength(1);
  });

  it('revives interrupted sends as failed (retryable) — never as a phantom "sending"', () => {
    const state = rowsToTranscript([userRow('m-1', 'sending')], new Set());
    expect(state.items[0]).toMatchObject({ sendState: 'failed' });
  });

  it('a message with a live queue row hydrates as queued; a stale queued state without one falls back to failed', () => {
    const state = rowsToTranscript(
      [userRow('m-1', 'queued'), userRow('m-2', 'queued'), userRow('m-3', 'sending')],
      new Set(['m-1', 'm-3']),
    );
    expect(state.items).toMatchObject([
      { messageId: 'm-1', sendState: 'queued' },
      { messageId: 'm-2', sendState: 'failed' },
      { messageId: 'm-3', sendState: 'queued' },
    ]);
  });

  it('failed and accepted states survive hydration unchanged', () => {
    const state = rowsToTranscript(
      [userRow('m-1', 'failed'), userRow('m-2', 'accepted')],
      new Set(),
    );
    expect(state.items).toMatchObject([{ sendState: 'failed' }, { sendState: 'accepted' }]);
  });

  it('skips malformed rows instead of throwing (one bad row must not brick the chat)', () => {
    const missingKeys: TranscriptItemRow[] = [
      { ...userRow('m-1', 'accepted'), messageId: null },
      { ...agentRow(4), eventId: null },
      agentRow(5, 'stream-chunk'), // types the transcript does not render
      agentRow(6, 'reply', 'kept'),
    ];
    const state = rowsToTranscript(missingKeys, new Set());
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ eventId: 6, text: 'kept' });
  });

  it('duplicate agent event ids collapse to the first row', () => {
    const state = rowsToTranscript(
      [agentRow(4, 'reply', 'first'), agentRow(4, 'reply', 'dupe')],
      new Set(),
    );
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ text: 'first' });
  });
});

describe('item → row mapping (write-through direction)', () => {
  it('round-trips a user item through row and back', () => {
    const row = userItemToRow(CID, {
      kind: 'user',
      messageId: 'm-9',
      text: 'round trip',
      sendState: 'queued',
      at: '2026-07-27T01:00:00.000Z',
    });
    expect(row).toMatchObject({ connectionId: CID, kind: 'user', messageId: 'm-9', eventId: null });

    const state = rowsToTranscript([row], new Set(['m-9']));
    expect(state.items[0]).toMatchObject({
      messageId: 'm-9',
      text: 'round trip',
      sendState: 'queued',
    });
  });

  it('round-trips an agent item through row and back, files included', () => {
    const row = agentItemToRow(CID, {
      kind: 'agent',
      eventId: 42,
      eventType: 'reply',
      text: 'with files',
      files: ['up_1', 'up_2'],
      at: '2026-07-27T01:00:00.000Z',
    });
    expect(row).toMatchObject({ kind: 'agent', eventId: 42, sendState: null, messageId: null });

    const state = rowsToTranscript([row], new Set());
    expect(state.items[0]).toMatchObject({ eventId: 42, files: ['up_1', 'up_2'] });
    expect(state.seenEventIds.has(42)).toBe(true);
  });
});

describe('queuedMessageIdsOf', () => {
  it('collects the queue rows into the id set hydration consumes', () => {
    const set = queuedMessageIdsOf([
      { messageId: 'a', connectionId: CID, text: 'x', attachments: [], queuedAt: 't1' },
      { messageId: 'b', connectionId: CID, text: 'y', attachments: [], queuedAt: 't2' },
    ]);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.size).toBe(2);
  });
});
