/**
 * Theme preference: what the owner chose, and how it resolves (ADR 0008).
 *
 * Three-way rather than a boolean, because "follow the phone" is a real answer
 * and it is the DEFAULT — so this stage is a no-op for anyone who never opens
 * Settings.
 */

import type { Scheme } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** The settings row key; see migration v4 (`app_settings`). */
export const THEME_PREFERENCE_KEY = 'theme_preference';

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);

/** Anything unrecognised — a corrupt row, a value written by a newer build —
 * falls back to the default rather than throwing. */
export const parseThemePreference = (value: unknown): ThemePreference =>
  isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;

/**
 * Resolve the preference against the device scheme.
 *
 * `deviceScheme` is React Native's `ColorSchemeName`, which is `null` while
 * unknown and can be the string 'unspecified' — anything that is not literally
 * 'dark' resolves light, so an unknown device scheme never flashes dark.
 */
export const resolveScheme = (
  preference: ThemePreference,
  deviceScheme: string | null | undefined,
): Scheme => {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return deviceScheme === 'dark' ? 'dark' : 'light';
};

export const themePreferenceLabel = (preference: ThemePreference): string => {
  switch (preference) {
    case 'system':
      return 'System';
    case 'light':
      return 'Light';
    case 'dark':
      return 'Dark';
  }
};
