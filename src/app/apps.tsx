import { PlaceholderScreen } from '@/components/placeholder-screen';
import { CAPABILITY_MCP_APPS_UI, gateCapability } from '@/connections/capabilities';
import { useActiveConnection } from '@/connections/connections-context';

export default function AppsScreen() {
  const active = useActiveConnection();
  const gate = gateCapability(active, CAPABILITY_MCP_APPS_UI);

  if (gate === 'no-active-connection') {
    return (
      <PlaceholderScreen title="Apps" subtitle="Add and activate a connection to see agent apps." />
    );
  }
  if (gate === 'unsupported') {
    return <PlaceholderScreen title="Apps" subtitle="Not available for this agent." />;
  }
  // Capability present, but the renderer arrives in stage 5 — stays placeholder.
  return <PlaceholderScreen title="Apps" subtitle="Coming in stage 5." />;
}
