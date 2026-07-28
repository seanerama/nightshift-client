/**
 * Header identity for the Chat and Apps tabs (stage 10): the active agent's
 * name + the stage-3 health dot in place of the static tab title, and the
 * tap target that opens the quick-switcher sheet. With no active connection
 * the static title renders, non-interactive.
 *
 * Thin over tested pure logic (header-identity-model.ts) — jest cannot render
 * the Tabs navigator this mounts inside, so nothing decision-shaped may live
 * here.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useConnections } from '@/connections/connections-context';
import { usePalette } from '@/theme/theme-context';
import type { Palette } from '@/theme/tokens';
import { headerIdentityModel } from './header-identity-model';
import { QuickSwitcher } from './quick-switcher';

export interface HeaderIdentityProps {
  /** The tab's static title, shown when no connection is active. */
  fallbackTitle: string;
}

export function HeaderIdentity({ fallbackTitle }: HeaderIdentityProps) {
  const { connections, active, health, setActive } = useConnections();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const router = useRouter();
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const model = headerIdentityModel(active, health, fallbackTitle, palette);

  if (model.kind === 'static') {
    return <Text style={styles.staticTitle}>{model.title}</Text>;
  }

  return (
    <>
      <Pressable
        style={styles.identity}
        onPress={() => setSwitcherOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Active agent: ${model.title} (${model.healthLabel}). Switch agent`}
        testID="header-identity"
      >
        <View
          style={[styles.dot, { backgroundColor: model.dotColor }]}
          accessibilityLabel={`Health: ${model.healthLabel}`}
        />
        <Text style={styles.title} numberOfLines={1}>
          {model.title}
        </Text>
      </Pressable>
      <QuickSwitcher
        visible={switcherOpen}
        connections={connections}
        onSelect={(id) => void setActive(id)}
        onManage={() => router.navigate('/connections')}
        onClose={() => setSwitcherOpen(false)}
      />
    </>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    staticTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: palette.text,
    },
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      maxWidth: 220,
      color: palette.text,
    },
  });
