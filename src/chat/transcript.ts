/**
 * Transcript store (stage 4) — pure reducer, in-memory ONLY.
 *
 * Scope guard from the stage spec: NO persistence, NO offline compose queue,
 * NO cross-restart /outbox catch-up — those belong to the durability stage.
 * This holds one session's ordered conversation:
 *
 * - user items: optimistic insert on send, state sending → accepted (202 or
 *   `ack` event) / failed (send error) with a retry affordance that KEEPS the
 *   messageId (the dedup key — contract invariant 5 makes the re-POST safe).
 * - agent items: `reply` / `notice` envelopes appended in stream order.
 *
 * Dedup, both required by in-session Last-Event-ID resume (the overlap window
 * must not duplicate) and idempotent acks:
 * - by envelope id for every event (`seenEventIds`);
 * - by messageId for acks (marking accepted twice is a no-op).
 */

import type { EventEnvelope } from 'agent-app-contract/types';

export type SendState = 'sending' | 'accepted' | 'failed';

export interface UserItem {
  kind: 'user';
  /** Client-generated UUID — the dedup key; survives retries. */
  messageId: string;
  text: string;
  sendState: SendState;
  /** ISO-8601 — the receivedAt sent on the wire. Display only. */
  at: string;
}

export interface AgentItem {
  kind: 'agent';
  /** Envelope id — the outbox cursor; the dedup key for agent items. */
  eventId: number;
  eventType: 'reply' | 'notice';
  /** Markdown body (AssistantReply.text). */
  text: string;
  files: readonly string[];
  /** ISO-8601 envelope `at`. Display only — ordering is arrival order. */
  at: string;
}

export type TranscriptItem = UserItem | AgentItem;

export interface TranscriptState {
  items: readonly TranscriptItem[];
  /** Envelope ids already applied — resume-overlap dedup. */
  seenEventIds: ReadonlySet<number>;
}

export const emptyTranscript: TranscriptState = { items: [], seenEventIds: new Set() };

export type TranscriptAction =
  /** Optimistic insert (or re-send of an existing failed item — same id). */
  | { type: 'send'; messageId: string; text: string; at: string }
  /** POST returned 202 { ok, messageId }. */
  | { type: 'send-accepted'; messageId: string }
  /** POST rejected (network / non-202 / bad shape). */
  | { type: 'send-failed'; messageId: string }
  /** A known-type envelope from the event stream (ack | reply | notice). */
  | { type: 'event'; envelope: EventEnvelope }
  /** Active connection changed — the session transcript belongs to one agent. */
  | { type: 'reset' };

const setSendState = (
  items: readonly TranscriptItem[],
  messageId: string,
  sendState: SendState,
  /** States allowed to transition FROM (an ack must not resurrect a retry). */
  from: readonly SendState[],
): readonly TranscriptItem[] => {
  let changed = false;
  const next = items.map((item) => {
    if (item.kind !== 'user' || item.messageId !== messageId) return item;
    if (item.sendState === sendState || !from.includes(item.sendState)) return item;
    changed = true;
    return { ...item, sendState };
  });
  return changed ? next : items;
};

const isAssistantReplyPayload = (
  payload: Record<string, unknown>,
): payload is { schema: 1; text: string; files: string[] } =>
  payload.schema === 1 &&
  typeof payload.text === 'string' &&
  Array.isArray(payload.files) &&
  payload.files.every((f) => typeof f === 'string');

const applyEvent = (state: TranscriptState, envelope: EventEnvelope): TranscriptState => {
  // Dedup by envelope id: a Last-Event-ID resume may overlap, and replaying
  // an applied event must be a no-op.
  if (state.seenEventIds.has(envelope.id)) return state;
  const seenEventIds = new Set(state.seenEventIds).add(envelope.id);

  switch (envelope.type) {
    case 'ack': {
      const messageId = envelope.payload.messageId;
      if (typeof messageId !== 'string') return { ...state, seenEventIds };
      return {
        // An ack confirms acceptance — it upgrades 'sending' (202 lost in a
        // retry race) but must not overwrite a NEWER failed retry attempt.
        items: setSendState(state.items, messageId, 'accepted', ['sending', 'accepted']),
        seenEventIds,
      };
    }
    case 'reply':
    case 'notice': {
      const payload = envelope.payload;
      if (!isAssistantReplyPayload(payload)) return { ...state, seenEventIds };
      const item: AgentItem = {
        kind: 'agent',
        eventId: envelope.id,
        eventType: envelope.type,
        text: payload.text,
        files: payload.files,
        at: envelope.at,
      };
      return { items: [...state.items, item], seenEventIds };
    }
    default:
      // Unknown event type: additive-contract tolerance — record the id (it
      // advanced the cursor) and change nothing else.
      return { ...state, seenEventIds };
  }
};

export const transcriptReducer = (
  state: TranscriptState,
  action: TranscriptAction,
): TranscriptState => {
  switch (action.type) {
    case 'send': {
      const existing = state.items.some(
        (item) => item.kind === 'user' && item.messageId === action.messageId,
      );
      if (existing) {
        // Retry keeps the item in place and its dedup key intact.
        return {
          ...state,
          items: setSendState(state.items, action.messageId, 'sending', ['failed', 'sending']),
        };
      }
      const item: UserItem = {
        kind: 'user',
        messageId: action.messageId,
        text: action.text,
        sendState: 'sending',
        at: action.at,
      };
      return { ...state, items: [...state.items, item] };
    }
    case 'send-accepted':
      return {
        ...state,
        items: setSendState(state.items, action.messageId, 'accepted', ['sending', 'accepted']),
      };
    case 'send-failed':
      // Only a pending send can fail; an already-accepted item stays accepted.
      return {
        ...state,
        items: setSendState(state.items, action.messageId, 'failed', ['sending']),
      };
    case 'event':
      return applyEvent(state, action.envelope);
    case 'reset':
      return emptyTranscript;
  }
};

/** Stable list key for FlashList. */
export const transcriptItemKey = (item: TranscriptItem): string =>
  item.kind === 'user' ? `user-${item.messageId}` : `agent-${item.eventId}`;
