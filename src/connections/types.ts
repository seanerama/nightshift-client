/**
 * Connection storage seams (stage 3).
 *
 * Two hard rules from the stage spec and ADR 0002:
 * - Tokens live in the TokenVault (expo-secure-store) ONLY. A ConnectionRecord
 *   deliberately has no token field, so metadata storage (sqlite), logs, and
 *   serialized state can never leak one.
 * - Both stores hide behind small interfaces so pure logic (handshake, health,
 *   gating) unit-tests against in-memory fakes in jest's node environment.
 */

/** Connection metadata persisted in sqlite. NEVER contains the token. */
export interface ConnectionRecord {
  id: string;
  /** e.g. "http://100.64.0.7:8787" — no trailing slash required. */
  baseUrl: string;
  /** Agent name from the manifest handshake snapshot. */
  agentName: string;
  /** Agent version from the manifest handshake snapshot. */
  agentVersion: string;
  /** Capability list from the manifest handshake snapshot. */
  capabilities: readonly string[];
  /** Optional manifest `ui.home` resource; null when the agent serves none. */
  uiHome: string | null;
  /** Exactly one connection is active at a time (or none). */
  isActive: boolean;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Owner person id for InboundMessages to THIS agent; null = use the app
   * default (OWNER_PERSON_ID). NOT a secret (contract: vestigial-but-required,
   * 403 on mismatch, configured out of band) — plain column, never vaulted. */
  personId: string | null;
}

/** Metadata store (sqlite in production, in-memory fake in unit tests). */
export interface ConnectionStore {
  list(): Promise<ConnectionRecord[]>;
  get(id: string): Promise<ConnectionRecord | null>;
  /** Insert or replace by id. */
  upsert(record: ConnectionRecord): Promise<void>;
  remove(id: string): Promise<void>;
  /** Mark `id` active and every other connection inactive. */
  setActive(id: string): Promise<void>;
}

/** Token storage (expo-secure-store in production). Keyed by connection id. */
export interface TokenVault {
  getToken(connectionId: string): Promise<string | null>;
  setToken(connectionId: string, token: string): Promise<void>;
  deleteToken(connectionId: string): Promise<void>;
}

/** Non-cryptographic unique id for a connection row (tokens are the secrets,
 * ids are just row keys — avoids a crypto polyfill dependency on Hermes). */
export const newConnectionId = (): string =>
  `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
