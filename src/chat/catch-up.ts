/**
 * Outbox catch-up pagination (stage 9): page GET /app/v1/outbox?after=<cursor>
 * until caught up, feeding every envelope through the SAME reducer/dedup path
 * as live SSE (the shared `seenEventIds` set is what makes the catch-up ↔
 * stream overlap window safe — replaying an applied event is a no-op).
 *
 * Contract semantics (schemas/v1/outbox-page.json): events come back ascending
 * and strictly after the cursor; there is deliberately NO second cursor field —
 * the next cursor IS the last event's `id`; a short or empty page means caught
 * up. The client cannot request a page size, so "short" is judged against the
 * server's own cap as observed in this run: a page smaller than the largest
 * page already seen cannot be a capped page, hence terminal. An empty page is
 * always terminal. (A server that returns everything in one page costs one
 * extra empty-page fetch — correct, just not clever.)
 */

import type { EventEnvelope } from 'agent-app-contract/types';
import type { OutboxPage } from '../api/client';

/** Hard ceiling so a misbehaving server can never loop us forever. */
const MAX_CATCH_UP_PAGES = 200;

export interface CatchUpOptions {
  /** Cursor to resume from — the persisted/last-seen event id; null = start. */
  after: number | null;
  /** One page fetch — production binds getOutbox(connection, after). */
  fetchPage: (after: number | null) => Promise<OutboxPage>;
  /** Applied per event, ascending — production dispatches { type: 'event' }. */
  apply: (envelope: EventEnvelope) => void;
}

/** Returns the final cursor: the last event id seen (or `after` unchanged when
 * already caught up). The caller hands it to BOTH the cursor store and the
 * stream's Last-Event-ID seed — one cursor concept, contract invariant 2. */
export const runCatchUp = async (options: CatchUpOptions): Promise<number | null> => {
  let cursor = options.after;
  let largestPage = 0;
  for (let fetched = 0; fetched < MAX_CATCH_UP_PAGES; fetched += 1) {
    const page = await options.fetchPage(cursor);
    for (const envelope of page.events) {
      options.apply(envelope);
    }
    if (page.events.length > 0) {
      // Ascending order is contractual: the last element's id IS the cursor.
      cursor = page.events[page.events.length - 1].id;
    }
    if (page.events.length === 0 || page.events.length < largestPage) {
      return cursor; // short/empty page: caught up
    }
    largestPage = Math.max(largestPage, page.events.length);
  }
  return cursor;
};
