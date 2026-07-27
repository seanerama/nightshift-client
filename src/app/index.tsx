/**
 * Connections tab (stage 3): list of agent connections, add/edit/delete,
 * switch-active, and a health dot for the active connection.
 */

import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConnectionForm } from '@/components/connection-form';
import { useConnections } from '@/connections/connections-context';
import { healthColor, healthLabel } from '@/connections/health';
import type { ConnectionRecord } from '@/connections/types';

export default function ConnectionsScreen() {
  const { loading, connections, health, saveConnection, removeConnection, setActive } =
    useConnections();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionRecord | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (record: ConnectionRecord) => {
    setEditing(record);
    setFormOpen(true);
  };
  const confirmDelete = (record: ConnectionRecord) => {
    Alert.alert(
      'Delete connection',
      `Remove "${record.agentName}"? Its token will be deleted from secure storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void removeConnection(record.id),
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: ConnectionRecord }) => (
    <Pressable
      style={styles.row}
      onPress={() => openEdit(item)}
      onLongPress={() => confirmDelete(item)}
      testID={`connection-row-${item.id}`}
    >
      <View style={styles.rowHeader}>
        {item.isActive && (
          <View
            style={[styles.dot, { backgroundColor: healthColor(health) }]}
            accessibilityLabel={`Health: ${healthLabel(health)}`}
          />
        )}
        <Text style={styles.name}>
          {item.agentName} <Text style={styles.version}>v{item.agentVersion}</Text>
        </Text>
        {item.isActive ? (
          <Text style={styles.activeBadge}>Active</Text>
        ) : (
          <Pressable style={styles.makeActive} onPress={() => void setActive(item.id)}>
            <Text style={styles.makeActiveText}>Make active</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.url}>{item.baseUrl}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={connections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={connections.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No agents yet</Text>
              <Text style={styles.emptySubtitle}>
                Add a connection with your agent's URL and token.
              </Text>
            </View>
          )
        }
      />
      <Pressable style={styles.fab} onPress={openAdd} testID="add-connection">
        <Text style={styles.fabText}>+</Text>
      </Pressable>
      {formOpen && (
        <ConnectionForm
          key={editing?.id ?? 'new'}
          visible={formOpen}
          existing={editing}
          onSave={saveConnection}
          onDelete={removeConnection}
          onClose={() => setFormOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: 12,
    gap: 8,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  row: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  version: {
    fontSize: 13,
    fontWeight: '400',
    opacity: 0.6,
  },
  activeBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
  },
  makeActive: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  makeActiveText: {
    fontSize: 12,
    color: '#2563eb',
  },
  url: {
    fontSize: 13,
    opacity: 0.6,
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    opacity: 0.6,
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabText: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 32,
  },
});
