import { Tabs } from 'expo-router';

import { HeaderIdentity } from '@/components/header-identity';
import { APPS_TAB_ENABLED } from '@/config/apps-tab';
import { ConnectionsProvider } from '@/connections/connections-context';
import { ThemeProvider, useTheme } from '@/theme/theme-context';

/**
 * Tab order (stage 12): Chat, Apps, Connections, Settings — Chat first, and
 * Chat is what opens on launch.
 *
 * Chat is `index` rather than `chat` because expo-router's `Tabs` OMITS
 * `initialRouteName` from its navigator props (see
 * expo-router/build/layouts/TabsClient.d.ts) and a tab layout takes its initial
 * route from its `index` file. So "which tab opens first" is decided by the
 * filename, not by a prop — hence chat.tsx -> index.tsx and the old
 * index.tsx (Connections) -> connections.tsx.
 *
 * Consequence to keep in mind: `/` is now Chat. Anything navigating to
 * Connections must use `/connections` (see components/header-identity.tsx).
 */
export default function RootLayout() {
  return (
    <ThemeProvider>
      <ConnectionsProvider>
        <ThemedTabs />
      </ConnectionsProvider>
    </ThemeProvider>
  );
}

function ThemedTabs() {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        sceneStyle: { backgroundColor: palette.background },
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border },
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
      }}
    >
      {/* Stage 10: Chat/Apps headers show WHICH agent is active (name + health
          dot) and open the quick switcher on tap; `title` stays for the tab-bar
          label, and HeaderIdentity itself falls back to the static title when
          no connection is active. */}
      <Tabs.Screen
        name="index"
        options={{ title: 'Chat', headerTitle: () => <HeaderIdentity fallbackTitle="Chat" /> }}
      />
      {/* Stage-5 kill-switch: href null removes the tab entirely when the
          APPS_TAB_ENABLED flag is off (src/config/flags.ts). */}
      <Tabs.Screen
        name="apps"
        options={{
          title: 'Apps',
          href: APPS_TAB_ENABLED ? '/apps' : null,
          headerTitle: () => <HeaderIdentity fallbackTitle="Apps" />,
        }}
      />
      <Tabs.Screen name="connections" options={{ title: 'Connections' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
