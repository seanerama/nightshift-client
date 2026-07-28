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

// AppsBrowser takes its connection as a prop; the provider (and its expo-sqlite
// store) is not part of what this file locks.
jest.mock('@/connections/connections-context', () => ({ useActiveConnection: () => null }));

jest.mock('@/mcp/client', () => ({
  initialize: jest.fn(async () => ({ protocolVersion: '2025-06-18', capabilities: {} })),
  listResources: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { listResources } = require('@/mcp/client') as { listResources: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppsBrowser } = require('./apps') as {
  AppsBrowser: (props: { connection: ActiveConnection }) => React.ReactElement;
};

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
