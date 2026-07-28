/**
 * Apps tab (stage 5): agent-served ui:// resources over MCP.
 *
 * Gating, outermost first:
 * 1. APPS_TAB_ENABLED kill-switch (src/config/flags.ts) — when off the tab is
 *    hidden entirely in _layout.tsx; the check here is defense in depth.
 * 2. Active connection present, and its manifest advertises `mcp-apps-ui`
 *    (unchanged from stage 3).
 *
 * The screen lists the agent's ui:// resources (resources/list) and honors
 * manifest `ui.home` as the default-open resource when present. Each opened
 * resource renders in its own sandboxed WebView (ResourceView, ADR 0004).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FallbackCard } from '@/components/fallback-card';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ResourceView } from '@/components/resource-view';
import { APPS_TAB_ENABLED } from '@/config/apps-tab';
import { CAPABILITY_MCP_APPS_UI, gateCapability } from '@/connections/capabilities';
import { type ActiveConnection, useActiveConnection } from '@/connections/connections-context';
import { initialize, listResources, type McpResourceDescriptor } from '@/mcp/client';

type ListState =
  | { status: 'loading' }
  | { status: 'error'; detail: string }
  | { status: 'ready'; resources: McpResourceDescriptor[] };

export default function AppsScreen() {
  const active = useActiveConnection();
  const gate = gateCapability(active, CAPABILITY_MCP_APPS_UI);

  if (!APPS_TAB_ENABLED) {
    return <PlaceholderScreen title="Apps" subtitle="Apps are disabled in this build." />;
  }
  if (gate === 'no-active-connection') {
    return (
      <PlaceholderScreen title="Apps" subtitle="Add and activate a connection to see agent apps." />
    );
  }
  if (gate === 'unsupported') {
    return <PlaceholderScreen title="Apps" subtitle="Not available for this agent." />;
  }
  // gate === 'available' implies active is non-null.
  return active === null ? null : <AppsBrowser connection={active} />;
}

function AppsBrowser({ connection }: { connection: ActiveConnection }) {
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [openUri, setOpenUri] = useState<string | null>(null);
  // ui.home auto-opens once per connection, not after the user backs out.
  const autoOpenedFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    setList({ status: 'loading' });
    try {
      await initialize(connection);
      const resources = await listResources(connection);
      setList({ status: 'ready', resources });
    } catch (err) {
      setList({ status: 'error', detail: (err as Error).message });
    }
  }, [connection]);

  useEffect(() => {
    void load();
  }, [load]);

  // Honor manifest ui.home as the default-open resource when it is present
  // AND actually served (contract: home MUST name a served ui:// resource;
  // an agent violating that degrades to the plain list, fail-soft).
  useEffect(() => {
    if (list.status !== 'ready') return;
    if (connection.uiHome === null) return;
    if (autoOpenedFor.current === connection.id) return;
    autoOpenedFor.current = connection.id;
    if (list.resources.some((r) => r.uri === connection.uiHome)) {
      setOpenUri(connection.uiHome);
    }
  }, [list, connection.uiHome, connection.id]);

  if (list.status === 'loading') {
    return <PlaceholderScreen title="Apps" subtitle="Loading the agent’s apps…" />;
  }
  if (list.status === 'error') {
    // resources/list itself failed → the mandatory fallback surface.
    return <FallbackCard reason="read-failed" detail={list.detail} lastToolResult={null} />;
  }

  const open = openUri === null ? null : (list.resources.find((r) => r.uri === openUri) ?? null);
  if (open !== null) {
    return (
      <ResourceView connection={connection} resource={open} onClose={() => setOpenUri(null)} />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.listContent}>
      <Text style={styles.heading}>
        Apps from {connection.agentName} v{connection.agentVersion}
      </Text>
      {list.resources.length === 0 && (
        <Text style={styles.empty}>This agent serves no ui:// resources.</Text>
      )}
      {list.resources.map((resource) => (
        <Pressable
          key={resource.uri}
          style={styles.row}
          onPress={() => setOpenUri(resource.uri)}
          testID={`apps-resource-${resource.uri}`}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{resource.name ?? resource.uri}</Text>
            <Text style={styles.rowUri}>{resource.uri}</Text>
          </View>
          {connection.uiHome === resource.uri && <Text style={styles.homeBadge}>home</Text>}
        </Pressable>
      ))}
      <Pressable style={styles.refresh} onPress={() => void load()} testID="apps-refresh">
        <Text style={styles.refreshText}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    gap: 10,
  },
  heading: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.6,
  },
  empty: {
    fontSize: 14,
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowUri: {
    fontSize: 12,
    opacity: 0.5,
  },
  homeBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  refresh: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  refreshText: {
    color: '#2563eb',
    fontWeight: '600',
  },
});
