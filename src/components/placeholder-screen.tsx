import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { usePalette } from '@/theme/theme-context';
import type { Palette } from '@/theme/tokens';

/**
 * Placeholder for a tab whose real screen is absent or gated off — an agent
 * that does not declare a capability, or a kill-switch that is down.
 */
export function PlaceholderScreen({ title, subtitle }: { title: string; subtitle?: string }) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle ?? 'Coming in a later stage.'}</Text>
    </View>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: palette.background,
    },
    title: {
      fontSize: 24,
      fontWeight: '600',
      color: palette.text,
    },
    subtitle: {
      fontSize: 14,
      color: palette.textMuted,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
  });
