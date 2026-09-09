/**
 * SQLite schema definition for the PassShield local vault.
 *
 * The schema follows the design's "Data Model" section. Sensitive content is
 * never stored in plaintext columns: secret fields live inside
 * `vault_item.encrypted_payload` (AEAD ciphertext as text), while only
 * non-secret metadata (`title`, `category_id`, `is_favorite`) is stored in
 * plaintext columns so list rendering, category filtering, favorites, and
 * title search work without decrypting every row.
 * (Req 4.2, 5.2, 6.2, 7.2, 7.3, 7.4, 20.1, 21.1)
 *
 * The schema is applied and evolved by the version-keyed migration runner in
 * `./migrations.ts`; this module only declares the DDL and the target version.
 */

/**
 * The current schema/encryption version. The migration runner brings a
 * database up to this version by applying every migration whose version is
 * greater than the database's recorded `user_version`.
 *
 * This doubles as the `encryption_version` recorded on the `vault` row so the
 * on-disk encryption/format version travels with the vault. (Req 13.2)
 */
export const SCHEMA_VERSION = 2;

/**
 * DDL for schema version 1. Executed as a single script inside a transaction
 * by the migration runner. All timestamps are ISO 8601 strings.
 *
 * Notes on column intent:
 * - `vault.encryption_version` records the format/encryption version this vault
 *   was created/upgraded under, mirroring {@link SCHEMA_VERSION}.
 * - `vault.kdf_salt` / `vault.verifier` hold the KDF salt and verification
 *   material produced by the crypto package (base64 text); they contain no
 *   plaintext secret. (Req 12.1, 12.2)
 * - `vault_item.encrypted_payload` holds AEAD ciphertext (as text) of the
 *   secret fields (LoginPayload / NotePayload). (Req 4.2, 5.2)
 * - `vault_item.deleted_at` is NULL for active items and set on soft delete
 *   (trash). (Req 20.1)
 * - `vault_item.version` is a monotonic edit/sync counter bumped on each save.
 */
export const SCHEMA_V1 = /* sql */ `
CREATE TABLE IF NOT EXISTS vault (
  id                 TEXT    PRIMARY KEY,
  name               TEXT    NOT NULL,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL,
  encryption_version INTEGER NOT NULL,
  kdf_salt           TEXT    NOT NULL,
  verifier           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS category (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_item (
  id                TEXT    PRIMARY KEY,
  item_type         TEXT    NOT NULL CHECK (item_type IN ('login', 'note')),
  title             TEXT    NOT NULL,
  category_id       TEXT    REFERENCES category(id) ON DELETE SET NULL,
  is_favorite       INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
  encrypted_payload TEXT    NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  deleted_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_item_active
  ON vault_item (deleted_at);

CREATE INDEX IF NOT EXISTS idx_vault_item_category
  ON vault_item (category_id);

CREATE INDEX IF NOT EXISTS idx_vault_item_favorite
  ON vault_item (is_favorite);

CREATE INDEX IF NOT EXISTS idx_vault_item_updated
  ON vault_item (updated_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * DDL for schema version 2: sub-pages support.
 *
 * Adds a self-referencing `parent_id` to `vault_item` so an item can be a child
 * ("sub-page") of another item. Top-level items keep `parent_id = NULL`, so
 * every pre-existing row remains a top-level item after this migration — no
 * data change is required for existing vaults.
 *
 * `ON DELETE CASCADE` means permanently deleting a parent removes its entire
 * sub-tree (children, grandchildren, ...). Soft-delete (trash) is handled in
 * the query layer, which cascades `deleted_at` to descendants so trashing a
 * parent hides its sub-pages too. The relationship is arbitrary-depth; cycle
 * prevention is enforced above the storage layer (in the vault service).
 *
 * SQLite's ALTER TABLE cannot add a column with a non-constant/foreign-key
 * clause in every version, but it does accept a REFERENCES clause on ADD COLUMN
 * for a nullable column with no default, which is what we use here.
 */
export const SCHEMA_V2 = /* sql */ `
ALTER TABLE vault_item
  ADD COLUMN parent_id TEXT REFERENCES vault_item(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vault_item_parent
  ON vault_item (parent_id);
`;
