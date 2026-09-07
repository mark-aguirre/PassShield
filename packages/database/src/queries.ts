/**
 * CRUD queries over the passShield vault, working at the storage-row level.
 *
 * This layer is deliberately encryption-agnostic: it accepts and returns the
 * secret payload only as opaque ciphertext text in `vault_item.encrypted_payload`.
 * Encryption and decryption happen in the crypto/vault layer, never here.
 * Only non-secret metadata (`title`, `category_id`, `is_favorite`) is stored in
 * plaintext columns so list rendering, category filtering, favorites, and title
 * search work without touching ciphertext. (Req 4.2, 5.2, 6.2, 7.3, 7.4, 20.1, 21.1)
 *
 * Timestamps are ISO 8601 strings; booleans are stored as SQLite integers (0/1).
 * The query layer bumps `version` and stamps `updated_at` on every item save,
 * records `created_at`/`updated_at` on creation (Req 4.3, 4.6), performs
 * soft-delete/restore/permanent-delete over `deleted_at` (Req 20.1, 20.2, 20.3),
 * orders "recent" by `updated_at` descending (Req 17.1), reports per-category
 * item counts (Req 21.2), and relies on the schema's `ON DELETE SET NULL` plus
 * `PRAGMA foreign_keys = ON` for safe reassignment on category delete (Req 21.3).
 *
 * The functions here take an open {@link VaultDatabase} and are synchronous,
 * matching better-sqlite3. Callers are responsible for gating writes behind an
 * unlocked vault (Req 4.5, 20.4); this layer performs storage only.
 */

import type { VaultDatabase } from './connection.js';
import type { CategoryRow, VaultItemRow } from './types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Current time as an ISO 8601 string, used for created/updated stamps. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Convert a JS boolean to the SQLite integer representation (0/1). */
function toSqliteBool(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * Minimal id generator used when a caller does not supply an id. Prefers the
 * platform `crypto.randomUUID` when available (Node >= 20, Electron main), with
 * a defensive fallback so the module never throws at import time.
 */
function generateId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  // Fallback: timestamp + random suffix. Not a UUID, but unique enough for a
  // local single-user vault and only reached on platforms lacking WebCrypto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ---------------------------------------------------------------------------
// Item CRUD
// ---------------------------------------------------------------------------

/**
 * Input for creating a vault item. The secret fields are already encrypted by
 * the crypto layer and passed here as `encryptedPayload` ciphertext text.
 * (Req 4.2, 5.2)
 */
export interface CreateItemInput {
  /** Optional id; a UUID is generated when omitted. */
  id?: string;
  itemType: 'login' | 'note';
  /** Non-secret display title. */
  title: string;
  /** Assigned category id, or null when uncategorized. */
  categoryId: string | null;
  isFavorite: boolean;
  /** AEAD ciphertext of the secret fields, produced by the crypto layer. */
  encryptedPayload: string;
}

/**
 * Input for updating an existing vault item. All non-id fields are replaced;
 * `version` is bumped and `updated_at` re-stamped by {@link updateItem}.
 * (Req 4.3)
 */
export interface UpdateItemInput {
  id: string;
  title: string;
  categoryId: string | null;
  isFavorite: boolean;
  /** Fresh AEAD ciphertext of the (possibly edited) secret fields. */
  encryptedPayload: string;
}

/** Scope selector for {@link listItems}, mirroring the IPC contract. */
export type ItemScope =
  | 'all'
  | 'favorites'
  | 'recent'
  | 'logins'
  | 'notes'
  | 'category';

/** How to order item lists and search results. */
export type ItemSort = 'titleAsc' | 'titleDesc' | 'recent';

/** Options for {@link listItems}. */
export interface ListItemsOptions {
  scope?: ItemScope;
  /** Required when `scope` is 'category'; ignored otherwise. */
  categoryId?: string | null;
  sort?: ItemSort;
  /** Include trashed items. Defaults to false (active items only). */
  includeTrashed?: boolean;
}

/**
 * Create a new item, storing the encrypted payload alongside plaintext
 * metadata. Records `created_at`/`updated_at` (Req 4.6) and starts `version`
 * at 1. Returns the persisted row.
 */
export function createItem(
  db: VaultDatabase,
  input: CreateItemInput,
): VaultItemRow {
  const id = input.id ?? generateId();
  const ts = nowIso();

  db.prepare(
    /* sql */ `
    INSERT INTO vault_item (
      id, item_type, title, category_id, is_favorite,
      encrypted_payload, version, created_at, updated_at, deleted_at
    ) VALUES (
      @id, @item_type, @title, @category_id, @is_favorite,
      @encrypted_payload, 1, @created_at, @updated_at, NULL
    )
  `,
  ).run({
    id,
    item_type: input.itemType,
    title: input.title,
    category_id: input.categoryId,
    is_favorite: toSqliteBool(input.isFavorite),
    encrypted_payload: input.encryptedPayload,
    created_at: ts,
    updated_at: ts,
  });

  return getItemById(db, id, { includeTrashed: true })!;
}

/**
 * Update an existing item's metadata and encrypted payload, bump its
 * `version`, and re-stamp `updated_at`. (Req 4.3, 5.3) Returns the updated row,
 * or `null` when no item with that id exists.
 */
export function updateItem(
  db: VaultDatabase,
  input: UpdateItemInput,
): VaultItemRow | null {
  const ts = nowIso();

  const result = db
    .prepare(
      /* sql */ `
    UPDATE vault_item
       SET title = @title,
           category_id = @category_id,
           is_favorite = @is_favorite,
           encrypted_payload = @encrypted_payload,
           version = version + 1,
           updated_at = @updated_at
     WHERE id = @id
  `,
    )
    .run({
      id: input.id,
      title: input.title,
      category_id: input.categoryId,
      is_favorite: toSqliteBool(input.isFavorite),
      encrypted_payload: input.encryptedPayload,
      updated_at: ts,
    });

  if (result.changes === 0) {
    return null;
  }

  return getItemById(db, input.id, { includeTrashed: true });
}

/**
 * Fetch a single item row by id. By default trashed items are excluded so
 * active-view reads never surface soft-deleted rows; pass `includeTrashed` to
 * read trashed rows (e.g. the restore/permanent-delete flows). Returns `null`
 * when not found.
 */
export function getItemById(
  db: VaultDatabase,
  id: string,
  options: { includeTrashed?: boolean } = {},
): VaultItemRow | null {
  const includeTrashed = options.includeTrashed ?? false;
  const sql = includeTrashed
    ? /* sql */ `SELECT * FROM vault_item WHERE id = @id`
    : /* sql */ `SELECT * FROM vault_item WHERE id = @id AND deleted_at IS NULL`;

  const row = db.prepare(sql).get({ id }) as VaultItemRow | undefined;
  return row ?? null;
}

/** Build the ORDER BY clause for a sort option. */
function orderByClause(sort: ItemSort): string {
  switch (sort) {
    case 'titleAsc':
      return 'ORDER BY title COLLATE NOCASE ASC';
    case 'titleDesc':
      return 'ORDER BY title COLLATE NOCASE DESC';
    case 'recent':
      // Most recent activity first. (Req 17.1)
      return 'ORDER BY updated_at DESC';
  }
}

/**
 * List item rows for a scope, returning metadata + ciphertext only (no
 * decryption). Scopes map to plaintext-column filters so lists render without
 * touching ciphertext (Req 6.2, 7.3, 7.4):
 * - `all`: every active item
 * - `favorites`: `is_favorite = 1` (Req 7.4)
 * - `recent`: active items ordered by `updated_at DESC` (Req 17.1)
 * - `logins` / `notes`: filtered by `item_type`
 * - `category`: filtered by `category_id` (Req 7.3)
 *
 * Trashed items are excluded from active views unless `includeTrashed` is set
 * (Req 20.1). The `recent` scope forces recency ordering regardless of `sort`.
 */
export function listItems(
  db: VaultDatabase,
  options: ListItemsOptions = {},
): VaultItemRow[] {
  const scope = options.scope ?? 'all';
  const includeTrashed = options.includeTrashed ?? false;
  const sort: ItemSort =
    scope === 'recent' ? 'recent' : (options.sort ?? 'titleAsc');

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (!includeTrashed) {
    conditions.push('deleted_at IS NULL');
  }

  switch (scope) {
    case 'favorites':
      conditions.push('is_favorite = 1');
      break;
    case 'logins':
      conditions.push("item_type = 'login'");
      break;
    case 'notes':
      conditions.push("item_type = 'note'");
      break;
    case 'category':
      if (options.categoryId == null) {
        // No category specified: match uncategorized items.
        conditions.push('category_id IS NULL');
      } else {
        conditions.push('category_id = @category_id');
        params.category_id = options.categoryId;
      }
      break;
    case 'all':
    case 'recent':
      break;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM vault_item ${where} ${orderByClause(sort)}`;

  return db.prepare(sql).all(params) as VaultItemRow[];
}

/**
 * List trashed items (soft-deleted), most recently trashed first. Supports the
 * trash view where users restore or permanently delete items. (Req 20.2, 20.3)
 */
export function listTrashedItems(db: VaultDatabase): VaultItemRow[] {
  return db
    .prepare(
      /* sql */ `
    SELECT * FROM vault_item
     WHERE deleted_at IS NOT NULL
     ORDER BY deleted_at DESC
  `,
    )
    .all() as VaultItemRow[];
}

/**
 * Search active items over the plaintext `title` column. The query is matched
 * case-insensitively as a substring; an empty/whitespace query returns the
 * full active list so clearing the search restores it. (Req 6.1, 6.2, 6.3)
 * No secret values are read or returned. (Req 6.4)
 */
export function searchItems(
  db: VaultDatabase,
  query: string,
  sort: ItemSort = 'titleAsc',
): VaultItemRow[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return listItems(db, { scope: 'all', sort });
  }

  // Escape LIKE wildcards so user input is treated literally.
  const escaped = trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;

  const sql = `
    SELECT * FROM vault_item
     WHERE deleted_at IS NULL
       AND title LIKE @pattern ESCAPE '\\' COLLATE NOCASE
     ${orderByClause(sort)}
  `;

  return db.prepare(sql).all({ pattern }) as VaultItemRow[];
}

/**
 * Soft-delete an item by setting `deleted_at`, removing it from active views
 * while keeping it recoverable from trash. (Req 20.1) No-op returns `false`
 * when the item does not exist or is already trashed.
 */
export function trashItem(db: VaultDatabase, id: string): boolean {
  const result = db
    .prepare(
      /* sql */ `
    UPDATE vault_item
       SET deleted_at = @deleted_at
     WHERE id = @id AND deleted_at IS NULL
  `,
    )
    .run({ id, deleted_at: nowIso() });

  return result.changes > 0;
}

/**
 * Restore a trashed item by clearing `deleted_at`, returning it to active
 * views in its previous state. (Req 20.2) Returns `false` when the item does
 * not exist or is not currently trashed.
 */
export function restoreItem(db: VaultDatabase, id: string): boolean {
  const result = db
    .prepare(
      /* sql */ `
    UPDATE vault_item
       SET deleted_at = NULL
     WHERE id = @id AND deleted_at IS NOT NULL
  `,
    )
    .run({ id });

  return result.changes > 0;
}

/**
 * Permanently delete an item from storage regardless of trash state. (Req 4.4,
 * 20.3) Returns `false` when no item with that id exists.
 */
export function deleteItem(db: VaultDatabase, id: string): boolean {
  const result = db
    .prepare(/* sql */ `DELETE FROM vault_item WHERE id = @id`)
    .run({ id });

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Re-encryption support (master-password change)
// ---------------------------------------------------------------------------

/** A single item's id and its opaque encrypted payload text. */
export interface ItemPayloadRow {
  id: string;
  encrypted_payload: string;
}

/**
 * Read the id + encrypted payload of EVERY item, including trashed ones.
 *
 * Used only by the master-password change flow, which must decrypt and
 * re-encrypt every payload with the new key. Trashed items are deliberately
 * included: skipping them would leave those rows encrypted under the old key
 * and permanently unreadable after the key changes. Returns ciphertext only;
 * no decryption happens here. (Req 12)
 */
export function listAllItemRowsForReencryption(db: VaultDatabase): ItemPayloadRow[] {
  return db
    .prepare(/* sql */ `SELECT id, encrypted_payload FROM vault_item`)
    .all() as ItemPayloadRow[];
}

/**
 * Replace ONLY an item's encrypted payload, leaving `version`, `updated_at`,
 * and all metadata untouched.
 *
 * This is distinct from {@link updateItem} (which bumps `version` and restamps
 * `updated_at`) because re-encrypting under a new master key is not a user
 * edit: the plaintext is unchanged, so the edit/sync bookkeeping must not move.
 * Returns `false` when no item with that id exists. (Req 12)
 */
export function setItemEncryptedPayload(
  db: VaultDatabase,
  id: string,
  encryptedPayload: string,
): boolean {
  const result = db
    .prepare(
      /* sql */ `UPDATE vault_item SET encrypted_payload = @encrypted_payload WHERE id = @id`,
    )
    .run({ id, encrypted_payload: encryptedPayload });

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Category CRUD
// ---------------------------------------------------------------------------

/**
 * Input for creating a category. Persists name, description, icon, and color.
 * (Req 7.2, 21.1)
 */
export interface CreateCategoryInput {
  id?: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

/** Input for updating an existing category. (Req 21.1) */
export interface UpdateCategoryInput {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

/** A category row augmented with its active item count. (Req 21.2) */
export interface CategoryRowWithCount extends CategoryRow {
  /** Number of active (non-trashed) items assigned to this category. */
  item_count: number;
}

/**
 * Create a category and return the persisted row. Records
 * `created_at`/`updated_at`. (Req 7.2, 21.1)
 */
export function createCategory(
  db: VaultDatabase,
  input: CreateCategoryInput,
): CategoryRow {
  const id = input.id ?? generateId();
  const ts = nowIso();

  db.prepare(
    /* sql */ `
    INSERT INTO category (
      id, name, description, icon, color, created_at, updated_at
    ) VALUES (
      @id, @name, @description, @icon, @color, @created_at, @updated_at
    )
  `,
  ).run({
    id,
    name: input.name,
    description: input.description,
    icon: input.icon,
    color: input.color,
    created_at: ts,
    updated_at: ts,
  });

  return getCategoryById(db, id)!;
}

/**
 * Update a category's metadata and re-stamp `updated_at`. (Req 21.1) Returns
 * the updated row, or `null` when no category with that id exists.
 */
export function updateCategory(
  db: VaultDatabase,
  input: UpdateCategoryInput,
): CategoryRow | null {
  const result = db
    .prepare(
      /* sql */ `
    UPDATE category
       SET name = @name,
           description = @description,
           icon = @icon,
           color = @color,
           updated_at = @updated_at
     WHERE id = @id
  `,
    )
    .run({
      id: input.id,
      name: input.name,
      description: input.description,
      icon: input.icon,
      color: input.color,
      updated_at: nowIso(),
    });

  if (result.changes === 0) {
    return null;
  }

  return getCategoryById(db, input.id);
}

/** Fetch a single category row by id, or `null` when not found. */
export function getCategoryById(
  db: VaultDatabase,
  id: string,
): CategoryRow | null {
  const row = db
    .prepare(/* sql */ `SELECT * FROM category WHERE id = @id`)
    .get({ id }) as CategoryRow | undefined;
  return row ?? null;
}

/**
 * List categories with their active item counts, ordered by name. The count is
 * a left join over active (non-trashed) items so empty categories report 0.
 * (Req 21.2)
 */
export function listCategoriesWithCounts(
  db: VaultDatabase,
): CategoryRowWithCount[] {
  return db
    .prepare(
      /* sql */ `
    SELECT c.*,
           COUNT(vi.id) AS item_count
      FROM category c
      LEFT JOIN vault_item vi
        ON vi.category_id = c.id
       AND vi.deleted_at IS NULL
     GROUP BY c.id
     ORDER BY c.name COLLATE NOCASE ASC
  `,
    )
    .all() as CategoryRowWithCount[];
}

/**
 * Count active items assigned to a category. Useful for confirmation prompts
 * before deletion. (Req 21.2)
 */
export function countItemsInCategory(db: VaultDatabase, id: string): number {
  const row = db
    .prepare(
      /* sql */ `
    SELECT COUNT(*) AS count
      FROM vault_item
     WHERE category_id = @id AND deleted_at IS NULL
  `,
    )
    .get({ id }) as { count: number };
  return row.count;
}

/**
 * Delete a category, safely clearing the assignment on any items that
 * referenced it so no item data is lost. (Req 21.3)
 *
 * The schema declares `vault_item.category_id ... ON DELETE SET NULL` and the
 * connection enables `PRAGMA foreign_keys = ON`, so SQLite would clear
 * references automatically. To make the behavior explicit and independent of
 * the connection's foreign-key pragma state, this function performs the
 * reassignment in a transaction: first null out matching `category_id` values
 * (including trashed items, so restore keeps working), then delete the row.
 *
 * @returns `false` when no category with that id exists; otherwise `true`.
 */
export function deleteCategory(db: VaultDatabase, id: string): boolean {
  const run = db.transaction((categoryId: string): boolean => {
    db.prepare(
      /* sql */ `
      UPDATE vault_item
         SET category_id = NULL
       WHERE category_id = @id
    `,
    ).run({ id: categoryId });

    const result = db
      .prepare(/* sql */ `DELETE FROM category WHERE id = @id`)
      .run({ id: categoryId });

    return result.changes > 0;
  });

  return run(id);
}
