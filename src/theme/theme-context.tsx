/**
 * Theme provider (stage 12, ADR 0008).
 *
 * Holds the owner's Light/Dark/System preference, resolves it against the
 * device scheme, and hands the resolved palette to every screen. Persistence
 * goes through the AppSettingsStore seam so unit tests never touch sqlite.
 *
 * The resolved scheme is also what `resource-view.tsx` pushes as `ui/theme` to
 * agent-served resource HTML — so choosing Dark here darkens those too. That is
 * the whole point: before this, resources honoured dark mode and the shell
 * around them did not.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import type { AppSettingsStore } from '../settings/types';
import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  resolveScheme,
  THEME_PREFERENCE_KEY,
  type ThemePreference,
} from './preference';
import { type Palette, paletteFor, type Scheme } from './tokens';

export interface ThemeContextValue {
  /** What the owner chose. */
  preference: ThemePreference;
  /** What that resolves to right now, given the device scheme. */
  scheme: Scheme;
  palette: Palette;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * The sqlite store is loaded LAZILY rather than imported at module scope: a
 * static import would pull expo-sqlite into every test that renders anything
 * under this provider. The native module is only touched when the default is
 * actually used.
 */
const defaultStore = async (): Promise<AppSettingsStore> =>
  (await import('../settings/sqlite-app-settings')).getSqliteAppSettingsStore();

export interface ThemeProviderProps {
  children: ReactNode;
  /** Injectable for tests/previews; defaults to the sqlite-backed store. */
  store?: () => Promise<AppSettingsStore>;
}

export function ThemeProvider({
  children,
  store: storeFactory = defaultStore,
}: ThemeProviderProps) {
  const deviceScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);

  // Load the persisted preference once. A failure leaves the default in place:
  // an unreadable settings row must never keep the app off the screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const value = await (await storeFactory()).get(THEME_PREFERENCE_KEY);
        if (!cancelled && value !== null) setPreferenceState(parseThemePreference(value));
      } catch {
        // keep DEFAULT_THEME_PREFERENCE
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeFactory]);

  // Applied instantly; the write is fire-and-forget so the UI never waits on
  // disk for a preference change.
  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      void (async () => {
        try {
          await (await storeFactory()).set(THEME_PREFERENCE_KEY, next);
        } catch {
          // The choice still applies for this session.
        }
      })();
    },
    [storeFactory],
  );

  const scheme = resolveScheme(preference, deviceScheme);
  const value = useMemo<ThemeContextValue>(
    () => ({ preference, scheme, palette: paletteFor(scheme), setPreference }),
    [preference, scheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Full theme access, including `setPreference`. Throws outside a provider:
 * anything trying to CHANGE the theme without one is a wiring bug that should
 * be loud.
 */
export const useTheme = (): ThemeContextValue => {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error('useTheme must be used inside a ThemeProvider');
  return value;
};

/**
 * Read-only colours — the common case.
 *
 * Deliberately does NOT throw outside a provider: this is presentation, and a
 * component rendered without one should fall back to light rather than take the
 * screen down. `_layout.tsx` wraps the whole app, so the fallback is for
 * isolated renders (unit tests, previews) rather than production paths — and a
 * genuinely mis-wired app still fails loudly through `useTheme` on Settings.
 */
export const usePalette = (): Palette => useContext(ThemeContext)?.palette ?? paletteFor('light');
