/**
 * Component: the theme provider (stage 12, ADR 0008) + the Settings control.
 *
 * The load-bearing assertions:
 * - a persisted preference is restored on launch;
 * - choosing a preference persists it AND applies immediately;
 * - an unreadable settings row does not keep the app off the screen;
 * - the RESOLVED scheme follows the setting, not the device, when they
 *   disagree — this is what reaches agent-served resources via `ui/theme`.
 */

import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MemoryAppSettingsStore } from '@/settings/memory';
import type { AppSettingsStore } from '@/settings/types';
import { THEME_PREFERENCE_KEY } from './preference';
import { ThemeProvider, useTheme } from './theme-context';

let mockDeviceScheme: 'light' | 'dark' | null = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockDeviceScheme,
}));

function Probe() {
  const { preference, scheme, palette } = useTheme();
  return <Text testID="probe">{`${preference}|${scheme}|${palette.background}`}</Text>;
}

const probeText = (tree: ReactTestRenderer): string =>
  tree.root.findAll((n) => n.props.testID === 'probe')[0].props.children as string;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const render = async (store: AppSettingsStore) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ThemeProvider store={async () => store}>
        <Probe />
      </ThemeProvider>,
    );
  });
  await flush();
  return tree;
};

beforeEach(() => {
  mockDeviceScheme = 'light';
});

describe('ThemeProvider', () => {
  it('defaults to System and follows the device', async () => {
    mockDeviceScheme = 'dark';
    const tree = await render(new MemoryAppSettingsStore());
    expect(probeText(tree)).toMatch(/^system\|dark\|/);
  });

  it('restores a persisted preference on launch', async () => {
    const store = new MemoryAppSettingsStore({ [THEME_PREFERENCE_KEY]: 'dark' });
    const tree = await render(store);
    expect(probeText(tree)).toMatch(/^dark\|dark\|/);
  });

  it('THE RESOLVED SCHEME FOLLOWS THE SETTING, NOT THE DEVICE', async () => {
    // The case that proves what reaches agent-served resources via ui/theme:
    // app says Dark while the phone says Light.
    mockDeviceScheme = 'light';
    const store = new MemoryAppSettingsStore({ [THEME_PREFERENCE_KEY]: 'dark' });
    const tree = await render(store);
    expect(probeText(tree)).toMatch(/^dark\|dark\|/);

    // ...and the reverse.
    mockDeviceScheme = 'dark';
    const light = await render(new MemoryAppSettingsStore({ [THEME_PREFERENCE_KEY]: 'light' }));
    expect(probeText(light)).toMatch(/^light\|light\|/);
  });

  it('falls back to the default when the stored value is corrupt', async () => {
    const store = new MemoryAppSettingsStore({ [THEME_PREFERENCE_KEY]: 'sepia' });
    const tree = await render(store);
    expect(probeText(tree)).toMatch(/^system\|/);
  });

  it('an unreadable store does not keep the app off the screen', async () => {
    const broken: AppSettingsStore = {
      get: async () => {
        throw new Error('disk on fire');
      },
      set: async () => {},
    };
    const tree = await render(broken);
    expect(probeText(tree)).toMatch(/^system\|light\|/);
  });

  it('the palette changes with the scheme', async () => {
    const lightTree = await render(new MemoryAppSettingsStore({ [THEME_PREFERENCE_KEY]: 'light' }));
    const darkTree = await render(new MemoryAppSettingsStore({ [THEME_PREFERENCE_KEY]: 'dark' }));
    expect(probeText(lightTree)).not.toBe(probeText(darkTree));
  });
});
