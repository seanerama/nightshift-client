import { Tabs } from 'expo-router';

import { ConnectionsProvider } from '@/connections/connections-context';

export default function RootLayout() {
  return (
    <ConnectionsProvider>
      <Tabs>
        <Tabs.Screen name="index" options={{ title: 'Connections' }} />
        <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
        <Tabs.Screen name="apps" options={{ title: 'Apps' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </ConnectionsProvider>
  );
}
