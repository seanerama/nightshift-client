/**
 * Offline compose-queue drain (stage 9): re-POST every queued message with its
 * ORIGINAL messageId, in queued_at order, when the link returns.
 *
 * Exactly-once convergence is the CONTRACT's job, not ours: re-POSTing a
 * messageId the agent has already seen is a 202 no-op (invariant 5 — the same
 * property stage-4 tap-to-retry leans on), so at-least-once delivery here
 * converges to exactly-once agent-side.
 *
 * Outcome per row:
 * - 202            → dequeue, report accepted;
 * - network error  → the link is still down: STOP the drain, keep this row
 *   and every later row queued (the next reconnect/foreground drains again);
 * - any other error (http/shape) → the agent SAW us and refused: dequeue and
 *   report failed — the item returns to the existing failed/tap-to-retry path.
 */

import type { InboundMessage } from 'agent-app-contract/types';

import { ApiClientError } from '../api/client';
import type { ChatStore, ComposeQueueRow } from './chat-store';
import { buildInboundMessage } from './inbound';

export interface DrainDeps {
  store: ChatStore;
  connectionId: string;
  /** Owner person id pinned on every InboundMessage (person-id.ts). */
  personId: string;
  /** POST /app/v1/messages, bound to the live connection. */
  post: (message: InboundMessage) => Promise<unknown>;
  /** UUID source for buildInboundMessage (unused for ids — every drain POST
   * reuses the row's original messageId — but required by the builder seam). */
  newUuid: () => string;
  /** UI hooks (transcript dispatches). All optional. */
  onSending?: (row: ComposeQueueRow) => void;
  onAccepted?: (messageId: string) => void;
  onFailed?: (messageId: string) => void;
  /** Fired for the row that hit a network error before the drain stopped. */
  onUnreachable?: (messageId: string) => void;
}

export interface DrainResult {
  accepted: string[];
  failed: string[];
  /** True when the drain stopped early because the agent was unreachable. */
  stoppedUnreachable: boolean;
}

export const drainComposeQueue = async (deps: DrainDeps): Promise<DrainResult> => {
  const result: DrainResult = { accepted: [], failed: [], stoppedUnreachable: false };
  const rows = await deps.store.listQueue(deps.connectionId);
  for (const row of rows) {
    deps.onSending?.(row);
    const message = buildInboundMessage(
      {
        text: row.text,
        personId: deps.personId,
        // The dedup key: SAME messageId as the original compose.
        messageId: row.messageId,
        attachments: row.attachments,
      },
      { newUuid: deps.newUuid },
    );
    try {
      await deps.post(message);
      await deps.store.dequeue(deps.connectionId, row.messageId);
      result.accepted.push(row.messageId);
      deps.onAccepted?.(row.messageId);
    } catch (err) {
      if (err instanceof ApiClientError && err.kind === 'network') {
        result.stoppedUnreachable = true;
        deps.onUnreachable?.(row.messageId);
        break; // still offline — keep the row (and the rest) for next time
      }
      await deps.store.dequeue(deps.connectionId, row.messageId);
      result.failed.push(row.messageId);
      deps.onFailed?.(row.messageId);
    }
  }
  return result;
};
