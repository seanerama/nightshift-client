/**
 * Component: quick-switcher sheet dispatch semantics (stage 10). The list
 * shape itself is covered by quick-switcher-model.test.ts; this mounts the
 * thin renderer to lock the wiring — row tap → onSelect(id) + onClose,
 * active-row tap → close WITHOUT a switch dispatch, and the Manage row →
 * onClose + onManage.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { ConnectionRecord } from '@/connections/types';
import { QuickSwitcher } from './quick-switcher';

const record = (overrides: Partial<ConnectionRecord>): ConnectionRecord => ({
  id: 'conn-1',
  baseUrl: 'http://a:1',
  agentName: 'agent-a',
  agentVersion: '1.0.0',
  capabilities: ['chat'],
  uiHome: null,
  isActive: false,
  createdAt: '2026-07-27T00:00:00.000Z',
  personId: null,
  ...overrides,
});

const connections = [
  record({ id: 'a', agentName: 'alpha', baseUrl: 'http://a:1', isActive: true }),
  record({ id: 'b', agentName: 'beta', baseUrl: 'http://b:2' }),
];

describe('QuickSwitcher', () => {
  let tree: ReactTestRenderer;
  const onSelect = jest.fn();
  const onManage = jest.fn();
  const onClose = jest.fn();

  const pressable = (testID: string) =>
    tree.root.findAll(
      (node) => node.props.testID === testID && typeof node.props.onPress === 'function',
    )[0];

  beforeEach(() => {
    act(() => {
      tree = create(
        <QuickSwitcher
          visible
          connections={connections}
          onSelect={onSelect}
          onManage={onManage}
          onClose={onClose}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      tree.unmount();
    });
  });

  it('renders a row per connection with the active check on the active one only', () => {
    expect(pressable('switcher-row-a')).toBeDefined();
    expect(pressable('switcher-row-b')).toBeDefined();
    expect(tree.root.findAllByProps({ testID: 'switcher-active-a' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'switcher-active-b' })).toHaveLength(0);
  });

  it('tapping an inactive row dispatches the switch and closes', () => {
    act(() => {
      pressable('switcher-row-b').props.onPress();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tapping the active row closes without a switch dispatch', () => {
    act(() => {
      pressable('switcher-row-a').props.onPress();
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the Manage row closes the sheet and hands off to the Connections tab', () => {
    act(() => {
      pressable('switcher-manage').props.onPress();
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});
