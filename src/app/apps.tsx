/**
 * Apps tab: agent-served ui:// resources over MCP.
 *
 * Gating, outermost first:
 * 1. APPS_TAB_ENABLED kill-switch (src/config/flags.ts) — when off the tab is
 *    hidden entirely in _layout.tsx; the check here is defense in depth.
 *    Stage 11 rides this same flag; it adds no flag of its own.
 * 2. Active connection present, and its manifest advertises `mcp-apps-ui`
 *    (unchanged from stage 3).
 *
 * Stage 11 (ADR 0006 / ADR 0007) makes the list LIVE: it refreshes on the
 * pull-to-refresh gesture, on tab focus, and on a foreground-gated poll — all
 * through ONE entry point (src/apps/refresh-controller.ts), so the deferred
 * push stage adds an event branch and no new refresh logic.
 *
 * Deliberately THIN, like resource-view.tsx: every decision lives in a tested
 * pure module — list state and reconciliation in src/apps/resource-list.ts,
 * debounce/coalesce in src/apps/refresh-controller.ts, open-resource lifetime
 * in src/apps/open-resource.ts. This file only wires them.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { homeResourceToAutoOpen, noticeForClosedResource } from '@/apps/open-resource';
import { createRefreshController, RESOURCE_POLL_INTERVAL_MS } from '@/apps/refresh-controller';
import {
  INITIAL_RESOURCE_LIST_STATE,
  type ResourceListState,
  reduceResourceList,
} from '@/apps/resource-list';
import { FallbackCard } from '@/components/fallback-card';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ResourceView } from '@/components/resource-view';
import { APPS_TAB_ENABLED } from '@/config/apps-tab';
import { CAPABILITY_MCP_APPS_UI, gateCapability } from '@/connections/capabilities';
import { type ActiveConnection, useActiveConnection } from '@/connections/connections-context';
import { shouldPoll } from '@/connections/health';
import { initialize, listResources, type McpResourceDescriptor } from '@/mcp/client';

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
  //
  // KEYED PER AGENT — load-bearing, not cosmetic. Every piece of AppsBrowser's
  // state (the list, the open-resource snapshot, the vanished notice, the
  // ui.home guard) belongs to ONE agent. The stage-11 rule "once a list is
  // known, no event takes it away" holds WITHIN a connection and is wrong
  // ACROSS one: without this key, switching agents left the previous agent's
  // rows on screen under the new agent's heading — indefinitely if the new
  // agent's fetch failed — and left its open resource mounted and re-wired to
  // the new connection. See ADR 0007 §"Within a connection, not across one".
  //
  // baseUrl is in the key because editing a connection keeps its id while
  // re-pointing it at a genuinely different agent.
  return active === null ? null : (
    <AppsBrowser key={`${active.id}:${active.baseUrl}`} connection={active} />
  );
}

export function AppsBrowser({ connection }: { connection: ActiveConnection }) {
  const [list, dispatch] = useReducer(reduceResourceList, INITIAL_RESOURCE_LIST_STATE);

  // ADR 0007: the OPEN resource is an owned snapshot, captured at open time and
  // never re-derived from `list`. It is INTENTIONALLY allowed to go stale — see
  // src/apps/open-resource.ts for the bridge-session teardown this prevents.
  // Do not "fix" this into a lookup against the live list.
  const [open, setOpen] = useState<McpResourceDescriptor | null>(null);
  const [vanished, setVanished] = useState<string | null>(null);

  // ui.home auto-opens once per connection, and not again on refresh.
  const autoOpenedFor = useRef<string | null>(null);

  // Latest values for the stable callbacks below, WITHOUT making those
  // callbacks change identity (which would itself tear down ResourceView).
  const openRef = useRef<McpResourceDescriptor | null>(null);
  openRef.current = open;
  const resourcesRef = useRef<readonly McpResourceDescriptor[]>([]);
  if (list.status === 'ready') resourcesRef.current = list.resources;

  const controller = useMemo(
    () =>
      createRefreshController({
        fetchList: async () => {
          await initialize(connection);
          return listResources(connection);
        },
        onStarted: () => dispatch({ type: 'refresh-started' }),
        onSucceeded: (resources) => dispatch({ type: 'refresh-succeeded', resources }),
        onFailed: (detail) => dispatch({ type: 'refresh-failed', detail }),
      }),
    [connection],
  );
  useEffect(() => () => controller.dispose(), [controller]);

  // Initial load, and a fresh load whenever the active connection changes.
  useEffect(() => {
    controller.request({ immediate: true });
  }, [controller]);

  // Trigger: returning to the tab.
  useFocusEffect(
    useCallback(() => {
      controller.request();
    }, [controller]),
  );

  // Trigger: slow backstop while foregrounded. Same start/stop + AppState shape
  // as the health poll in connections-context — reusing shouldPoll rather than
  // inventing a second foreground-gating pattern.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer === null) {
        timer = setInterval(() => controller.request(), RESOURCE_POLL_INTERVAL_MS);
      }
    };
    const apply = (appState: string) => {
      if (shouldPoll(appState, true)) start();
      else stop();
    };
    apply(AppState.currentState);
    const subscription = AppState.addEventListener('change', apply);
    return () => {
      stop();
      subscription.remove();
    };
  }, [controller]);

  // Stable identity (ADR 0007): ResourceView memoizes its bridge session on
  // [resource, connection, onClose], so an inline arrow here would dispose a
  // running resource's session on every refresh-driven re-render.
  const handleClose = useCallback(() => {
    const closing = openRef.current;
    if (closing !== null) setVanished(noticeForClosedResource(closing, resourcesRef.current));
    setOpen(null);
  }, []);

  const handleOpen = useCallback((resource: McpResourceDescriptor) => {
    setVanished(null);
    setOpen(resource);
  }, []);

  const onRefresh = useCallback(() => controller.request({ immediate: true }), [controller]);

  // Honor manifest ui.home as the default-open resource, once per connection.
  // Fail-soft (unchanged from stage 5): a ui.home the agent does not actually
  // serve degrades to the plain list rather than erroring.
  useEffect(() => {
    if (list.status !== 'ready') return;
    if (connection.uiHome === null) return;
    const home = homeResourceToAutoOpen({
      uiHome: connection.uiHome,
      connectionId: connection.id,
      openedFor: autoOpenedFor.current,
      resources: list.resources,
    });
    autoOpenedFor.current = connection.id;
    if (home !== null) setOpen(home);
  }, [list, connection.uiHome, connection.id]);

  if (list.status === 'initial-loading') {
    return <PlaceholderScreen title="Apps" subtitle="Loading the agent’s apps…" />;
  }
  if (list.status === 'initial-error') {
    // No list was ever fetched → the mandatory fallback surface (ADR 0004).
    // A FAILED REFRESH never reaches here: it keeps the list (staleError).
    return <FallbackCard reason="read-failed" detail={list.detail} lastToolResult={null} />;
  }

  if (open !== null) {
    return <ResourceView connection={connection} resource={open} onClose={handleClose} />;
  }

  return (
    <ResourceList
      list={list}
      connection={connection}
      vanished={vanished}
      onDismissVanished={() => setVanished(null)}
      onOpen={handleOpen}
      onRefresh={onRefresh}
    />
  );
}

function ResourceList({
  list,
  connection,
  vanished,
  onDismissVanished,
  onOpen,
  onRefresh,
}: {
  list: Extract<ResourceListState, { status: 'ready' }>;
  connection: ActiveConnection;
  vanished: string | null;
  onDismissVanished: () => void;
  onOpen: (resource: McpResourceDescriptor) => void;
  onRefresh: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl
          refreshing={list.refreshing}
          onRefresh={onRefresh}
          testID="apps-refresh-control"
        />
      }
    >
      <Text style={styles.heading}>
        Apps from {connection.agentName} v{connection.agentVersion}
      </Text>

      {/* Non-blocking: the list below is the last known good one. */}
      {list.staleError !== null && (
        <Text style={styles.staleNotice} testID="apps-stale-notice">
          Couldn’t refresh — showing the last known list. Pull down to try again.
        </Text>
      )}

      {/* ADR 0007: a resource that vanished while open kept running; this is
          information on return, not an error. */}
      {vanished !== null && (
        <Pressable
          style={styles.vanishedNotice}
          onPress={onDismissVanished}
          testID="apps-vanished-notice"
        >
          <Text style={styles.vanishedText}>{vanished}</Text>
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
      )}

      {list.resources.length === 0 && (
        <Text style={styles.empty}>This agent serves no ui:// resources.</Text>
      )}
      {list.resources.map((resource) => (
        <Pressable
          key={resource.uri}
          style={styles.row}
          onPress={() => onOpen(resource)}
          testID={`apps-resource-${resource.uri}`}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{resource.name ?? resource.uri}</Text>
            <Text style={styles.rowUri}>{resource.uri}</Text>
          </View>
          {connection.uiHome === resource.uri && <Text style={styles.homeBadge}>home</Text>}
        </Pressable>
      ))}
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
  staleNotice: {
    fontSize: 13,
    color: '#92400e',
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  vanishedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0e7ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  vanishedText: {
    flex: 1,
    fontSize: 13,
    color: '#3730a3',
  },
  dismissText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3730a3',
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
});
