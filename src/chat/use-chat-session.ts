/**
 * Chat session hook: wires the tested pure pieces — transcript reducer, SSE
 * stream client, InboundMessage builder, and (stage 9) the durable-chat
 * facade — to the active connection and the React lifecycle. Deliberately
 * thin: everything with logic worth testing lives in the pure modules,
 * because jest's node environment does not render components.
 *
 * - Stream lifecycle: foreground-only, same AppState gating pattern as the
 *   stage-3 health poller. Backgrounding stops the stream; foregrounding
 *   reconnects with the Last-Event-ID cursor.
 * - Durability (stage 9, behind transcriptPersistenceEnabled): hydration on
 *   connection activation (newest 500 rows + seenEventIds reconstruction),
 *   write-through persistence as a SUBSCRIBER over the pure reducer, outbox
 *   catch-up on session start / foreground / SSE reconnect (same reducer +
 *   dedup path as live SSE), the persisted cursor seeding initialLastEventId,
 *   and the offline compose queue draining on reconnect/foreground. Flag OFF
 *   restores stage-4 in-memory behavior exactly (the facade never touches
 *   the store).
 * - Tokens: fetched via ActiveConnection.getToken() at call/connect time,
 *   never held in state and never part of transcript, stream, or ROW state.
 * - Send: optimistic insert → POST → accepted on 202 / QUEUED when the agent
 *   is unreachable (network error; drain re-POSTs the ORIGINAL messageId) /
 *   failed otherwise; retry re-POSTs with the SAME messageId (invariant 5).
 */

import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiClientError, getOutbox, postMessage } from '../api/client';
import { createEventStream, type EventStream, type StreamState } from '../api/events';
import { TRANSCRIPT_PERSISTENCE_ENABLED } from '../config/transcript-persistence';
import type { ActiveConnection } from '../connections/connections-context';
import { shouldPoll } from '../connections/health';
import { runCatchUp } from './catch-up';
import { createDurableChat, type DurableChat } from './durable-chat';
import { buildInboundMessage } from './inbound';
import { OWNER_PERSON_ID } from './person-id';
import { getSqliteChatStore } from './sqlite-chat-store';
import {
  emptyTranscript,
  type TranscriptAction,
  type TranscriptItem,
  type TranscriptState,
  transcriptReducer,
} from './transcript';

export interface ChatSession {
  items: readonly TranscriptItem[];
  streamState: StreamState;
  /** Optimistic send; resolves when the POST settles either way. */
  send: (text: string) => Promise<void>;
  /** Re-send a failed item with its ORIGINAL messageId. */
  retry: (messageId: string) => Promise<void>;
}

export const useChatSession = (active: ActiveConnection | null): ChatSession => {
  const [state, setState] = useState<TranscriptState>(emptyTranscript);
  const [streamState, setStreamState] = useState<StreamState>('offline');
  // Authoritative transcript, advanced SYNCHRONOUSLY in apply() so that the
  // write-through subscriber sees every prev→next transition even when
  // several events land before React re-renders (useReducer could not give
  // the subscriber a race-free prev). React state mirrors it for rendering.
  const stateRef = useRef<TranscriptState>(emptyTranscript);
  const lastEventIdRef = useRef<number | null>(null);
  const durableRef = useRef<DurableChat | null>(null);
  const hydrationRef = useRef<Promise<void>>(Promise.resolve());

  const activeId = active?.id ?? null;
  const baseUrl = active?.baseUrl ?? null;
  const getToken = active?.getToken ?? null;

  /** Dispatch through the pure reducer, then hand the transition to the
   * durable subscriber. The reducer itself stays persistence-free. */
  const apply = useCallback((action: TranscriptAction): void => {
    const prev = stateRef.current;
    const next = transcriptReducer(prev, action);
    stateRef.current = next;
    durableRef.current?.handle(action, prev, next);
    if (next !== prev) setState(next);
  }, []);

  // The transcript and resume cursor belong to ONE agent conversation: reset
  // on switch, then hydrate this connection's durable history + cursor.
  useEffect(() => {
    stateRef.current = emptyTranscript;
    setState(emptyTranscript);
    lastEventIdRef.current = null;
    durableRef.current =
      activeId === null
        ? null
        : createDurableChat({
            enabled: TRANSCRIPT_PERSISTENCE_ENABLED,
            connectionId: activeId,
            storeFactory: getSqliteChatStore,
          });
    const durable = durableRef.current;
    const base = stateRef.current;
    let cancelled = false;
    hydrationRef.current = (async () => {
      if (durable === null) return;
      try {
        const hydrated = await durable.hydrate();
        if (cancelled || hydrated === null) return;
        // Install only if nothing was applied meanwhile (a send racing the
        // hydration read keeps the fresher in-memory state).
        if (stateRef.current !== base) return;
        stateRef.current = hydrated.state;
        lastEventIdRef.current = hydrated.lastEventId;
        setState(hydrated.state);
      } catch {
        // Hydration failure degrades to the stage-4 empty session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    if (activeId === null || baseUrl === null || getToken === null) {
      setStreamState('offline');
      return;
    }

    let cancelled = false;
    let stream: EventStream | null = null;
    let starting = false;
    let catchingUp = false;
    let draining = false;

    const connection = async () => {
      const token = await getToken();
      if (token === null) throw new Error('token missing from vault');
      return { baseUrl, token };
    };

    // Outbox catch-up: same reducer + dedup path as live SSE; the final
    // cursor becomes BOTH the persisted cursor and the Last-Event-ID seed.
    const catchUpOnce = async () => {
      const durable = durableRef.current;
      if (durable === null || !durable.enabled || catchingUp) return;
      catchingUp = true;
      try {
        const conn = await connection();
        const cursor = await runCatchUp({
          after: lastEventIdRef.current,
          fetchPage: (after) => getOutbox(conn, after),
          apply: (envelope) => {
            if (cancelled) return;
            lastEventIdRef.current = envelope.id;
            apply({ type: 'event', envelope });
          },
        });
        if (!cancelled && cursor !== null) {
          lastEventIdRef.current = cursor;
          durable.saveCursor(cursor);
        }
      } catch {
        // Unreachable/refused: the stream's reconnect ladder owns retries;
        // the next successful connect re-runs catch-up.
      } finally {
        catchingUp = false;
      }
    };

    // Drain the offline compose queue: original messageIds, queued_at order.
    const drainOnce = async () => {
      const durable = durableRef.current;
      if (durable === null || !durable.enabled || draining) return;
      draining = true;
      try {
        const conn = await connection();
        await durable.drain({
          personId: OWNER_PERSON_ID,
          newUuid: randomUUID,
          post: (message) => postMessage(conn, message),
          onSending: (row) => {
            if (!cancelled)
              apply({ type: 'send', messageId: row.messageId, text: row.text, at: row.queuedAt });
          },
          onAccepted: (messageId) => {
            if (!cancelled) apply({ type: 'send-accepted', messageId });
          },
          onFailed: (messageId) => {
            if (!cancelled) apply({ type: 'send-failed', messageId });
          },
          onUnreachable: (messageId) => {
            if (!cancelled) apply({ type: 'send-queued', messageId });
          },
        });
      } catch {
        // Token/store trouble: rows stay queued for the next drain trigger.
      } finally {
        draining = false;
      }
    };

    const start = () => {
      if (stream !== null || starting || cancelled) return;
      starting = true;
      void (async () => {
        try {
          // Session start / foreground: hydration first (it seeds the
          // cursor), then catch-up, then drain — all flag-gated no-ops
          // when persistence is disabled.
          await hydrationRef.current;
          await catchUpOnce();
          await drainOnce();
        } finally {
          starting = false;
        }
        if (cancelled || stream !== null) return;
        if (!shouldPoll(AppState.currentState, true)) return; // backgrounded meanwhile
        stream = createEventStream({
          baseUrl,
          getToken,
          fetchImpl: expoFetch,
          initialLastEventId: lastEventIdRef.current,
          onEvent: (envelope) => {
            lastEventIdRef.current = envelope.id;
            if (!cancelled) apply({ type: 'event', envelope });
          },
          onStateChange: (next) => {
            if (cancelled) return;
            setStreamState(next);
            if (next === 'connected') {
              // SSE (re)connect: recover anything the outage skipped and
              // release queued sends. Shared dedup makes overlap a no-op.
              void catchUpOnce().then(drainOnce);
            }
          },
        });
      })();
    };
    const stop = () => {
      if (stream !== null) {
        lastEventIdRef.current = stream.getLastEventId();
        durableRef.current?.saveCursor(lastEventIdRef.current);
        stream.stop();
        stream = null;
      }
    };

    const applyAppState = (appState: string) => {
      // Reuse the stage-3 gate: stream only while foregrounded.
      if (shouldPoll(appState, true)) start();
      else stop();
    };
    applyAppState(AppState.currentState);
    const subscription = AppState.addEventListener('change', applyAppState);

    return () => {
      cancelled = true;
      stop();
      subscription.remove();
    };
  }, [activeId, baseUrl, getToken, apply]);

  const post = useCallback(
    async (messageId: string, text: string) => {
      if (baseUrl === null || getToken === null) return;
      const message = buildInboundMessage(
        { text, personId: OWNER_PERSON_ID, messageId },
        { newUuid: randomUUID },
      );
      apply({ type: 'send', messageId, text, at: message.receivedAt });
      try {
        const token = await getToken();
        if (token === null) throw new Error('token missing from vault');
        await postMessage({ baseUrl, token }, message);
        apply({ type: 'send-accepted', messageId });
      } catch (err) {
        // Unreachable agent (network error) → offline compose queue; any
        // other failure (auth, http, shape) → the stage-4 failed/retry path.
        // With the flag OFF enqueue() refuses, so failed is also the
        // fallback — exactly stage-4 behavior.
        const durable = durableRef.current;
        const unreachable = err instanceof ApiClientError && err.kind === 'network';
        const queued =
          unreachable &&
          durable !== null &&
          (await durable.enqueue({
            messageId,
            text,
            attachments: [],
            queuedAt: message.receivedAt,
          }));
        apply(queued ? { type: 'send-queued', messageId } : { type: 'send-failed', messageId });
      }
    },
    [baseUrl, getToken, apply],
  );

  const send = useCallback((text: string) => post(randomUUID(), text), [post]);

  const retry = useCallback(
    async (messageId: string) => {
      const item = stateRef.current.items.find(
        (i): i is Extract<TranscriptItem, { kind: 'user' }> =>
          i.kind === 'user' && i.messageId === messageId,
      );
      if (item === undefined || item.sendState !== 'failed') return;
      await post(item.messageId, item.text);
    },
    [post],
  );

  return { items: state.items, streamState, send, retry };
};
