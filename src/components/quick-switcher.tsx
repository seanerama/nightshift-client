/**
 * Quick-switcher bottom sheet (stage 10): opened by tapping the header
 * identity on Chat/Apps. Same in-screen Modal pattern as the connection form
 * — NO new nav routes. Rows come from the pure list model; tapping a row
 * dispatches the switch (existing context setActive — stage-9 switching
 * semantics do the rest) and closes; "Manage connections…" hands off to the
 * Connections tab via the onManage callback (expo-router navigation lives in
 * the caller, keeping this component presentational and testable).
 */

import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ConnectionRecord } from '@/connections/types';
import { usePalette } from '@/theme/theme-context';
import type { Palette } from '@/theme/tokens';
import { buildSwitcherRows, type SwitcherRow, shouldDispatchSwitch } from './quick-switcher-model';

export interface QuickSwitcherProps {
  visible: boolean;
  connections: readonly ConnectionRecord[];
  /** Dispatch the switch (context setActive). Not called for the active row. */
  onSelect: (id: string) => void;
  /** Navigate to the Connections tab (caller owns the router). */
  onManage: () => void;
  onClose: () => void;
}

export function QuickSwitcher({
  visible,
  connections,
  onSelect,
  onManage,
  onClose,
}: QuickSwitcherProps) {
  const palette = usePalette();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const rows = buildSwitcherRows(connections);

  const pressRow = (row: SwitcherRow) => {
    if (shouldDispatchSwitch(row)) onSelect(row.id);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="switcher-backdrop">
        {/* stopPropagation-by-Pressable: taps inside the sheet must not close it. */}
        <Pressable style={styles.sheetWrapper} onPress={() => {}}>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheet}
            bounces={false}
          >
            <Text style={styles.heading}>Switch agent</Text>
            {rows.map((row) => (
              <Pressable
                key={row.id}
                style={styles.row}
                onPress={() => pressRow(row)}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${row.name}`}
                testID={`switcher-row-${row.id}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{row.name}</Text>
                  <Text style={styles.rowUrl}>{row.baseUrl}</Text>
                </View>
                {row.isActive && (
                  <Text style={styles.activeCheck} testID={`switcher-active-${row.id}`}>
                    ✓
                  </Text>
                )}
              </Pressable>
            ))}
            <Pressable
              style={styles.manageRow}
              onPress={() => {
                onClose();
                onManage();
              }}
              accessibilityRole="button"
              testID="switcher-manage"
            >
              <Text style={styles.manageText}>Manage connections…</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: palette.scrim,
    },
    sheetWrapper: {
      // Cap the sheet; long lists scroll inside.
      maxHeight: '70%',
    },
    sheetScroll: {
      flexGrow: 0,
      backgroundColor: palette.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    sheet: {
      padding: 20,
      gap: 8,
    },
    heading: {
      fontSize: 18,
      fontWeight: '600',
      marginBottom: 8,
      color: palette.text,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: palette.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      borderRadius: 12,
      padding: 14,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowName: {
      fontSize: 15,
      fontWeight: '600',
      color: palette.text,
    },
    rowUrl: {
      fontSize: 12,
      color: palette.textMuted,
    },
    activeCheck: {
      fontSize: 16,
      fontWeight: '700',
      color: palette.accent,
    },
    manageRow: {
      marginTop: 8,
      alignItems: 'center',
      paddingVertical: 10,
    },
    manageText: {
      color: palette.accent,
      fontWeight: '600',
      fontSize: 14,
    },
  });
