/**
 * SQLite connection management for the PassShield vault.
 *
 * Opens a better-sqlite3 database (synchronous, well-supported in the Electron
 * main process), applies durability/integrity pragmas, and brings the schema
 * up to date via the version-keyed migration runner. The database lives in the
 * per-user application data directory chosen by the caller. (Req 1.4, 15.3)
 *
 * This module performs no encryption itself: secret fields are encrypted by the
 * crypto package before they reach the database and stored as ciphertext text
 * in `vault_item.encrypted_payload`. (Req 4.2, 5.2, 11.5)
 */

import Database from 'better-sqlite3';

import { type MigrationLogger, runMigrations } from './migrations.js';

/** A better-sqlite3 database handle. */
export type VaultDatabase = Database.Database;

/** Options for opening the vault database. */
export interface OpenDatabaseOptions {
  /**
   * Filesystem path to the SQLite file. Use `:memory:` for tests. The caller is
   * responsible for choosing the per-user application data location. (Req 15.3)
   */
  readonly filename: string;
  /**
   * Optional non-secret logger forwarded to the migration runner so that
   * "migration applied" events can be recorded. (Req 13.2)
   */
  readonly logger?: MigrationLogger;
  /** Open the database read-only. Defaults to false. */
  readonly readonly?: boolean;
}

/**
 * Open the vault database, apply connection pragmas, and run pending
 * migrations to bring the schema up to the current version.
 *
 * Pragmas:
 * - `journal_mode = WAL` for better concurrency and crash resilience.
 * - `foreign_keys = ON` so `ON DELETE SET NULL` on `vault_item.category_id`
 *   takes effect when a category is removed. (Req 21.3)
 *
 * @param options - The database file location and optional logger.
 * @returns An open, migrated {@link VaultDatabase}.
 */
export function openDatabase(options: OpenDatabaseOptions): VaultDatabase {
  const db = new Database(options.filename, {
    readonly: options.readonly ?? false,
  });

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (!options.readonly) {
    runMigrations(db, options.logger);
  }

  return db;
}

/** Close an open vault database, releasing the file handle. */
export function closeDatabase(db: VaultDatabase): void {
  db.close();
}
