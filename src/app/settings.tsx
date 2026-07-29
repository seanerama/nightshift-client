/**
 * Settings tab (stage 12). Previously an empty PlaceholderScreen; this is the
 * app's first surface for preferences that belong to the PHONE rather than to
 * an agent (agent-scoped settings live on the Connections tab).
 *
 * Thin over tested pure logic, per house style: the preference type, its
 * resolution against the device scheme, and its labels live in
 * src/theme/preference.ts.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { THEME_PREFERENCES, type ThemePreference, themePreferenceLabel } from '@/theme/preference';
import { useTheme } from '@/theme/theme-context';
import type { Palette } from '@/theme/tokens';

export default function SettingsScreen() {
  const { preference, scheme, palette, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionHeading}>Appearance</Text>

      <View style={styles.card}>
        {THEME_PREFERENCES.map((option: ThemePreference) => {
          const selected = option === preference;
          return (
            <Pressable
              key={option}
              style={styles.option}
              onPress={() => setPreference(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`theme-option-${option}`}
            >
              <Text style={styles.optionLabel}>{themePreferenceLabel(option)}</Text>
              {selected && (
                <Text style={styles.check} testID={`theme-selected-${option}`}>
                  ✓
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.help} testID="theme-help">
        {preference === 'system'
          ? `Following your device, which is currently ${scheme}.`
          : `Always ${scheme}, regardless of your device setting.`}
      </Text>
      <Text style={styles.help}>
        Apps served by an agent follow this setting too — they are told which theme to render in.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.background,
    },
    content: {
      padding: 16,
      gap: 8,
    },
    sectionHeading: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.textMuted,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      overflow: 'hidden',
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 14,
      gap: 10,
    },
    optionLabel: {
      flex: 1,
      fontSize: 15,
      color: palette.text,
    },
    check: {
      fontSize: 16,
      fontWeight: '700',
      color: palette.accent,
    },
    help: {
      fontSize: 12,
      color: palette.textMuted,
      lineHeight: 16,
      paddingHorizontal: 2,
    },
  });
