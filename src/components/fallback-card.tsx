/**
 * Mandatory fallback surface (ADR 0004 / contracts/ui-bridge.md): shown in
 * place of a resource WebView on load failure, bridge violation storm,
 * render crash, or resources/read failure. Renders the failure and the
 * underlying tool result (when one exists) as plain markdown via the
 * stage-4 splitter — a broken resource degrades, it never takes the app down.
 */

import { Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { markdownToBlocks } from '@/chat/markdown';
import { type FallbackReason, fallbackTitle } from '@/ui-bridge/fallback';

export function FallbackCard({
  reason,
  detail,
  lastToolResult,
}: {
  reason: FallbackReason;
  detail: string;
  /** Text of the most recent successful tools/call result, when any. */
  lastToolResult: string | null;
}) {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="apps-fallback"
    >
      <Text style={styles.title}>{fallbackTitle(reason)}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {lastToolResult !== null && (
        <>
          <Text style={styles.resultHeading}>Last result from the agent</Text>
          {markdownToBlocks(lastToolResult).map((block, index) => (
            <Text
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are a pure, immutable derivation of lastToolResult — stable by index.
              key={`fallback-${index}`}
              style={block.kind === 'code' ? styles.code : styles.paragraph}
            >
              {block.text}
            </Text>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#b91c1c',
  },
  detail: {
    fontSize: 14,
    opacity: 0.8,
  },
  resultHeading: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    opacity: 0.7,
  },
  paragraph: {
    fontSize: 14,
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    backgroundColor: '#f3f4f6',
    borderRadius: 6,
    padding: 8,
  },
});
