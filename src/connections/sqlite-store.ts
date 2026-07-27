/**
 * expo-sqlite implementation of ConnectionStore. Metadata ONLY — the schema
 * has no token column by design; tokens live in the secure-store vault.
 *
 * Native module: this file must never be imported by unit tests (they use the
 * in-memory fake). Schema changes go through the additive migrations runner.
 */

import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { type MigrationDb, runMigrations } from './migrations';
import type { ConnectionRecord, ConnectionStore } from './types';

const DATABASE_NAME = 'connections.db';

interface ConnectionRow {
  id: string;
  base_url: string;
  agent_name: string;
  agent_version: string;
  capabilities: string;
  ui_home: string | null;
  is_active: number;
  created_at: string;
}

const rowToRecord = (row: ConnectionRow): ConnectionRecord => ({
  id: row.id,
  baseUrl: row.base_url,
  agentName: row.agent_name,
  agentVersion: row.agent_version,
  capabilities: JSON.parse(row.capabilities) as string[],
  uiHome: row.ui_home,
  isActive: row.is_active === 1,
  createdAt: row.created_at,
});

const migrationDbFor = (db: SQLiteDatabase): MigrationDb => ({
  getSchemaVersion: async () => {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    return row?.user_version ?? 0;
  },
  // PRAGMA cannot bind parameters; version is an app-controlled integer.
  setSchemaVersion: async (version) => {
    await db.execAsync(`PRAGMA user_version = ${Math.trunc(version)}`);
  },
  execute: async (sql) => {
    await db.execAsync(sql);
  },
});

class SqliteConnectionStore implements ConnectionStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async list(): Promise<ConnectionRecord[]> {
    const rows = await this.db.getAllAsync<ConnectionRow>(
      'SELECT * FROM connections ORDER BY created_at, id',
    );
    return rows.map(rowToRecord);
  }

  async get(id: string): Promise<ConnectionRecord | null> {
    const row = await this.db.getFirstAsync<ConnectionRow>(
      'SELECT * FROM connections WHERE id = ?',
      id,
    );
    return row ? rowToRecord(row) : null;
  }

  async upsert(record: ConnectionRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO connections
        (id, base_url, agent_name, agent_version, capabilities, ui_home, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.baseUrl,
      record.agentName,
      record.agentVersion,
      JSON.stringify(record.capabilities),
      record.uiHome,
      record.isActive ? 1 : 0,
      record.createdAt,
    );
  }

  async remove(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM connections WHERE id = ?', id);
  }

  async setActive(id: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE connections SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END',
      id,
    );
  }
}

let storePromise: Promise<ConnectionStore> | null = null;

/** Open (once) the connections database, run migrations, return the store. */
export const getSqliteConnectionStore = (): Promise<ConnectionStore> => {
  if (storePromise === null) {
    storePromise = (async () => {
      const db = await openDatabaseAsync(DATABASE_NAME);
      await runMigrations(migrationDbFor(db));
      return new SqliteConnectionStore(db);
    })();
    // Allow retry after a failed open/migration instead of caching rejection.
    storePromise.catch(() => {
      storePromise = null;
    });
  }
  return storePromise;
};
