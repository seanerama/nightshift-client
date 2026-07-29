/**
 * Component: long-press-to-copy wiring on the transcript (stage 12).
 *
 * The decision (what gets copied) is covered in src/chat/copy.test.ts; this
 * locks that the gesture reaches the clipboard with the message's exact text,
 * for BOTH bubble kinds, and that a plain tap does not copy.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockSetString = jest.fn((_text: string) => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({ setStringAsync: (t: string) => mockSetString(t) }));

jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem }: { data: unknown[]; renderItem: (a: unknown) => unknown }) =>
      React.createElement(
        View,
        null,
        (data ?? []).map((item, index) =>
          React.createElement(React.Fragment, { key: index }, renderItem({ item }) as never),
        ),
      ),
  };
});

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

const mockActive = {
  id: 'c1',
  baseUrl: 'http://a:1',
  agentName: 'alpha',
  agentVersion: '1.0.0',
  capabilities: ['chat'],
  uiHome: null,
  personId: 'owner',
  getToken: async () => 't',
};
jest.mock('@/connections/connections-context', () => ({
  useActiveConnection: () => mockActive,
}));

const mockItems = [
  {
    kind: 'user',
    messageId: 'm1',
    text: 'deploy the thing',
    sendState: 'accepted',
    at: '2026-07-28T00:00:00.000Z',
  },
  {
    kind: 'agent',
    eventId: 7,
    eventType: 'reply',
    text: 'Run this:\n\n```sh\nnpm test\n```',
    files: [],
    at: '2026-07-28T00:00:01.000Z',
  },
];
jest.mock('@/chat/use-chat-session', () => ({
  useChatSession: () => ({
    items: mockItems,
    streamState: 'connected',
    send: jest.fn(),
    retry: jest.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ChatScreen = require('../app/index').default as () => React.ReactElement;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('@/theme/theme-context');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MemoryAppSettingsStore } = require('@/settings/memory');

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const bubble = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll(
    (n) => n.props.testID === testID && typeof n.props.onLongPress === 'function',
  )[0];

describe('long-press to copy', () => {
  let tree: ReactTestRenderer;

  beforeEach(async () => {
    mockSetString.mockClear();
    const store = new MemoryAppSettingsStore();
    await act(async () => {
      tree = create(
        <ThemeProvider store={async () => store}>
          <ChatScreen />
        </ThemeProvider>,
      );
    });
    await flush();
  });

  afterEach(() => {
    // The "Copied" flag clears on a 1.5s timer; unmounting cancels it (see the
    // cleanup effect in TranscriptRow). Without this the jest worker is still
    // holding a live timer at teardown.
    act(() => tree?.unmount());
  });

  it('copies a user message verbatim', async () => {
    await act(async () => bubble(tree, 'chat-item-user-m1').props.onLongPress());
    expect(mockSetString).toHaveBeenCalledWith('deploy the thing');
  });

  it('copies an agent message including its raw markdown fences', async () => {
    await act(async () => bubble(tree, 'chat-item-agent-7').props.onLongPress());
    expect(mockSetString).toHaveBeenCalledWith('Run this:\n\n```sh\nnpm test\n```');
  });

  it('a plain tap does NOT copy', async () => {
    const node = tree.root.findAll((n) => n.props.testID === 'chat-item-user-m1')[0];
    // The accepted user bubble has no onPress at all (retry is failed-only).
    expect(node.props.onPress).toBeUndefined();
    expect(mockSetString).not.toHaveBeenCalled();
  });
});
