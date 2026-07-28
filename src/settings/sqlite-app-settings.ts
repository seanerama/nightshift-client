/**
 * expo-sqlite implementation of AppSettingsStore, backed by the `app_settings`
 * table created in migration v4.
 *
 * Native module: this file must never be imported by unit tests (they use
 * MemoryAppSettingsStore).
 *
 * It reuses `getConnectionsDatabase()` rather than opening its own handle —
 * that helper already guarantees "one file, one handle, one migrations run",
 * which is what keeps a single schema version to reason about.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { getConnectionsDatabase } from '../connections/sqlite-store';
import type { AppSettingsStore } from './types';

class SqliteAppSettingsStore implements AppSettingsStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      key,
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
      key,
      value,
    );
  }
}

export const getSqliteAppSettingsStore = (): Promise<AppSettingsStore> =>
  getConnectionsDatabase().then((db) => new SqliteAppSettingsStore(db));
