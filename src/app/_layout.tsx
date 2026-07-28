import { Tabs } from 'expo-router';

import { HeaderIdentity } from '@/components/header-identity';
import { APPS_TAB_ENABLED } from '@/config/apps-tab';
import { ConnectionsProvider } from '@/connections/connections-context';

export default function RootLayout() {
  return (
    <ConnectionsProvider>
      <Tabs>
        <Tabs.Screen name="index" options={{ title: 'Connections' }} />
        {/* Stage 10: Chat/Apps headers show WHICH agent is active (name +
            health dot) and open the quick switcher on tap; `title` stays for
            the tab-bar label, and HeaderIdentity itself falls back to the
            static title when no connection is active. */}
        <Tabs.Screen
          name="chat"
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
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </ConnectionsProvider>
  );
}
