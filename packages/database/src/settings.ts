/**
 * Key/value queries over the `settings` table.
 *
 * The settings table stores non-secret application preferences as string
 * values keyed by name (see `./schema.ts`). This layer is deliberately
 * string-based: it neither knows nor cares about the renderer-facing
 * {@link Settings} shape or the JS types of individual settings. Serializing a
 * boolean/number to a string and coercing it back is the responsibility of the
 * store layer (the main-process SettingsStore), keeping this module a thin,
 * type-agnostic key/value accessor. (Req 3.4, 9.4, 14.3)
 *
 * Settings are non-secret and independent of vault lock state, so unlike the
 * item/category CRUD these functions carry no encryption concerns and can be
 * used against a connection opened without the derived key.
 *
 * The functions take an open {@link VaultDatabase} and are synchronous,
 * matching better-sqlite3.
 */

import type { VaultDatabase } from './connection.js';
import type { SettingsRow } from './types.js';

/**
 * Read every stored setting as a plain key/value map of strings. Keys that
 * have never been written are simply absent; callers merge these over their
 * own defaults so missing keys fall back rather than error. (Req 14.3)
 */
export function getAllSettings(db: VaultDatabase): Record<string, string> {
  const rows = db
    .prepare(/* sql */ `SELECT key, value FROM settings`)
    .all() as SettingsRow[];

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Read a single setting's string value, or `null` when the key has never been
 * written. (Req 14.3)
 */
export function getSetting(db: VaultDatabase, key: string): string | null {
  const row = db
    .prepare(/* sql */ `SELECT value FROM settings WHERE key = @key`)
    .get({ key }) as Pick<SettingsRow, 'value'> | undefined;
  return row?.value ?? null;
}

/**
 * Upsert a single setting. Inserts the key when absent and overwrites the value
 * when present, so persistence is idempotent. (Req 3.4, 9.4, 14.3)
 */
export function setSetting(db: VaultDatabase, key: string, value: string): void {
  db.prepare(
    /* sql */ `
    INSERT INTO settings (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run({ key, value });
}

/**
 * Upsert several settings in a single transaction so a multi-key patch applies
 * atomically: either every entry lands or none does. Entries may be given as a
 * key/value record or as an iterable of `[key, value]` pairs. (Req 3.4, 9.4)
 */
export function setSettings(
  db: VaultDatabase,
  entries: Record<string, string> | Iterable<readonly [string, string]>,
): void {
  // A plain object is normalized via Object.entries; anything exposing an
  // iterator (arrays, Maps, generators) is materialized directly.
  const isIterable =
    typeof (entries as Iterable<readonly [string, string]>)[Symbol.iterator] ===
    'function';
  const pairs: Array<readonly [string, string]> = isIterable
    ? Array.from(entries as Iterable<readonly [string, string]>)
    : Object.entries(entries as Record<string, string>);

  const upsert = db.prepare(
    /* sql */ `
    INSERT INTO settings (key, value)
    VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  );

  const run = db.transaction((items: Array<readonly [string, string]>) => {
    for (const [key, value] of items) {
      upsert.run({ key, value });
    }
  });

  run(pairs);
}
