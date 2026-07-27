/**
 * expo-secure-store implementation of TokenVault. Tokens are stored ONLY here
 * (Android Keystore-backed), keyed by connection id — never in sqlite,
 * AsyncStorage, logs, or error messages.
 *
 * Native module: this file must never be imported by unit tests (they use the
 * in-memory fake).
 */

import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

import type { TokenVault } from './types';

/** SecureStore keys allow only [A-Za-z0-9._-]; connection ids comply. */
const keyFor = (connectionId: string): string => `connection-token.${connectionId}`;

export const secureTokenVault: TokenVault = {
  getToken: (connectionId) => getItemAsync(keyFor(connectionId)),
  setToken: async (connectionId, token) => {
    await setItemAsync(keyFor(connectionId), token);
  },
  deleteToken: async (connectionId) => {
    await deleteItemAsync(keyFor(connectionId));
  },
};
