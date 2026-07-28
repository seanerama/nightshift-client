/**
 * Unit: additive migrations runner — v1 applies once, idempotent on re-run,
 * refuses downgrade, and the shipped migration list stays non-destructive.
 */

import {
  CONNECTIONS_MIGRATIONS,
  type MigrationDb,
  MigrationError,
  runMigrations,
} from './migrations';

class FakeMigrationDb implements MigrationDb {
  version = 0;
  executed: string[] = [];

  async getSchemaVersion(): Promise<number> {
    return this.version;
  }

  async setSchemaVersion(version: number): Promise<void> {
    this.version = version;
  }

  async execute(sql: string): Promise<void> {
    this.executed.push(sql);
  }
}

describe('runMigrations', () => {
  it('applies v1 on a fresh database and records the version', async () => {
    const db = new FakeMigrationDb();

    const version = await runMigrations(db);

    expect(version).toBe(CONNECTIONS_MIGRATIONS.length);
    expect(db.version).toBe(CONNECTIONS_MIGRATIONS.length);
    expect(db.executed.some((sql) => /CREATE TABLE IF NOT EXISTS connections/i.test(sql))).toBe(
      true,
    );
  });

  it('is idempotent: a second run executes no statements', async () => {
    const db = new FakeMigrationDb();
    await runMigrations(db);
    const applied = db.executed.length;

    await runMigrations(db);

    expect(db.executed).toHaveLength(applied);
  });

  it('applies only the missing steps when partially migrated', async () => {
    const migrations = [
      { version: 1, statements: ['CREATE TABLE a (id TEXT)'] },
      { version: 2, statements: ['ALTER TABLE a ADD COLUMN extra TEXT'] },
    ] as const;
    const db = new FakeMigrationDb();
    db.version = 1;

    await runMigrations(db, migrations);

    expect(db.executed).toEqual(['ALTER TABLE a ADD COLUMN extra TEXT']);
    expect(db.version).toBe(2);
  });

  it('refuses to run against a database from a newer app version (no downgrade)', async () => {
    const db = new FakeMigrationDb();
    db.version = CONNECTIONS_MIGRATIONS.length + 1;

    await expect(runMigrations(db)).rejects.toBeInstanceOf(MigrationError);
    expect(db.executed).toHaveLength(0);
    expect(db.version).toBe(CONNECTIONS_MIGRATIONS.length + 1); // untouched
  });

  it('rejects a malformed (non-contiguous) migration list', async () => {
    const db = new FakeMigrationDb();
    await expect(
      runMigrations(db, [{ version: 2, statements: ['CREATE TABLE b (id TEXT)'] }]),
    ).rejects.toBeInstanceOf(MigrationError);
    expect(db.executed).toHaveLength(0);
  });
});

describe('shipped migration list', () => {
  it('contains no destructive statements (additive-only, stage acceptance)', () => {
    // The regex guard runs over EVERY shipped migration — v1, the stage-9 v2
    // append, the stage-10 v3 append, and every future entry are covered by
    // the same loop. Stage 10 extended the guard with RENAME (a rename is a
    // drop under another name for readers of the old schema) and UPDATE/
    // REPLACE (migrations may add shape, never rewrite existing rows).
    const destructive =
      /\b(DROP\s+(TABLE|COLUMN|INDEX)|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE\s+\S+\s+DROP|ALTER\s+TABLE\s+\S+\s+RENAME|RENAME\s+(TO|COLUMN)|UPDATE\s+\S+\s+SET|REPLACE\s+INTO)\b/i;
    for (const migration of CONNECTIONS_MIGRATIONS) {
      for (const statement of migration.statements) {
        expect(statement).not.toMatch(destructive);
      }
    }
  });

  it('v1 creates the connections table without any token column', () => {
    const v1 = CONNECTIONS_MIGRATIONS[0];
    expect(v1.version).toBe(1);
    const ddl = v1.statements.join('\n');
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS connections/i);
    expect(ddl.toLowerCase()).not.toContain('token');
  });

  it('v1 is byte-identical to the stage-3 shape (append-only: v2 must not edit it)', () => {
    // Guards the "never touch migration v1" rule: any drive-by "cleanup" of
    // the existing entry fails here even if it looks semantically equivalent.
    expect(CONNECTIONS_MIGRATIONS[0].statements).toEqual([
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
    ]);
  });

  it('v2 creates the durability tables (stage 9) without any token column', () => {
    const v2 = CONNECTIONS_MIGRATIONS[1];
    expect(v2.version).toBe(2);
    const ddl = v2.statements.join('\n');
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS transcript_items/i);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS stream_cursors/i);
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS compose_queue/i);
    // Stage-3 invariant carried forward: no token material in any new table.
    expect(ddl.toLowerCase()).not.toContain('token');
  });

  it('v2 applies over an existing v1 database and is idempotent', async () => {
    const db = new FakeMigrationDb();
    db.version = 1; // a stage-3-era install

    await runMigrations(db);
    expect(db.version).toBe(CONNECTIONS_MIGRATIONS.length);
    // v1 was not re-executed (its CREATE TABLE connections did not run again;
    // the only statement touching `connections` is the v3 additive ALTER).
    expect(db.executed.some((sql) => /CREATE TABLE IF NOT EXISTS connections/i.test(sql))).toBe(
      false,
    );
    expect(db.executed.some((sql) => /transcript_items/i.test(sql))).toBe(true);

    const applied = db.executed.length;
    await runMigrations(db);
    expect(db.executed).toHaveLength(applied);
  });

  it('v2 is byte-identical to the stage-9 shape (append-only: v3 must not edit it)', () => {
    // Same lock as v1: with v3 appended, the existing entries are frozen —
    // any drive-by "cleanup" fails here even if semantically equivalent.
    expect(CONNECTIONS_MIGRATIONS[1].statements).toEqual([
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
      `CREATE UNIQUE INDEX IF NOT EXISTS transcript_items_user_key
        ON transcript_items (connection_id, message_id) WHERE message_id IS NOT NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS transcript_items_agent_key
        ON transcript_items (connection_id, event_id) WHERE event_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS stream_cursors (
        connection_id TEXT PRIMARY KEY NOT NULL,
        last_event_id INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS compose_queue (
        message_id TEXT PRIMARY KEY NOT NULL,
        connection_id TEXT NOT NULL,
        text TEXT NOT NULL,
        attachments TEXT NOT NULL,
        queued_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS compose_queue_by_connection
        ON compose_queue (connection_id, queued_at)`,
    ]);
  });

  it('v3 adds the NULLABLE person_id column to connections — and nothing else', () => {
    const v3 = CONNECTIONS_MIGRATIONS[2];
    expect(v3.version).toBe(3);
    expect(v3.statements).toEqual([`ALTER TABLE connections ADD COLUMN person_id TEXT`]);
    // Nullable is the semantics ("null = use the app default"): a NOT NULL
    // add would also fail outright on existing v1/v2 rows.
    expect(v3.statements[0]).not.toMatch(/NOT\s+NULL/i);
    // personId is not a secret, but no token material may EVER gain a column.
    expect(v3.statements.join('\n').toLowerCase()).not.toContain('token');
  });

  it('v3 applies over an existing v2 database and is idempotent', async () => {
    const db = new FakeMigrationDb();
    db.version = 2; // a stage-9-era install

    await runMigrations(db);
    // Asserted against the list length rather than a literal, so appending a
    // future migration does not break this test the way v4 did.
    expect(db.version).toBe(CONNECTIONS_MIGRATIONS.length);
    // The v3 statement ran...
    expect(db.executed).toContain(`ALTER TABLE connections ADD COLUMN person_id TEXT`);
    // ...and nothing from v1/v2 re-ran.
    expect(db.executed.some((sql) => /CREATE TABLE IF NOT EXISTS connections/i.test(sql))).toBe(
      false,
    );
    expect(
      db.executed.some((sql) => /CREATE TABLE IF NOT EXISTS transcript_items/i.test(sql)),
    ).toBe(false);

    const afterFirstRun = db.executed.length;
    await runMigrations(db);
    expect(db.executed).toHaveLength(afterFirstRun);
  });
});

describe('migration v4 — app_settings (stage 12)', () => {
  it('is appended, not edited: v1-v3 keep their original version numbers', () => {
    const versions = CONNECTIONS_MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([1, 2, 3, 4]);
  });

  it('creates the app_settings key/value table', () => {
    const v4 = CONNECTIONS_MIGRATIONS.find((m) => m.version === 4);
    const ddl = (v4?.statements ?? []).join('\n');
    expect(ddl).toMatch(/CREATE TABLE IF NOT EXISTS app_settings/i);
    expect(ddl).toMatch(/key TEXT PRIMARY KEY NOT NULL/i);
    expect(ddl).toMatch(/value TEXT NOT NULL/i);
  });

  it('applies over a v3 database without re-running v1-v3', async () => {
    const db = new FakeMigrationDb();
    db.version = 3;
    await runMigrations(db, CONNECTIONS_MIGRATIONS);
    expect(await db.getSchemaVersion()).toBe(4);
    expect(db.executed.some((sql) => /CREATE TABLE IF NOT EXISTS app_settings/i.test(sql))).toBe(
      true,
    );
    // v1-v3 statements must not have re-run.
    expect(db.executed.some((sql) => /CREATE TABLE IF NOT EXISTS connections/i.test(sql))).toBe(
      false,
    );
    expect(db.executed.some((sql) => /ADD COLUMN person_id/i.test(sql))).toBe(false);
  });

  it('is idempotent on re-run', async () => {
    const db = new FakeMigrationDb();
    db.version = 4;
    await runMigrations(db, CONNECTIONS_MIGRATIONS);
    expect(db.executed).toHaveLength(0);
    expect(await db.getSchemaVersion()).toBe(4);
  });
});
