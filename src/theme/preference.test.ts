/**
 * Unit: theme preference resolution (stage 12, ADR 0008).
 *
 * The property that matters most: **System is the default and resolves to the
 * device scheme**, so this stage is a no-op for anyone who never opens
 * Settings.
 */

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  parseThemePreference,
  resolveScheme,
  THEME_PREFERENCES,
  themePreferenceLabel,
} from './preference';

describe('the default', () => {
  it('is System', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
  });

  it('resolves to whatever the device says — a no-op for anyone who never opens Settings', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
  });
});

describe('resolveScheme', () => {
  it('an explicit choice overrides the device in BOTH directions', () => {
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });

  it.each([
    null,
    undefined,
    'unspecified',
    '',
  ])('treats an unknown device scheme (%s) as light rather than flashing dark', (deviceScheme) => {
    expect(resolveScheme('system', deviceScheme as string | null | undefined)).toBe('light');
  });

  it('an explicit choice does not care that the device scheme is unknown', () => {
    expect(resolveScheme('dark', null)).toBe('dark');
    expect(resolveScheme('light', undefined)).toBe('light');
  });
});

describe('parseThemePreference', () => {
  it.each(THEME_PREFERENCES)('round-trips %s', (preference) => {
    expect(parseThemePreference(preference)).toBe(preference);
  });

  it.each([
    null,
    undefined,
    42,
    {},
    'DARK',
    'sepia',
    '',
  ])('falls back to the default for %s rather than throwing', (value) => {
    // A corrupt row, or one written by a newer build, must not brick startup.
    expect(parseThemePreference(value)).toBe(DEFAULT_THEME_PREFERENCE);
  });
});

describe('isThemePreference', () => {
  it('accepts exactly the three known values', () => {
    expect(THEME_PREFERENCES.every(isThemePreference)).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe('themePreferenceLabel', () => {
  it('labels every preference', () => {
    expect(THEME_PREFERENCES.map(themePreferenceLabel)).toEqual(['System', 'Light', 'Dark']);
  });
});
