/**
 * One sandboxed WebView per opened ui:// resource (ADR 0004).
 *
 * Deliberately THIN: jest's node environment cannot render
 * react-native-webview, so every decision lives in tested pure modules —
 * props/sandbox in src/ui-bridge/webview.ts, routing/allowlist/timeouts in
 * src/ui-bridge/bridge.ts, fallback state in src/ui-bridge/fallback.ts,
 * agent traffic in src/mcp/client.ts. This file only wires callbacks.
 *
 * TOKEN ISOLATION: this component receives a token *accessor* and hands it
 * ONLY to the native MCP client. Nothing token-shaped is ever placed on a
 * WebView prop, in the html, or in a bridge frame (asserted by unit test on
 * the builders and by the shape of this wiring: the WebView receives
 * buildWebViewProps(html) + handler closures, nothing else).
 */

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';

import {
  callTool,
  type McpConnection,
  type McpResourceDescriptor,
  readUiResourceHtml,
  toolResultText,
} from '@/mcp/client';
import { usePalette, useTheme } from '@/theme/theme-context';
import type { Palette } from '@/theme/tokens';
import { deriveAllowlist } from '@/ui-bridge/allowlist';
import { type BridgeSession, createBridgeSession } from '@/ui-bridge/bridge';
import { reduceResourceView } from '@/ui-bridge/fallback';
import { buildDispatchScript, buildWebViewProps, shouldStartLoad } from '@/ui-bridge/webview';
import { FallbackCard } from './fallback-card';

export interface ResourceViewProps {
  connection: McpConnection & { capabilities: readonly string[] };
  resource: McpResourceDescriptor;
  onClose: () => void;
}

export function ResourceView({ connection, resource, onClose }: ResourceViewProps) {
  const [state, dispatch] = useReducer(reduceResourceView, { phase: 'loading' });
  const [lastToolResult, setLastToolResult] = useState<string | null>(null);
  const webviewRef = useRef<WebView>(null);
  const { scheme, palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();

  // One bridge session per opened resource; allowlist derived once from the
  // resource's declared metadata ∩ the connection's manifest capabilities.
  const session: BridgeSession = useMemo(
    () =>
      createBridgeSession({
        allowlist: deriveAllowlist({ resource, capabilities: connection.capabilities }),
        callTool: async (name, args) => {
          const result = await callTool(connection, name, args);
          const text = toolResultText(result);
          if (text.length > 0) setLastToolResult(text);
          return result;
        },
        post: (frame) => webviewRef.current?.injectJavaScript(buildDispatchScript(frame)),
        onReady: () => dispatch({ type: 'ready' }),
        onClose,
        onCounts: (counts) => dispatch({ type: 'counts', ...counts }),
      }),
    // eslint-style exhaustive deps intentionally narrowed: a new session only
    // per resource/connection identity, not per render.
    [resource, connection, onClose],
  );
  useEffect(() => () => session.dispose(), [session]);

  // Fetch the resource html through the native MCP client (never the WebView).
  useEffect(() => {
    let cancelled = false;
    readUiResourceHtml(connection, resource.uri)
      .then((html) => {
        if (!cancelled) dispatch({ type: 'html', html });
      })
      .catch((err: Error) => {
        if (!cancelled) dispatch({ type: 'read-failed', detail: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [connection, resource.uri]);

  // ui/theme on load and on change (scheme or safe-area insets).
  const rendering = state.phase === 'rendering';
  useEffect(() => {
    if (!rendering) return;
    session.pushTheme({
      scheme,
      insets: { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left },
    });
  }, [rendering, session, scheme, insets.top, insets.right, insets.bottom, insets.left]);

  if (state.phase === 'fallback') {
    return (
      <View style={styles.container}>
        <Header title={resource.name ?? resource.uri} onClose={onClose} />
        <FallbackCard reason={state.reason} detail={state.detail} lastToolResult={lastToolResult} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title={resource.name ?? resource.uri} onClose={onClose} />
      {state.phase === 'rendering' && (
        <WebView
          ref={webviewRef}
          {...buildWebViewProps(state.html)}
          style={styles.webview}
          testID="apps-webview"
          onMessage={(event) => session.handleFrame(event.nativeEvent.data)}
          onShouldStartLoadWithRequest={(request) => shouldStartLoad(request.url)}
          onError={(event) =>
            dispatch({ type: 'load-error', detail: event.nativeEvent.description ?? 'load error' })
          }
          onRenderProcessGone={() =>
            dispatch({ type: 'render-crash', detail: 'The app’s render process exited.' })
          }
          onContentProcessDidTerminate={() =>
            dispatch({ type: 'render-crash', detail: 'The app’s content process terminated.' })
          }
        />
      )}
      {(state.phase === 'loading' || (state.phase === 'rendering' && !state.ready)) && (
        <View style={styles.loading} pointerEvents="none" testID="apps-loading">
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.header}>
      <Pressable onPress={onClose} testID="apps-back" hitSlop={8}>
        <Text style={styles.back}>‹ Apps</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: palette.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
    },
    back: {
      fontSize: 15,
      color: palette.accent,
      fontWeight: '600',
    },
    headerTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: palette.text,
    },
    webview: {
      flex: 1,
    },
    loading: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.background,
    },
  });
