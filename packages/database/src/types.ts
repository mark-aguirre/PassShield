/**
 * Row shapes for the passShield vault schema.
 *
 * These interfaces mirror the physical columns declared in `./schema.ts` (snake
 * _case) as returned by better-sqlite3. They document the storage layer and are
 * consumed by the CRUD queries (Task 4.2). Booleans are stored as integers
 * (0/1) and timestamps as ISO 8601 text; mapping to the renderer-facing
 * contracts types happens in the query layer, not here.
 *
 * No row type exposes plaintext secrets: secret fields are confined to
 * `VaultItemRow.encrypted_payload` as AEAD ciphertext text. (Req 4.2, 5.2)
 */

/** A row of the `vault` table. */
export interface VaultRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** Format/encryption version this vault was created/upgraded under. */
  encryption_version: number;
  /** Base64 KDF salt; contains no plaintext secret. (Req 12.1) */
  kdf_salt: string;
  /** Base64 verification material; contains no plaintext secret. (Req 12.2) */
  verifier: string;
}

/** A row of the `vault_item` table. */
export interface VaultItemRow {
  id: string;
  item_type: 'login' | 'note';
  /** Non-secret display title. */
  title: string;
  /** Assigned category id, or null when uncategorized. */
  category_id: string | null;
  /** Stored as 0 or 1. */
  is_favorite: number;
  /** AEAD ciphertext (text) of the secret fields. (Req 4.2, 5.2) */
  encrypted_payload: string;
  /** Monotonic edit/sync version. */
  version: number;
  created_at: string;
  updated_at: string;
  /** ISO 8601 soft-delete timestamp, or null when active. (Req 20.1) */
  deleted_at: string | null;
  /**
   * Parent item id when this item is a sub-page, or null when it is a
   * top-level item. Self-references `vault_item(id)` with ON DELETE CASCADE.
   */
  parent_id: string | null;
}

/** A row of the `category` table. */
export interface CategoryRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of the `settings` table (a key/value pair). */
export interface SettingsRow {
  key: string;
  value: string;
}
