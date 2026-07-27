/**
 * Add/Edit connection modal: URL + token, validate-and-handshake on save.
 * Errors from the handshake render inline; nothing is persisted on failure
 * (the handshake module fails closed). Tokens use secureTextEntry and are
 * never echoed back into the form or any message.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ApiClientError } from '@/api/client';
import type { ConnectionRecord } from '@/connections/types';

export interface ConnectionFormProps {
  visible: boolean;
  /** Present when editing; absent when adding. */
  existing: ConnectionRecord | null;
  onSave: (input: { id?: string; baseUrl: string; token: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

const messageFor = (err: unknown): string => {
  if (err instanceof ApiClientError) {
    switch (err.kind) {
      case 'network':
        return 'Could not reach the agent. Check the URL and your network (tailnet up?).';
      case 'http':
        return err.status === 401 || err.status === 403
          ? 'The agent rejected the token. Check it and try again.'
          : `The agent responded with HTTP ${err.status ?? 'error'}.`;
      case 'shape':
        return 'That server is not a compatible app-ingress v1 agent.';
    }
  }
  return 'Something went wrong while saving the connection.';
};

export function ConnectionForm({
  visible,
  existing,
  onSave,
  onDelete,
  onClose,
}: ConnectionFormProps) {
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmedUrl = baseUrl.trim();
    if (!/^https?:\/\/\S+$/.test(trimmedUrl)) {
      setError('Enter the agent base URL, e.g. http://100.64.0.7:8787');
      return;
    }
    if (token.length === 0) {
      setError(
        existing
          ? 'Re-enter the token to re-handshake this connection.'
          : 'Enter the connection token.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ id: existing?.id, baseUrl: trimmedUrl, token });
      onClose();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    try {
      await onDelete(existing.id);
      onClose();
    } catch {
      setError('Could not delete the connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>{existing ? 'Edit connection' : 'Add connection'}</Text>

          <Text style={styles.label}>Agent URL</Text>
          <TextInput
            style={styles.input}
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="http://100.64.0.7:8787"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy}
            testID="connection-url"
          />

          <Text style={styles.label}>Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder={existing ? 'Re-enter token' : 'Connection token'}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            testID="connection-token"
          />

          {error !== null && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.secondary]} onPress={onClose} disabled={busy}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={save} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>{existing ? 'Re-handshake & save' : 'Save'}</Text>
              )}
            </Pressable>
          </View>

          {existing && (
            <Pressable style={styles.deleteLink} onPress={remove} disabled={busy}>
              <Text style={styles.deleteText}>Delete this connection</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 8,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.7,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondary: {
    backgroundColor: '#e5e7eb',
  },
  secondaryText: {
    color: '#111827',
    fontWeight: '600',
  },
  deleteLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  deleteText: {
    color: '#dc2626',
    fontWeight: '500',
  },
});
