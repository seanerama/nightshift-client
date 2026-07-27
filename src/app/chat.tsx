import { PlaceholderScreen } from '@/components/placeholder-screen';
import { CAPABILITY_CHAT, gateCapability } from '@/connections/capabilities';
import { useActiveConnection } from '@/connections/connections-context';

export default function ChatScreen() {
  const active = useActiveConnection();
  const gate = gateCapability(active, CAPABILITY_CHAT);

  if (gate === 'no-active-connection') {
    return (
      <PlaceholderScreen title="Chat" subtitle="Add and activate a connection to start chatting." />
    );
  }
  if (gate === 'unsupported') {
    return <PlaceholderScreen title="Chat" subtitle="Not available for this agent." />;
  }
  return <PlaceholderScreen title="Chat" subtitle="Coming in stage 4." />;
}
