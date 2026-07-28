/**
 * Stage 11 / **ADR 0007** — the standing regression gate.
 *
 * A refresh must never remount or tear down a running resource. The hazard is
 * concrete: ResourceView memoizes its bridge session on
 * `[resource, connection, onClose]` and disposes the previous one, while
 * `listResources` builds FRESH descriptor objects on every fetch. Deriving the
 * open resource from the live list — or passing an inline `onClose` — kills
 * in-flight `tools/call`s on every refresh.
 *
 * ResourceView itself is stubbed (it needs react-native-webview); the stub
 * records mounts, unmounts, and prop identity, which is exactly what drives
 * the real component's session memo.
 */

import type React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { REFRESH_DEBOUNCE_MS, RESOURCE_POLL_INTERVAL_MS } from '@/apps/refresh-controller';
import type { ActiveConnection } from '@/connections/connections-context';
import type { McpResourceDescriptor } from '@/mcp/client';

const mockMounts: string[] = [];
const mockUnmounts: string[] = [];
const mockProps: Array<{ resource: McpResourceDescriptor; onClose: () => void }> = [];

jest.mock('@/components/resource-view', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    ResourceView: (props: { resource: McpResourceDescriptor; onClose: () => void }) => {
      mockProps.push({ resource: props.resource, onClose: props.onClose });
      React.useEffect(() => {
        mockMounts.push(props.resource.uri);
        return () => mockUnmounts.push(props.resource.uri);
        // Mount-once semantics, mirroring how the real session memo behaves
        // when its deps are stable.
      }, []);
      return React.createElement(Text, { testID: 'stub-resource-view' }, props.resource.uri);
    },
  };
});

// useFocusEffect needs a navigation container; the tab-focus trigger is
// exercised as a plain effect here.
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    const React = require('react');
    React.useEffect(callback, [callback]);
  },
}));

jest.mock('@/config/apps-tab', () => ({ APPS_TAB_ENABLED: true }));

// The real provider drags in expo-sqlite; the active connection is the only
// thing AppsScreen consumes from it, so it is driven directly here. Mutable
// because the switch tests below change which agent is active.
let mockActiveConnection: ActiveConnection | null = null;
jest.mock('@/connections/connections-context', () => ({
  useActiveConnection: () => mockActiveConnection,
}));

jest.mock('@/mcp/client', () => ({
  initialize: jest.fn(async () => ({ protocolVersion: '2025-06-18', capabilities: {} })),
  listResources: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { listResources } = require('@/mcp/client') as { listResources: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appsModule = require('./apps') as {
  default: () => React.ReactElement | null;
  AppsBrowser: (props: { connection: ActiveConnection }) => React.ReactElement;
};
const { AppsBrowser } = appsModule;
const AppsScreen = appsModule.default;

const connection: ActiveConnection = {
  id: 'conn-1',
  baseUrl: 'http://agent:8080',
  agentName: 'nightshift-assistant',
  agentVersion: '1.0.0',
  capabilities: ['chat', 'mcp-tools', 'mcp-apps-ui'],
  uiHome: null,
  personId: 'owner-nightshift',
  getToken: async () => 'token',
};

/** Fresh objects every call — exactly what the real listResources does. */
const listing = (...uris: string[]): McpResourceDescriptor[] =>
  uris.map((uri) => ({ uri, name: `name-${uri}`, mimeType: 'text/html' }));

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const findByTestID = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll((node) => node.props.testID === testID)[0];

describe('AppsBrowser refresh safety (ADR 0007)', () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    jest.useFakeTimers();
    mockMounts.length = 0;
    mockUnmounts.length = 0;
    mockProps.length = 0;
    listResources.mockReset();
  });

  afterEach(() => {
    act(() => tree?.unmount());
    jest.useRealTimers();
  });

  const renderWithInitialList = async (uris: string[]) => {
    listResources.mockResolvedValueOnce(listing(...uris));
    await act(async () => {
      tree = create(<AppsBrowser connection={connection} />);
    });
    await flush();
  };

  /** Drive the foreground poll → debounce → one fetch. */
  const refreshViaPoll = async (next: McpResourceDescriptor[] | Error) => {
    if (next instanceof Error) listResources.mockRejectedValueOnce(next);
    else listResources.mockResolvedValueOnce(next);
    await act(async () => {
      jest.advanceTimersByTime(RESOURCE_POLL_INTERVAL_MS);
      jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    });
    await flush();
  };

  const openResource = async (uri: string) => {
    await act(async () => {
      findByTestID(tree, `apps-resource-${uri}`).props.onPress();
    });
  };

  it('renders the fetched list', async () => {
    await renderWithInitialList(['ui://a', 'ui://b']);
    expect(findByTestID(tree, 'apps-resource-ui://a')).toBeDefined();
    expect(findByTestID(tree, 'apps-resource-ui://b')).toBeDefined();
  });

  it('does NOT remount an open resource when the list refreshes underneath it', async () => {
    await renderWithInitialList(['ui://a', 'ui://b']);
    await openResource('ui://a');
    expect(mockMounts).toEqual(['ui://a']);
    const openedWith = mockProps[0];

    // A refresh that genuinely changes the list: b renamed, c added.
    await refreshViaPoll([
      ...listing('ui://a'),
      { uri: 'ui://b', name: 'renamed', mimeType: 'text/html' },
      ...listing('ui://c'),
    ]);

    expect(mockMounts).toEqual(['ui://a']); // still exactly one mount
    expect(mockUnmounts).toEqual([]); // never torn down
    const latest = mockProps[mockProps.length - 1];
    expect(latest.resource).toBe(openedWith.resource); // same snapshot object
    expect(latest.onClose).toBe(openedWith.onClose); // stable callback identity
  });

  it('keeps a running resource alive even when it VANISHES from the list', async () => {
    await renderWithInitialList(['ui://a', 'ui://b']);
    await openResource('ui://a');

    await refreshViaPoll(listing('ui://b')); // a is gone

    expect(mockUnmounts).toEqual([]);
    expect(findByTestID(tree, 'stub-resource-view')).toBeDefined();
    const latest = mockProps[mockProps.length - 1];
    expect(latest.resource.uri).toBe('ui://a');
  });

  it('shows a dismissible notice on return when the open resource vanished', async () => {
    await renderWithInitialList(['ui://a', 'ui://b']);
    await openResource('ui://a');
    await refreshViaPoll(listing('ui://b'));

    await act(async () => {
      mockProps[mockProps.length - 1].onClose();
    });

    const notice = findByTestID(tree, 'apps-vanished-notice');
    expect(notice).toBeDefined();
    const noticeText = notice
      .findAll((node) => typeof node.props.children === 'string')
      .map((node) => node.props.children as string)
      .join(' ');
    expect(noticeText).toContain('no longer offered');
    expect(findByTestID(tree, 'apps-resource-ui://b')).toBeDefined(); // list still there

    await act(async () => notice.props.onPress());
    expect(tree.root.findAll((n) => n.props.testID === 'apps-vanished-notice')).toHaveLength(0);
  });

  it('shows NO notice when the closed resource is still listed', async () => {
    await renderWithInitialList(['ui://a']);
    await openResource('ui://a');
    await refreshViaPoll(listing('ui://a'));

    await act(async () => {
      mockProps[mockProps.length - 1].onClose();
    });
    expect(tree.root.findAll((n) => n.props.testID === 'apps-vanished-notice')).toHaveLength(0);
  });

  it('a failed refresh keeps the list on screen and flags it as stale', async () => {
    await renderWithInitialList(['ui://a', 'ui://b']);
    await refreshViaPoll(new Error('network down'));

    expect(findByTestID(tree, 'apps-resource-ui://a')).toBeDefined();
    expect(findByTestID(tree, 'apps-resource-ui://b')).toBeDefined();
    expect(findByTestID(tree, 'apps-stale-notice')).toBeDefined();
  });

  it('a failed FIRST load falls back (there is no list to keep)', async () => {
    listResources.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      tree = create(<AppsBrowser connection={connection} />);
    });
    await flush();
    expect(tree.root.findAll((n) => n.props.testID === 'apps-refresh-control')).toHaveLength(0);
  });

  it('pull-to-refresh re-fetches through the same path', async () => {
    await renderWithInitialList(['ui://a']);
    const control = findByTestID(tree, 'apps-refresh-control');
    listResources.mockResolvedValueOnce(listing('ui://a', 'ui://new'));
    await act(async () => control.props.onRefresh());
    await flush();
    expect(findByTestID(tree, 'apps-resource-ui://new')).toBeDefined();
  });

  it('ui.home auto-opens once and does NOT re-fire on refresh', async () => {
    const homed: ActiveConnection = { ...connection, uiHome: 'ui://a' };
    listResources.mockResolvedValueOnce(listing('ui://a', 'ui://b'));
    await act(async () => {
      tree = create(<AppsBrowser connection={homed} />);
    });
    await flush();
    expect(mockMounts).toEqual(['ui://a']);

    // User backs out of home, then a refresh lands.
    await act(async () => mockProps[mockProps.length - 1].onClose());
    listResources.mockResolvedValueOnce(listing('ui://a', 'ui://b'));
    await act(async () => {
      jest.advanceTimersByTime(RESOURCE_POLL_INTERVAL_MS);
      jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    });
    await flush();

    expect(mockMounts).toEqual(['ui://a']); // not yanked back to home
    expect(findByTestID(tree, 'apps-resource-ui://a')).toBeDefined();
  });
});

/**
 * Per-agent isolation across a connection SWITCH.
 *
 * These drive the real `AppsScreen`, not `AppsBrowser`, because the boundary
 * being locked is the `key` AppsScreen puts on the browser — testing the inner
 * component directly would step over the very thing under test.
 *
 * The rule "once a list is known, no event takes it away" holds within a
 * connection and is wrong across one (ADR 0007). Regression coverage for a real
 * defect: switching agents used to leave the previous agent's rows on screen
 * under the new agent's heading, and its open resource mounted and re-wired to
 * the new connection.
 */
describe('AppsScreen per-agent isolation on connection switch', () => {
  let tree: ReactTestRenderer;

  const alpha: ActiveConnection = {
    ...connection,
    id: 'conn-alpha',
    baseUrl: 'http://alpha:1',
    agentName: 'agent-alpha',
  };
  const beta: ActiveConnection = {
    ...connection,
    id: 'conn-beta',
    baseUrl: 'http://beta:2',
    agentName: 'agent-beta',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockMounts.length = 0;
    mockUnmounts.length = 0;
    mockProps.length = 0;
    listResources.mockReset();
    mockActiveConnection = null;
  });

  afterEach(() => {
    act(() => tree?.unmount());
    mockActiveConnection = null;
    jest.useRealTimers();
  });

  const rowIDs = () =>
    tree.root
      .findAll(
        (node) =>
          typeof node.props.testID === 'string' &&
          node.props.testID.startsWith('apps-resource-') &&
          typeof node.props.onPress === 'function',
      )
      .map((node) => node.props.testID as string);

  /** Mount on `alpha` with one resource listed. */
  const mountOnAlpha = async () => {
    mockActiveConnection = alpha;
    listResources.mockResolvedValueOnce(listing('ui://alpha/jobs@v1'));
    await act(async () => {
      tree = create(<AppsScreen />);
    });
    await flush();
    expect(rowIDs()).toEqual(['apps-resource-ui://alpha/jobs@v1']);
  };

  /** Switch the active connection, leaving beta's fetch outstanding. */
  const switchTo = async (next: ActiveConnection, betaList?: Promise<never>) => {
    mockActiveConnection = next;
    listResources.mockReturnValueOnce(betaList ?? new Promise<never>(() => {}));
    await act(async () => {
      tree.update(<AppsScreen />);
    });
  };

  it('does NOT list the previous agent’s resources after a switch', async () => {
    await mountOnAlpha();
    await switchTo(beta);

    // Beta has not answered yet — the correct state is "loading beta", never
    // "here are alpha's apps, labelled beta".
    expect(rowIDs()).toEqual([]);
  });

  it('does NOT keep the previous agent’s resource mounted after a switch', async () => {
    await mountOnAlpha();
    await act(async () => {
      findByTestID(tree, 'apps-resource-ui://alpha/jobs@v1').props.onPress();
    });
    expect(mockMounts).toEqual(['ui://alpha/jobs@v1']);

    await switchTo(beta);

    expect(mockUnmounts).toEqual(['ui://alpha/jobs@v1']);
    expect(tree.root.findAll((n) => n.props.testID === 'stub-resource-view')).toHaveLength(0);
  });

  it('a FAILING new agent falls back — it never inherits the old agent’s list', async () => {
    await mountOnAlpha();

    // The reviewed defect at its worst: a failed refresh keeps the last known
    // list, so a broken beta would have shown alpha's apps indefinitely.
    mockActiveConnection = beta;
    listResources.mockRejectedValueOnce(new Error('beta unreachable'));
    await act(async () => {
      tree.update(<AppsScreen />);
    });
    await flush();

    expect(rowIDs()).toEqual([]);
    expect(tree.root.findAll((n) => n.props.testID === 'apps-stale-notice')).toHaveLength(0);
  });

  it('re-pointing the SAME connection id at another agent also resets', async () => {
    await mountOnAlpha();
    // Editing a connection keeps its id but can move it to a different agent.
    await switchTo({ ...alpha, baseUrl: 'http://moved:9', agentName: 'agent-moved' });

    expect(rowIDs()).toEqual([]);
  });

  it('the new agent’s own list renders once it answers', async () => {
    await mountOnAlpha();
    mockActiveConnection = beta;
    listResources.mockResolvedValueOnce(listing('ui://beta/home@v1'));
    await act(async () => {
      tree.update(<AppsScreen />);
    });
    await flush();

    expect(rowIDs()).toEqual(['apps-resource-ui://beta/home@v1']);
  });
});
