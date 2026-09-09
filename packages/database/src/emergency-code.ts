/**
 * Database queries for the vault emergency recovery code hash.
 *
 * The `vault.emergency_code_hash` column (added by migration v3) stores only
 * the HKDF-SHA-256 hash of the recovery code — never the raw code itself. Two
 * operations are needed:
 *
 *   - {@link getEmergencyCodeHash}  — read the stored hash (or null when none
 *     has been set) so the vault service can verify a candidate code.
 *   - {@link setEmergencyCodeHash}  — persist a newly generated hash when the
 *     user generates (or regenerates) an emergency kit.
 *
 * Both functions take an open {@link VaultDatabase} and are synchronous,
 * matching better-sqlite3. They operate on the single `vault` row identified
 * by `VAULT_ROW_ID` and read/write no secret values — the hash itself is not
 * a secret (it is a one-way transform of a 128-bit random code), and no
 * plaintext key material is involved. (Forgot-password recovery)
 */

import type { VaultDatabase } from './connection.js';

/** The single vault row id used by this local, single-vault application. */
const VAULT_ROW_ID = 'vault';

/**
 * Read the stored emergency code hash from the single `vault` row.
 *
 * Returns the base64-encoded HKDF hash when a kit has been generated, or
 * `null` when the column is NULL (no kit exists yet or it was cleared).
 *
 * @param db An open vault database connection.
 * @returns The stored hash string, or `null`.
 */
export function getEmergencyCodeHash(db: VaultDatabase): string | null {
  const row = db
    .prepare(
      /* sql */ `
      SELECT emergency_code_hash
        FROM vault
       WHERE id = @id
    `,
    )
    .get({ id: VAULT_ROW_ID }) as { emergency_code_hash: string | null } | undefined;

  return row?.emergency_code_hash ?? null;
}

/**
 * Read the stored wrapped vault key from the single `vault` row.
 *
 * Returns the serialized {@link WrappedVaultKey} JSON string when a kit with
 * escrow has been generated (schema v4+), or `null` when the column is NULL
 * (no kit, or a pre-v4 kit that lacks escrow and cannot recover while locked).
 *
 * @param db An open vault database connection.
 * @returns The stored wrapped-key JSON string, or `null`.
 */
export function getEmergencyWrappedKey(db: VaultDatabase): string | null {
  const row = db
    .prepare(
      /* sql */ `
      SELECT emergency_wrapped_key
        FROM vault
       WHERE id = @id
    `,
    )
    .get({ id: VAULT_ROW_ID }) as { emergency_wrapped_key: string | null } | undefined;

  return row?.emergency_wrapped_key ?? null;
}

/**
 * Persist (or clear) the emergency code hash on the single `vault` row.
 *
 * Pass a base64 hash string to record a newly generated kit, or `null` to
 * clear an existing one (e.g. when the vault is reset and the old kit should
 * no longer be accepted).
 *
 * @param db An open vault database connection.
 * @param hash The base64 HKDF hash to store, or `null` to clear.
 */
export function setEmergencyCodeHash(db: VaultDatabase, hash: string | null): void {
  db.prepare(
    /* sql */ `
    UPDATE vault
       SET emergency_code_hash = @hash,
           updated_at = @updated_at
     WHERE id = @id
  `,
  ).run({
    id: VAULT_ROW_ID,
    hash,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Persist (or clear) the wrapped vault key on the single `vault` row.
 *
 * Pass a serialized {@link WrappedVaultKey} JSON string to record the escrow
 * for a newly generated kit, or `null` to clear it (e.g. after a successful
 * recovery, since each kit is single-use). Written together with the code hash
 * at kit generation and cleared together at recovery.
 *
 * @param db An open vault database connection.
 * @param wrappedKey The serialized wrapped-key JSON, or `null` to clear.
 */
export function setEmergencyWrappedKey(db: VaultDatabase, wrappedKey: string | null): void {
  db.prepare(
    /* sql */ `
    UPDATE vault
       SET emergency_wrapped_key = @wrapped_key,
           updated_at = @updated_at
     WHERE id = @id
  `,
  ).run({
    id: VAULT_ROW_ID,
    wrapped_key: wrappedKey,
    updated_at: new Date().toISOString(),
  });
}
