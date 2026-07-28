/**
 * Component: the Settings theme control (stage 12).
 *
 * Locks that choosing a preference PERSISTS it (the store is the seam) and
 * that the selection is reflected back — the screen was an empty placeholder
 * before this stage, so there is no prior behaviour to preserve.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MemoryAppSettingsStore } from '@/settings/memory';
import { THEME_PREFERENCE_KEY } from '@/theme/preference';
import { ThemeProvider } from '@/theme/theme-context';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => 'light',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SettingsScreen = require('./settings').default as () => React.ReactElement;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const render = async (store: MemoryAppSettingsStore) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider store={async () => store}>
        <SettingsScreen />
      </ThemeProvider>,
    );
  });
  await flush();
  return tree;
};

const press = async (tree: ReactTestRenderer, testID: string) => {
  const node = tree.root.findAll(
    (n) => n.props.testID === testID && typeof n.props.onPress === 'function',
  )[0];
  await act(async () => node.props.onPress());
  await flush();
};

const isSelected = (tree: ReactTestRenderer, option: string): boolean =>
  tree.root.findAll((n) => n.props.testID === `theme-selected-${option}`).length > 0;

describe('SettingsScreen theme control', () => {
  it('offers all three options and marks System by default', async () => {
    const tree = await render(new MemoryAppSettingsStore());
    for (const option of ['system', 'light', 'dark']) {
      expect(
        tree.root.findAll((n) => n.props.testID === `theme-option-${option}`).length,
      ).toBeGreaterThan(0);
    }
    expect(isSelected(tree, 'system')).toBe(true);
  });

  it('persists the chosen preference', async () => {
    const store = new MemoryAppSettingsStore();
    const tree = await render(store);

    await press(tree, 'theme-option-dark');

    expect(await store.get(THEME_PREFERENCE_KEY)).toBe('dark');
    expect(isSelected(tree, 'dark')).toBe(true);
    expect(isSelected(tree, 'system')).toBe(false);
  });

  it('switching back to System persists that too', async () => {
    const store = new MemoryAppSettingsStore({ [THEME_PREFERENCE_KEY]: 'dark' });
    const tree = await render(store);
    expect(isSelected(tree, 'dark')).toBe(true);

    await press(tree, 'theme-option-system');

    expect(await store.get(THEME_PREFERENCE_KEY)).toBe('system');
    expect(isSelected(tree, 'system')).toBe(true);
  });

  it('explains what the current choice means', async () => {
    const tree = await render(new MemoryAppSettingsStore());
    const help = tree.root.findAll((n) => n.props.testID === 'theme-help')[0];
    expect(String(help.props.children)).toContain('device');
  });
});
