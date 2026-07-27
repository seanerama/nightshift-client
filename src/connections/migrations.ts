/**
 * Additive-only migrations runner for the connections database.
 *
 * Versioned, append-only steps: every schema change is a NEW entry appended to
 * CONNECTIONS_MIGRATIONS with the next version number. Existing entries are
 * never edited and no step may contain a destructive statement (enforced by
 * unit test). The runner refuses to open a database whose recorded version is
 * NEWER than it knows (downgrade = fail closed, never "fix" the schema).
 *
 * The runner talks to a three-method seam so unit tests drive it with an
 * in-memory fake; production adapts expo-sqlite via `PRAGMA user_version`.
 */

export interface MigrationDb {
  /** Current schema version (0 = fresh database). */
  getSchemaVersion(): Promise<number>;
  setSchemaVersion(version: number): Promise<void>;
  execute(sql: string): Promise<void>;
}

export interface Migration {
  /** 1-based, contiguous, ascending. */
  version: number;
  statements: readonly string[];
}

/** Append-only. Never edit an existing entry; add version N+1 instead. */
export const CONNECTIONS_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY NOT NULL,
        base_url TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        agent_version TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        ui_home TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
    ],
  },
];

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const assertWellFormed = (migrations: readonly Migration[]): void => {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError(
        `migrations must be contiguous and ascending from 1; found version ${migration.version} at index ${index}`,
      );
    }
  });
};

/**
 * Apply every migration newer than the database's recorded version, in order,
 * bumping the recorded version after each step. Idempotent: a database already
 * at the latest version executes nothing. Throws MigrationError if the
 * database is from the future (version > latest known).
 */
export const runMigrations = async (
  db: MigrationDb,
  migrations: readonly Migration[] = CONNECTIONS_MIGRATIONS,
): Promise<number> => {
  assertWellFormed(migrations);
  const latest = migrations.length;
  const current = await db.getSchemaVersion();

  if (current > latest) {
    throw new MigrationError(
      `database schema version ${current} is newer than this app understands (${latest}); refusing to run`,
    );
  }

  for (const migration of migrations.slice(current)) {
    for (const statement of migration.statements) {
      await db.execute(statement);
    }
    await db.setSchemaVersion(migration.version);
  }

  return latest;
};
