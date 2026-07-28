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
  {
    // Stage 9: transcript durability. Per-connection history, resume cursor,
    // and offline compose queue. NO token columns anywhere (stage-3 invariant:
    // tokens live in the secure-store vault only, never in sqlite).
    version: 2,
    statements: [
      // `seq` is the insertion-order key; ordering is arrival order, exactly
      // like the in-memory transcript. user rows carry message_id/send_state;
      // agent rows carry event_id/event_type/files (JSON array of file ids).
      `CREATE TABLE IF NOT EXISTS transcript_items (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        message_id TEXT,
        event_id INTEGER,
        event_type TEXT,
        text TEXT NOT NULL,
        files TEXT,
        send_state TEXT,
        at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS transcript_items_by_connection
        ON transcript_items (connection_id, seq)`,
      // Upsert keys: a user item is unique per (connection, messageId) — the
      // contract dedup key; an agent item per (connection, eventId) — the
      // outbox cursor. Partial: only rows of the matching kind carry the key.
      `CREATE UNIQUE INDEX IF NOT EXISTS transcript_items_user_key
        ON transcript_items (connection_id, message_id) WHERE message_id IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS transcript_items_agent_key
        ON transcript_items (connection_id, event_id) WHERE event_id IS NOT NULL`,
      // Persisted Last-Event-ID / ?after= cursor (one cursor concept —
      // contract invariant 2), per connection.
      `CREATE TABLE IF NOT EXISTS stream_cursors (
        connection_id TEXT PRIMARY KEY NOT NULL,
        last_event_id INTEGER NOT NULL
      )`,
      // Offline-composed messages awaiting drain. message_id is the contract
      // dedup key, so re-POSTing on drain is at-least-once safe. attachments
      // (JSON array of upload ids) is reserved for the attachments stage.
      `CREATE TABLE IF NOT EXISTS compose_queue (
        message_id TEXT PRIMARY KEY NOT NULL,
        connection_id TEXT NOT NULL,
        text TEXT NOT NULL,
        attachments TEXT NOT NULL,
        queued_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS compose_queue_by_connection
        ON compose_queue (connection_id, queued_at)`,
    ],
  },
  {
    // Stage 10: per-connection owner person id. Nullable and additive — NULL
    // means "use the app default" (src/chat/person-id.ts OWNER_PERSON_ID), so
    // every existing row keeps its stage-4 behavior unchanged. personId is NOT
    // a secret (contract: vestigial-but-required, checked against the agent's
    // out-of-band configured owner id, 403 on mismatch) — a plain metadata
    // column is correct; it must never move into the token vault.
    version: 3,
    statements: [`ALTER TABLE connections ADD COLUMN person_id TEXT`],
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
