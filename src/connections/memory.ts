/**
 * In-memory implementations of the storage seams. Used by unit and integration
 * tests (expo native modules do not run under jest's node environment) and
 * safe to use anywhere a throwaway store is needed. Same observable behavior
 * as the sqlite/secure-store implementations.
 */

import type { ConnectionRecord, ConnectionStore, TokenVault } from './types';

export class MemoryConnectionStore implements ConnectionStore {
  private records = new Map<string, ConnectionRecord>();

  async list(): Promise<ConnectionRecord[]> {
    return [...this.records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<ConnectionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async upsert(record: ConnectionRecord): Promise<void> {
    this.records.set(record.id, { ...record, capabilities: [...record.capabilities] });
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }

  async setActive(id: string): Promise<void> {
    for (const [key, record] of this.records) {
      this.records.set(key, { ...record, isActive: key === id });
    }
  }
}

export class MemoryTokenVault implements TokenVault {
  private tokens = new Map<string, string>();

  async getToken(connectionId: string): Promise<string | null> {
    return this.tokens.get(connectionId) ?? null;
  }

  async setToken(connectionId: string, token: string): Promise<void> {
    this.tokens.set(connectionId, token);
  }

  async deleteToken(connectionId: string): Promise<void> {
    this.tokens.delete(connectionId);
  }

  /** Test helper: number of stored tokens (never exposes the tokens). */
  get size(): number {
    return this.tokens.size;
  }
}
