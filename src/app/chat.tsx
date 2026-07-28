/**
 * Chat tab (stage 4): transcript over the live REST+SSE round-trip.
 *
 * Thin UI over the tested pure logic (transcript reducer, SSE client,
 * markdown splitter) — jest's node environment cannot render FlashList, so
 * everything decision-shaped lives in src/chat/ and src/api/ and is unit
 * tested there. Capability gating is unchanged from stage 3.
 */

import { FlashList } from '@shopify/flash-list';
import { useState } from 'react';
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
import { markdownToBlocks } from '@/chat/markdown';
import { type TranscriptItem, transcriptItemKey } from '@/chat/transcript';
import { useChatSession } from '@/chat/use-chat-session';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { CAPABILITY_CHAT, gateCapability } from '@/connections/capabilities';
import { useActiveConnection } from '@/connections/connections-context';

export default function ChatScreen() {
  const active = useActiveConnection();
  const gate = gateCapability(active, CAPABILITY_CHAT);
  const { items, streamState, send, retry } = useChatSession(gate === 'available' ? active : null);
  const [draft, setDraft] = useState('');

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            <Text style={styles.emptyText}>Say hello — replies arrive over the event stream.</Text>
          </View>
        }
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message the agent…"
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
  );
}

/** Connection-state banner driven by the SSE stream state. */
function StreamBanner({ state }: { state: StreamState }) {
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
  if (item.kind === 'user') {
    const failed = item.sendState === 'failed';
    return (
      <Pressable
        style={[styles.bubble, styles.userBubble, failed && styles.failedBubble]}
        onPress={failed ? () => void onRetry(item.messageId) : undefined}
        testID={`chat-item-user-${item.messageId}`}
      >
        <Text style={styles.userText}>{item.text}</Text>
        <Text style={styles.meta}>
          {item.sendState === 'sending' && 'Sending…'}
          {item.sendState === 'accepted' && 'Accepted'}
          {failed && 'Failed — tap to retry'}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={[styles.bubble, styles.agentBubble]} testID={`chat-item-agent-${item.eventId}`}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  banner: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  bannerConnected: {
    backgroundColor: '#dcfce7',
  },
  bannerReconnecting: {
    backgroundColor: '#fef9c3',
  },
  bannerOffline: {
    backgroundColor: '#fee2e2',
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.8,
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
    opacity: 0.6,
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
    backgroundColor: '#2563eb',
  },
  failedBubble: {
    backgroundColor: '#b91c1c',
  },
  agentBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
  },
  userText: {
    color: '#fff',
    fontSize: 15,
  },
  agentText: {
    fontSize: 15,
    marginBottom: 6,
  },
  codeBlock: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    backgroundColor: '#f3f4f6',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  noticeTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b45309',
  },
  meta: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
  },
  agentMeta: {
    fontSize: 11,
    opacity: 0.6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#9ca3af',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
