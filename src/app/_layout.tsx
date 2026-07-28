import { Tabs } from 'expo-router';

import { APPS_TAB_ENABLED } from '@/config/apps-tab';
import { ConnectionsProvider } from '@/connections/connections-context';

export default function RootLayout() {
  return (
    <ConnectionsProvider>
      <Tabs>
        <Tabs.Screen name="index" options={{ title: 'Connections' }} />
        <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
        {/* Stage-5 kill-switch: href null removes the tab entirely when the
            APPS_TAB_ENABLED flag is off (src/config/flags.ts). */}
        <Tabs.Screen
          name="apps"
          options={{ title: 'Apps', href: APPS_TAB_ENABLED ? '/apps' : null }}
        />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </ConnectionsProvider>
  );
}
