/**
 * Manifest handshake: the only path by which a connection is created or
 * updated (stage 3).
 *
 * Fail closed: `GET /app/v1/manifest` runs FIRST (the stage-1 client already
 * enforces the app-ingress/v1 contract pin and rejects bad shapes / non-2xx /
 * network failures with a typed ApiClientError). Only after a valid manifest
 * arrives is anything persisted — token into the vault, metadata snapshot into
 * the store. On any handshake failure nothing is written. Re-handshake on edit
 * replaces the manifest snapshot under the same id.
 */

import type { Manifest } from 'agent-app-contract/types';

import { type AgentConnection, getManifest } from '../api/client';
import type { ConnectionRecord, ConnectionStore, TokenVault } from './types';
import { newConnectionId } from './types';

export interface HandshakeInput {
  /** Present when editing an existing connection; absent when adding. */
  id?: string;
  baseUrl: string;
  token: string;
}

export interface HandshakeDeps {
  store: ConnectionStore;
  vault: TokenVault;
  /** Injectable for tests; defaults to the stage-1 client's getManifest. */
  fetchManifest?: (connection: AgentConnection) => Promise<Manifest>;
  now?: () => Date;
  newId?: () => string;
}

/**
 * Handshake with the agent and, only on success, persist token + metadata.
 * Returns the persisted record. Throws (typically ApiClientError) with
 * NOTHING persisted when the handshake fails.
 */
export const addOrUpdateConnection = async (
  input: HandshakeInput,
  deps: HandshakeDeps,
): Promise<ConnectionRecord> => {
  const fetchManifest = deps.fetchManifest ?? getManifest;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? newConnectionId;

  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');

  // 1. Handshake first — any failure here throws before anything persists.
  const manifest = await fetchManifest({ baseUrl, token: input.token });

  // 2. Build the metadata snapshot (no token — see ConnectionRecord).
  const existing = input.id ? await deps.store.get(input.id) : null;
  const isFirstConnection = existing === null && (await deps.store.list()).length === 0;
  const record: ConnectionRecord = {
    id: existing?.id ?? input.id ?? newId(),
    baseUrl,
    agentName: manifest.agent.name,
    agentVersion: manifest.agent.version,
    capabilities: [...manifest.capabilities],
    uiHome: manifest.ui?.home ?? null,
    // The first connection ever added becomes active automatically.
    isActive: existing?.isActive ?? isFirstConnection,
    createdAt: existing?.createdAt ?? now().toISOString(),
  };

  // 3. Persist token, then metadata. If the metadata write fails for a NEW
  //    connection, best-effort delete the just-stored token so no orphaned
  //    secret survives a failed add.
  await deps.vault.setToken(record.id, input.token);
  try {
    await deps.store.upsert(record);
  } catch (err) {
    if (existing === null) {
      await deps.vault.deleteToken(record.id).catch(() => {});
    }
    throw err;
  }

  return record;
};

/** Delete a connection: sqlite row AND vault token, always both. */
export const deleteConnection = async (
  id: string,
  deps: Pick<HandshakeDeps, 'store' | 'vault'>,
): Promise<void> => {
  await deps.store.remove(id);
  await deps.vault.deleteToken(id);
};
