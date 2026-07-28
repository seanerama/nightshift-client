/**
 * Chat session hook (stage 4): wires the tested pure pieces — transcript
 * reducer, SSE stream client, InboundMessage builder — to the active
 * connection and the React lifecycle. Deliberately thin: everything with
 * logic worth testing lives in the pure modules, because jest's node
 * environment does not render components.
 *
 * - Stream lifecycle: foreground-only, same AppState gating pattern as the
 *   stage-3 health poller. Backgrounding stops the stream; foregrounding
 *   reconnects with the in-session Last-Event-ID cursor (kept in a ref, NOT
 *   persisted — cross-restart catch-up is the durability stage).
 * - Tokens: fetched via ActiveConnection.getToken() at call/connect time,
 *   never held in state and never part of transcript or stream state.
 * - Send: optimistic insert → POST → accepted on 202 / failed on error;
 *   retry re-POSTs with the SAME messageId (dedup key, invariant 5).
 */

import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { postMessage } from '../api/client';
import { createEventStream, type EventStream, type StreamState } from '../api/events';
import type { ActiveConnection } from '../connections/connections-context';
import { shouldPoll } from '../connections/health';
import { buildInboundMessage } from './inbound';
import { OWNER_PERSON_ID } from './person-id';
import { emptyTranscript, type TranscriptItem, transcriptReducer } from './transcript';

export interface ChatSession {
  items: readonly TranscriptItem[];
  streamState: StreamState;
  /** Optimistic send; resolves when the POST settles either way. */
  send: (text: string) => Promise<void>;
  /** Re-send a failed item with its ORIGINAL messageId. */
  retry: (messageId: string) => Promise<void>;
}

export const useChatSession = (active: ActiveConnection | null): ChatSession => {
  const [state, dispatch] = useReducer(transcriptReducer, emptyTranscript);
  const [streamState, setStreamState] = useState<StreamState>('offline');
  const lastEventIdRef = useRef<number | null>(null);
  // Ref mirror so retry() reads the latest transcript without re-binding.
  const stateRef = useRef(state);
  stateRef.current = state;

  const activeId = active?.id ?? null;
  const baseUrl = active?.baseUrl ?? null;
  const getToken = active?.getToken ?? null;

  // The transcript and resume cursor belong to ONE agent conversation.
  // biome-ignore lint/correctness/useExhaustiveDependencies(activeId): the effect is deliberately KEYED to the connection identity — it must re-run (and reset) when the active connection changes, even though the id value itself is unused inside.
  useEffect(() => {
    dispatch({ type: 'reset' });
    lastEventIdRef.current = null;
  }, [activeId]);

  useEffect(() => {
    if (activeId === null || baseUrl === null || getToken === null) {
      setStreamState('offline');
      return;
    }

    let cancelled = false;
    let stream: EventStream | null = null;

    const start = () => {
      if (stream !== null || cancelled) return;
      stream = createEventStream({
        baseUrl,
        getToken,
        fetchImpl: expoFetch,
        initialLastEventId: lastEventIdRef.current,
        onEvent: (envelope) => {
          lastEventIdRef.current = envelope.id;
          if (!cancelled) dispatch({ type: 'event', envelope });
        },
        onStateChange: (next) => {
          if (!cancelled) setStreamState(next);
        },
      });
    };
    const stop = () => {
      if (stream !== null) {
        lastEventIdRef.current = stream.getLastEventId();
        stream.stop();
        stream = null;
      }
    };

    const apply = (appState: string) => {
      // Reuse the stage-3 gate: stream only while foregrounded.
      if (shouldPoll(appState, true)) start();
      else stop();
    };
    apply(AppState.currentState);
    const subscription = AppState.addEventListener('change', apply);

    return () => {
      cancelled = true;
      stop();
      subscription.remove();
    };
  }, [activeId, baseUrl, getToken]);

  const post = useCallback(
    async (messageId: string, text: string) => {
      if (baseUrl === null || getToken === null) return;
      const message = buildInboundMessage(
        { text, personId: OWNER_PERSON_ID, messageId },
        { newUuid: randomUUID },
      );
      dispatch({ type: 'send', messageId, text, at: message.receivedAt });
      try {
        const token = await getToken();
        if (token === null) throw new Error('token missing from vault');
        await postMessage({ baseUrl, token }, message);
        dispatch({ type: 'send-accepted', messageId });
      } catch {
        dispatch({ type: 'send-failed', messageId });
      }
    },
    [baseUrl, getToken],
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
