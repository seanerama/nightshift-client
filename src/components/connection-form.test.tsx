/**
 * Regression test for issue #13: on a physical Android device (SDK 57
 * edge-to-edge, where the modal window ignores adjustResize) the soft
 * keyboard opened OVER the Add/Edit connection form, hiding the focused
 * input and the Save button.
 *
 * Jest cannot render a device keyboard, so this is an honest structure test:
 * the form must mount its sheet inside a KeyboardAvoidingView (behavior
 * "padding" — the only behavior that works inside an edge-to-edge modal
 * window, and it self-corrects to ~0 on windows that do resize) and a
 * ScrollView with keyboardShouldPersistTaps="handled" so the fields scroll
 * above the keyboard and Save stays tappable while the keyboard is up.
 * This fails on the v0.1.0 tree (plain Views) and passes after the fix.
 */

import { KeyboardAvoidingView, ScrollView, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ConnectionForm } from './connection-form';

const noopSave = async () => {};
const noopDelete = async () => {};
const noopClose = () => {};

describe('ConnectionForm keyboard handling (issue #13)', () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    act(() => {
      tree = create(
        <ConnectionForm
          visible
          existing={null}
          onSave={noopSave}
          onDelete={noopDelete}
          onClose={noopClose}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      tree.unmount();
    });
  });

  it('wraps the sheet in a KeyboardAvoidingView with behavior="padding"', () => {
    const avoider = tree.root.findByType(KeyboardAvoidingView);
    expect(avoider.props.behavior).toBe('padding');
  });

  it('hosts the form in a ScrollView that keeps taps working under the keyboard', () => {
    const scroll = tree.root.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('keeps both inputs inside the KeyboardAvoidingView > ScrollView subtree', () => {
    const avoider = tree.root.findByType(KeyboardAvoidingView);
    const scroll = avoider.findByType(ScrollView);
    expect(scroll.findAllByProps({ testID: 'connection-url' }).length).toBeGreaterThan(0);
    expect(scroll.findAllByProps({ testID: 'connection-token' }).length).toBeGreaterThan(0);
  });

  it('masks the token by default and the Show/Hide toggle flips secureTextEntry', () => {
    const tokenField = () =>
      tree.root.findAll(
        (node) => node.type === TextInput && node.props.testID === 'connection-token',
      )[0];
    const toggle = () =>
      tree.root.findAll(
        (node) =>
          node.props.testID === 'connection-token-toggle' &&
          typeof node.props.onPress === 'function',
      )[0];

    // default: hidden
    expect(tokenField().props.secureTextEntry).toBe(true);
    expect(toggle().props.accessibilityLabel).toBe('Show token');

    act(() => {
      toggle().props.onPress();
    });
    expect(tokenField().props.secureTextEntry).toBe(false);
    expect(toggle().props.accessibilityLabel).toBe('Hide token');

    act(() => {
      toggle().props.onPress();
    });
    expect(tokenField().props.secureTextEntry).toBe(true);
    expect(toggle().props.accessibilityLabel).toBe('Show token');
  });
});
