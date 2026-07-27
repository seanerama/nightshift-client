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
    const destructive = /\b(DROP\s+(TABLE|COLUMN|INDEX)|DELETE\s+FROM|TRUNCATE)\b/i;
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
});
