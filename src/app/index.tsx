/**
 * Chat tab (stage 4): transcript over the live REST+SSE round-trip.
 *
 * Thin UI over the tested pure logic (transcript reducer, SSE client,
 * markdown splitter) — jest's node environment cannot render FlashList, so
 * everything decision-shaped lives in src/chat/ and src/api/ and is unit
 * tested there. Capability gating is unchanged from stage 3.
 */

import { FlashList } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { StreamState } from '@/api/events';
import { copyTextForItem, isCopyable } from '@/chat/copy';
import { markdownToBlocks } from '@/chat/markdown';
import { type TranscriptItem, transcriptItemKey } from '@/chat/transcript';
import { useChatSession } from '@/chat/use-chat-session';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { CAPABILITY_CHAT, gateCapability } from '@/connections/capabilities';
import { useActiveConnection } from '@/connections/connections-context';
import { usePalette } from '@/theme/theme-context';
import type { Palette } from '@/theme/tokens';

export default function ChatScreen() {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const active = useActiveConnection();
  const gate = gateCapability(active, CAPABILITY_CHAT);
  const { items, streamState, send, retry } = useChatSession(gate === 'available' ? active : null);
  const [draft, setDraft] = useState('');
  // Issue #13 audit: same defect class as the connection form. Under SDK 57
  // edge-to-edge (forced on Android 15+) the window does not resize for the
  // keyboard, so `behavior=undefined` on Android did nothing and the keyboard
  // covered the composer. "padding" needs the screen's real distance from the
  // window top: KeyboardAvoidingView measures its own frame parent-relative,
  // which misses the tabs header above this screen — measured here and passed
  // as keyboardVerticalOffset.
  const containerRef = useRef<View>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const measureOffset = () => {
    containerRef.current?.measureInWindow((_x, y) => {
      setKeyboardOffset((prev) => (prev === y ? prev : y));
    });
  };

  if (gate === 'no-active-connection') {
    return (
      <PlaceholderScreen title="Chat" subtitle="Add and activate a connection to start chatting." />
    );
  }
  if (gate === 'unsupported') {
    return <PlaceholderScreen title="Chat" subtitle="Not available for this agent." />;
  }

  const canSend = draft.trim().length > 0;
  const onSend = () => {
    const text = draft.trim();
    if (text.length === 0) return;
    setDraft('');
    void send(text);
  };

  return (
    <View ref={containerRef} collapsable={false} style={styles.container} onLayout={measureOffset}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior="padding"
        keyboardVerticalOffset={keyboardOffset}
      >
        <StreamBanner state={streamState} />
        <FlashList
          data={items as TranscriptItem[]}
          keyExtractor={transcriptItemKey}
          renderItem={({ item }) => <TranscriptRow item={item} onRetry={retry} />}
          // Chat layout: chronological data, rendering anchored at the bottom so
          // the newest message sits above the composer (FlashList v2's
          // replacement for the v1 `inverted` pattern).
          maintainVisibleContentPosition={{
            autoscrollToBottomThreshold: 0.2,
            startRenderingFromBottom: true,
          }}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Say hello — replies arrive over the event stream.
              </Text>
            </View>
          }
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the agent…"
            placeholderTextColor={palette.textMuted}
            multiline
            testID="chat-input"
          />
          <Pressable
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={onSend}
            disabled={!canSend}
            testID="chat-send"
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Connection-state banner driven by the SSE stream state. */
function StreamBanner({ state }: { state: StreamState }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const style =
    state === 'connected'
      ? styles.bannerConnected
      : state === 'reconnecting'
        ? styles.bannerReconnecting
        : styles.bannerOffline;
  const label =
    state === 'connected' ? 'Connected' : state === 'reconnecting' ? 'Reconnecting…' : 'Offline';
  return (
    <View style={[styles.banner, style]} testID="stream-banner">
      <Text style={styles.bannerText}>{label}</Text>
    </View>
  );
}

function TranscriptRow({
  item,
  onRetry,
}: {
  item: TranscriptItem;
  onRetry: (messageId: string) => Promise<void>;
}) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The "Copied" flag clears itself, so the timer must be cancelled on unmount
  // — a transcript row is unmounted routinely as the list virtualises, and a
  // stray timer would setState on a dead component.
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // Long-press to copy (stage 12). The affordance is inert for an empty
  // message rather than silently putting nothing on the clipboard.
  const copy = useCallback(() => {
    if (!isCopyable(item)) return;
    void Clipboard.setStringAsync(copyTextForItem(item));
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, 1500);
  }, [item]);

  if (item.kind === 'user') {
    const failed = item.sendState === 'failed';
    return (
      <Pressable
        style={[styles.bubble, styles.userBubble, failed && styles.failedBubble]}
        onPress={failed ? () => void onRetry(item.messageId) : undefined}
        onLongPress={copy}
        delayLongPress={350}
        testID={`chat-item-user-${item.messageId}`}
      >
        <Text style={styles.userText}>{item.text}</Text>
        <Text style={styles.meta}>
          {copied && 'Copied'}
          {!copied && item.sendState === 'sending' && 'Sending…'}
          {!copied && item.sendState === 'accepted' && 'Accepted'}
          {!copied && item.sendState === 'queued' && 'Queued — sends when reconnected'}
          {!copied && failed && 'Failed — tap to retry'}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      style={[styles.bubble, styles.agentBubble]}
      onLongPress={copy}
      delayLongPress={350}
      testID={`chat-item-agent-${item.eventId}`}
    >
      {copied && <Text style={styles.copiedTag}>Copied</Text>}
      {item.eventType === 'notice' && <Text style={styles.noticeTag}>Notice</Text>}
      {markdownToBlocks(item.text).map((block, index) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks are a pure, immutable derivation of item.text — they never reorder or mutate independently, so the index is a stable key.
          key={`${item.eventId}-${index}`}
          style={block.kind === 'code' ? styles.codeBlock : styles.agentText}
        >
          {block.text}
        </Text>
      ))}
      {item.files.length > 0 && (
        <Text style={styles.agentMeta}>{item.files.length} attachment(s)</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    banner: {
      paddingVertical: 4,
      alignItems: 'center',
    },
    bannerConnected: {
      backgroundColor: palette.successSurface,
    },
    bannerReconnecting: {
      backgroundColor: palette.warnSurface,
    },
    bannerOffline: {
      backgroundColor: palette.dangerSurface,
    },
    bannerText: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.text,
    },
    listContent: {
      padding: 12,
    },
    empty: {
      padding: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: palette.textMuted,
      textAlign: 'center',
    },
    bubble: {
      maxWidth: '85%',
      borderRadius: 12,
      padding: 10,
      marginVertical: 4,
      gap: 4,
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: palette.accent,
    },
    failedBubble: {
      backgroundColor: palette.danger,
    },
    agentBubble: {
      alignSelf: 'flex-start',
      backgroundColor: palette.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
    },
    userText: {
      color: palette.textInverse,
      fontSize: 15,
    },
    agentText: {
      fontSize: 15,
      marginBottom: 6,
      color: palette.text,
    },
    codeBlock: {
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      color: palette.text,
      backgroundColor: palette.surfaceMuted,
      borderRadius: 6,
      padding: 8,
      marginBottom: 6,
    },
    noticeTag: {
      fontSize: 11,
      fontWeight: '700',
      color: palette.warn,
    },
    copiedTag: {
      fontSize: 11,
      fontWeight: '700',
      color: palette.accent,
    },
    meta: {
      fontSize: 11,
      color: palette.textInverse,
      opacity: 0.8,
    },
    agentMeta: {
      fontSize: 11,
      color: palette.textMuted,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      padding: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
      backgroundColor: palette.surface,
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.borderStrong,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 15,
      color: palette.text,
    },
    sendButton: {
      backgroundColor: palette.accent,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    sendButtonDisabled: {
      opacity: 0.4,
    },
    sendButtonText: {
      color: palette.textInverse,
      fontWeight: '600',
      fontSize: 15,
    },
  });
