/**
 * Version-keyed migration runner for the PassShield vault database.
 *
 * Migrations are keyed on a schema/encryption version tracked by SQLite's
 * built-in `user_version` pragma. On startup the runner compares the database's
 * recorded version against the target ({@link SCHEMA_VERSION}) and applies every
 * pending migration in order, inside a single transaction, then advances
 * `user_version`. This keeps the on-disk schema/encryption format in step with
 * the code and lets future versions evolve the schema without reworking V1.
 * (Req 1.4, 13.2, 20.1, 21.1)
 *
 * Logging: the runner emits only the non-secret event "migration applied" with
 * version metadata. It never logs schema contents, secrets, or vault data.
 * (Req 13.2)
 */

import type { Database } from 'better-sqlite3';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_VERSION } from './schema.js';

/**
 * A single migration step. `version` is the schema version this migration
 * brings the database up to; `up` applies the DDL for that step. Migrations
 * run in ascending `version` order.
 */
export interface Migration {
  /** The schema version this migration produces. */
  readonly version: number;
  /** Human-readable, non-secret description of the step. */
  readonly description: string;
  /** Applies the migration against an open database. */
  readonly up: (db: Database) => void;
}

/**
 * A minimal, non-secret logger the runner uses to report progress. Callers can
 * pass a structured logger; when omitted, migrations run silently. The runner
 * only ever passes non-secret metadata (versions, counts). (Req 13.2)
 */
export interface MigrationLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * The ordered list of migrations. Append new entries with increasing
 * `version`; never edit a shipped migration. `SCHEMA_V1` creates the initial
 * tables and indexes.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: 'initial schema',
    up: (db) => {
      db.exec(SCHEMA_V1);
    },
  },
  {
    version: 2,
    description: 'sub-pages: add vault_item.parent_id self-reference',
    up: (db) => {
      db.exec(SCHEMA_V2);
    },
  },
];

/** Read the database's current schema version from `user_version`. */
export function getSchemaVersion(db: Database): number {
  const row = db.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : Number(row);
}

/** Record the database's schema version in `user_version`. */
function setSchemaVersion(db: Database, version: number): void {
  // `user_version` does not accept bound parameters, so the integer is
  // interpolated. It is always a trusted number from {@link MIGRATIONS}.
  db.pragma(`user_version = ${version}`);
}

/**
 * Bring the database up to {@link SCHEMA_VERSION} by applying every migration
 * whose version is greater than the database's current version.
 *
 * Each pending migration is applied and its version recorded inside one
 * transaction, so a failure leaves the database at its last good version
 * rather than partially migrated. Returns the number of migrations applied.
 *
 * @param db - An open better-sqlite3 database.
 * @param logger - Optional non-secret logger for "migration applied" events.
 * @returns The count of migrations applied (0 when already up to date).
 */
export function runMigrations(db: Database, logger?: MigrationLogger): number {
  const currentVersion = getSchemaVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    return 0;
  }

  const applyAll = db.transaction((migrations: readonly Migration[]) => {
    for (const migration of migrations) {
      migration.up(db);
      setSchemaVersion(db, migration.version);
      // Non-secret operational event only. (Req 13.2)
      logger?.info('migration applied', {
        from: currentVersion,
        to: migration.version,
      });
    }
  });

  applyAll(pending);

  return pending.length;
}

/** Whether the database is already at the target {@link SCHEMA_VERSION}. */
export function isUpToDate(db: Database): boolean {
  return getSchemaVersion(db) >= SCHEMA_VERSION;
}
