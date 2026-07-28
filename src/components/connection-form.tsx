/**
 * Add/Edit connection modal: URL + token, validate-and-handshake on save.
 * Errors from the handshake render inline; nothing is persisted on failure
 * (the handshake module fails closed). Tokens use secureTextEntry and are
 * never echoed back into the form or any message.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
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
  // Display-only visibility toggle (issue #13 follow-up: blind token entry is
  // error-prone). Flips secureTextEntry for THIS field; the value itself is
  // still never logged, echoed into messages, or persisted anywhere new.
  const [showToken, setShowToken] = useState(false);
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
      {/* Issue #13: under SDK 57 edge-to-edge (forced on Android 15+) the modal
          window ignores adjustResize, so the window never shrinks for the soft
          keyboard and it opened OVER the form. behavior="padding" pads by the
          MEASURED overlap with the keyboard (RN emits keyboardDidShow from IME
          insets), so it also degrades to ~0 padding on windows that do resize
          (older Android, iOS never resizes). The ScrollView keeps the focused
          field reachable when space runs out, and keyboardShouldPersistTaps
          lets Save be tapped while the keyboard is still up. */}
      <KeyboardAvoidingView style={styles.backdrop} behavior="padding">
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheet}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
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
          <View style={styles.tokenRow}>
            <TextInput
              style={[styles.input, styles.tokenInput]}
              value={token}
              onChangeText={setToken}
              placeholder={existing ? 'Re-enter token' : 'Connection token'}
              secureTextEntry={!showToken}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              testID="connection-token"
            />
            <Pressable
              style={styles.tokenToggle}
              onPress={() => setShowToken((visible) => !visible)}
              accessibilityRole="button"
              accessibilityLabel={showToken ? 'Hide token' : 'Show token'}
              testID="connection-token-toggle"
            >
              <Text style={styles.tokenToggleText}>{showToken ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>

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
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  // The scroll container carries the sheet chrome; flexGrow 0 keeps it
  // bottom-anchored (backdrop is justify-end) and lets it cap at the space
  // left above the keyboard, at which point the content scrolls.
  sheetScroll: {
    flexGrow: 0,
    backgroundColor: '#fff',
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
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tokenInput: {
    flex: 1,
  },
  tokenToggle: {
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  tokenToggleText: {
    color: '#2563eb',
    fontWeight: '600',
    fontSize: 13,
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
