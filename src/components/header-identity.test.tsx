/**
 * Component: the "Manage connections…" route (stage 12).
 *
 * Regression guard for the rename in this stage. Chat became `index`, so `/`
 * is now Chat and Connections moved to `/connections`. The switcher's manage
 * action used to navigate to `/` — after the rename that silently lands on the
 * WRONG SCREEN with nothing throwing, which is exactly why it is asserted here
 * rather than left to typedRoutes.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}));

const mockConnections = {
  loading: false,
  connections: [
    {
      id: 'c1',
      baseUrl: 'http://a:1',
      agentName: 'alpha',
      agentVersion: '1.0.0',
      capabilities: ['chat'],
      uiHome: null,
      isActive: true,
      createdAt: '2026-07-28T00:00:00.000Z',
      personId: null,
    },
  ],
  active: { agentName: 'alpha' },
  health: 'ok',
  saveConnection: jest.fn(),
  removeConnection: jest.fn(),
  setActive: jest.fn(),
};
jest.mock('@/connections/connections-context', () => ({
  useConnections: () => mockConnections,
}));

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HeaderIdentity } = require('./header-identity') as {
  HeaderIdentity: (p: { fallbackTitle: string }) => React.ReactElement;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThemeProvider } = require('@/theme/theme-context') as {
  ThemeProvider: (p: {
    children: React.ReactNode;
    store: () => Promise<unknown>;
  }) => React.ReactElement;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MemoryAppSettingsStore } = require('@/settings/memory');

describe('HeaderIdentity → Manage connections', () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('navigates to /connections, NOT / (which is Chat after the stage-12 rename)', async () => {
    const store = new MemoryAppSettingsStore();
    await act(async () => {
      tree = create(
        <ThemeProvider store={async () => store}>
          <HeaderIdentity fallbackTitle="Chat" />
        </ThemeProvider>,
      );
    });

    // Open the switcher, then hit the manage row.
    await act(async () => {
      tree.root
        .findAll(
          (n) => n.props.testID === 'header-identity' && typeof n.props.onPress === 'function',
        )[0]
        .props.onPress();
    });
    await act(async () => {
      tree.root
        .findAll(
          (n) => n.props.testID === 'switcher-manage' && typeof n.props.onPress === 'function',
        )[0]
        .props.onPress();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/connections');
    expect(mockNavigate).not.toHaveBeenCalledWith('/');
  });
});
