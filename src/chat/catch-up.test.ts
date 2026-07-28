/**
 * Unit: outbox catch-up pagination — ascending pages, next cursor = last
 * event id (the single-cursor invariant), short/empty page terminates, and
 * every event flows through the SAME reducer/dedup path as live SSE so
 * replaying an applied page is a no-op.
 */

import type { EventEnvelope } from 'agent-app-contract/types';
import type { OutboxPage } from '../api/client';
import { runCatchUp } from './catch-up';
import { emptyTranscript, type TranscriptState, transcriptReducer } from './transcript';

const envelope = (id: number): EventEnvelope => ({
  schema: 1,
  id,
  type: 'reply',
  at: '2026-07-27T00:00:00.000Z',
  payload: { schema: 1, text: `event ${id}`, files: [] },
});

/** A fake agent outbox that caps pages at `cap`, like a real agent MAY. */
const pagedServer = (eventIds: number[], cap: number) => {
  const events = eventIds.map(envelope);
  const calls: Array<number | null> = [];
  const fetchPage = async (after: number | null): Promise<OutboxPage> => {
    calls.push(after);
    const start = after ?? 0;
    return { schema: 1, events: events.filter((e) => e.id > start).slice(0, cap) };
  };
  return { fetchPage, calls };
};

describe('runCatchUp', () => {
  it('pages ascending with the last event id as the next cursor, terminating on the short page', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    const server = pagedServer(ids, 5);
    const applied: number[] = [];

    const cursor = await runCatchUp({
      after: null,
      fetchPage: server.fetchPage,
      apply: (e) => applied.push(e.id),
    });

    expect(applied).toEqual(ids); // every event, ascending, exactly once
    expect(cursor).toBe(12);
    // Pages [5, 5, 2]: the 2-event page is SHORT (< the server's observed
    // cap), so it terminates — no fourth fetch for an empty page.
    expect(server.calls).toEqual([null, 5, 10]);
  });

  it('a boundary-aligned backlog terminates on the empty page (client cannot know the cap)', async () => {
    const server = pagedServer([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);

    const cursor = await runCatchUp({ after: null, fetchPage: server.fetchPage, apply: () => {} });

    expect(cursor).toBe(10);
    expect(server.calls).toEqual([null, 5, 10]); // last fetch returned []
  });

  it('already caught up: one fetch, no events applied, cursor unchanged', async () => {
    const server = pagedServer([1, 2, 3], 5);
    const applied: number[] = [];

    const cursor = await runCatchUp({
      after: 3,
      fetchPage: server.fetchPage,
      apply: (e) => applied.push(e.id),
    });

    expect(applied).toEqual([]);
    expect(cursor).toBe(3);
    expect(server.calls).toEqual([3]);
  });

  it('resumes strictly after the given cursor', async () => {
    const server = pagedServer([1, 2, 3, 4, 5], 10);
    const applied: number[] = [];

    const cursor = await runCatchUp({
      after: 2,
      fetchPage: server.fetchPage,
      apply: (e) => applied.push(e.id),
    });

    expect(applied).toEqual([3, 4, 5]);
    expect(cursor).toBe(5);
  });

  it('events flow through the reducer path; replaying an applied page is a no-op', async () => {
    const server = pagedServer([1, 2, 3], 5);
    let state: TranscriptState = emptyTranscript;
    const apply = (e: EventEnvelope) => {
      state = transcriptReducer(state, { type: 'event', envelope: e });
    };

    await runCatchUp({ after: null, fetchPage: server.fetchPage, apply });
    expect(state.items).toHaveLength(3);
    const applied = state;

    // Replay from the OLD cursor — e.g. an overlapping catch-up after a
    // reconnect. Same dedup set, so the state must not move at all.
    await runCatchUp({ after: null, fetchPage: server.fetchPage, apply });
    expect(state).toBe(applied);
  });

  it('a misbehaving server that never returns a short page cannot loop forever', async () => {
    // Always claims one more event, ids forever ascending.
    let calls = 0;
    const fetchPage = async (after: number | null): Promise<OutboxPage> => {
      calls += 1;
      const next = (after ?? 0) + 1;
      return { schema: 1, events: [envelope(next)] };
    };

    await runCatchUp({ after: null, fetchPage, apply: () => {} });

    expect(calls).toBeLessThanOrEqual(200); // MAX_CATCH_UP_PAGES ceiling
  });
});
