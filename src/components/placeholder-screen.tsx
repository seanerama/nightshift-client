import { StyleSheet, Text, View } from 'react-native';

/**
 * Placeholder for tabs whose real screen has not landed yet (Chat → stage 4,
 * Apps → stage 5). Stage 3 adds capability-gating subtitles.
 */
export function PlaceholderScreen({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle ?? 'Coming in a later stage.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.6,
  },
});
