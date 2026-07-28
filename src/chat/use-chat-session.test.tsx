/**
 * Hook-level lock for the stage-10 acceptance condition: EVERY send path —
 * send, tap-to-retry, and the offline-queue drain — builds its
 * InboundMessage with the ACTIVE connection's resolved personId
 * (ActiveConnection.personId), never a hardcoded constant. The spy sits on
 * the mocked postMessage and inspects the built message.
 *
 * Mounted with react-test-renderer under the jest-expo Android preset (the
 * hook itself is thin, but the wiring — which personId reaches the wire — is
 * exactly what this stage changes, so it is locked at the hook seam).
 */

import type { InboundMessage } from 'agent-app-contract/types';
import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ActiveConnection } from '../connections/connections-context';
import { MemoryChatStore } from './memory';
import type { ChatSession } from './use-chat-session';
import { useChatSession } from './use-chat-session';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuidCounter).padStart(12, '0')}`,
}));

jest.mock('../config/transcript-persistence', () => ({
  TRANSCRIPT_PERSISTENCE_ENABLED: true,
}));

jest.mock('../api/client', () => {
  const actual = jest.requireActual('../api/client');
  return {
    ...actual,
    postMessage: jest.fn(),
    getOutbox: jest.fn(),
  };
});

jest.mock('../api/events', () => ({
  createEventStream: jest.fn(() => ({
    stop: jest.fn(),
    getLastEventId: () => null,
  })),
}));

const mockChatStore = new MemoryChatStore();
jest.mock('./sqlite-chat-store', () => ({
  getSqliteChatStore: () => Promise.resolve(mockChatStore),
}));

// Mocked module handles (typed loosely; the factory above defines them).
const { postMessage, getOutbox } = jest.requireMock('../api/client') as {
  postMessage: jest.Mock;
  getOutbox: jest.Mock;
};
const { ApiClientError } = jest.requireActual('../api/client');

const activeConnection = (personId: string, id = `conn-${personId}`): ActiveConnection => ({
  id,
  baseUrl: 'http://agent.test:1',
  agentName: 'agent-under-test',
  agentVersion: '1.0.0',
  capabilities: ['chat'],
  uiHome: null,
  // The hook receives the ALREADY-RESOLVED value (stored ?? default) — the
  // resolution itself is covered by person-id.test.ts + connection-row tests.
  personId,
  getToken: async () => 'fake-test-token',
});

function Probe({ active, out }: { active: ActiveConnection; out: { session?: ChatSession } }) {
  out.session = useChatSession(active);
  return null;
}

const mount = (active: ActiveConnection) => {
  const out: { session?: ChatSession } = {};
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(<Probe active={active} out={out} />);
  });
  if (tree === undefined) throw new Error('mount failed');
  return { out, tree };
};

const settle = async () => {
  // Let the mount-time hydration → catch-up → drain chain run to completion.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

const sentMessages = (): InboundMessage[] =>
  postMessage.mock.calls.map((call) => call[1] as InboundMessage);

describe('useChatSession personId plumbing (stage 10)', () => {
  beforeEach(() => {
    // The hook streams only while foregrounded — pin the mocked AppState.
    Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
    postMessage.mockResolvedValue({ ok: true, messageId: 'echoed' });
    getOutbox.mockResolvedValue({ schema: 1, events: [] });
  });

  it('send: the built InboundMessage carries the active connection resolved personId', async () => {
    const { out, tree } = mount(activeConnection('owner-alpha'));
    await settle();

    await act(async () => {
      await out.session?.send('hello');
    });

    const sent = sentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].personId).toBe('owner-alpha');
    expect(sent[0].text).toBe('hello');
    act(() => tree.unmount());
  });

  it('retry: re-POSTs the ORIGINAL messageId with the same resolved personId', async () => {
    const { out, tree } = mount(activeConnection('owner-beta'));
    await settle();

    // First attempt refused (403 = kind http → the failed/tap-to-retry path).
    postMessage.mockRejectedValueOnce(
      new ApiClientError('http', 'person mismatch', { status: 403 }),
    );
    await act(async () => {
      await out.session?.send('rejected once');
    });
    const first = sentMessages();
    expect(first).toHaveLength(1);
    const failed = out.session?.items.find((i) => i.kind === 'user');
    expect(failed).toMatchObject({ sendState: 'failed' });

    await act(async () => {
      await out.session?.retry(first[0].messageId);
    });

    const sent = sentMessages();
    expect(sent).toHaveLength(2);
    expect(sent[1].messageId).toBe(first[0].messageId); // invariant 5: same dedup key
    expect(sent[1].personId).toBe('owner-beta');
    act(() => tree.unmount());
  });

  it('drain: queued rows are re-POSTed with the active connection resolved personId', async () => {
    const active = activeConnection('owner-gamma');
    // A message queued in an earlier (offline) session, awaiting drain.
    await mockChatStore.enqueue({
      messageId: '00000000-0000-4000-8000-000000queued00',
      connectionId: active.id,
      text: 'queued while offline',
      attachments: [],
      queuedAt: '2026-07-27T00:00:01.000Z',
    });

    const { tree } = mount(active);
    // Drain runs on session start (hydrate → catch-up → drain); wait for it.
    await act(async () => {
      const deadline = Date.now() + 5000;
      while (postMessage.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });

    const sent = sentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].personId).toBe('owner-gamma');
    expect(sent[0].text).toBe('queued while offline');
    expect(await mockChatStore.listQueue(active.id)).toHaveLength(0); // accepted → dequeued
    act(() => tree.unmount());
  });

  it('switching the active connection switches the personId on subsequent sends', async () => {
    const out: { session?: ChatSession } = {};
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<Probe active={activeConnection('owner-alpha', 'conn-a')} out={out} />);
    });
    if (tree === undefined) throw new Error('mount failed');
    await settle();
    await act(async () => {
      await out.session?.send('to alpha');
    });

    act(() => {
      tree?.update(<Probe active={activeConnection('owner-beta', 'conn-b')} out={out} />);
    });
    await settle();
    await act(async () => {
      await out.session?.send('to beta');
    });

    const byText = Object.fromEntries(sentMessages().map((m) => [m.text, m.personId]));
    expect(byText['to alpha']).toBe('owner-alpha');
    expect(byText['to beta']).toBe('owner-beta');
    act(() => tree?.unmount());
  });
});
