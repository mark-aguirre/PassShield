/**
 * @PassShield/database
 *
 * SQLite schema, a version-keyed migration runner, and CRUD queries over
 * encrypted item payloads with plaintext metadata columns.
 *
 * Task 4.1 implements the schema and the migration runner. The vault stores
 * secret fields as AEAD ciphertext text in `vault_item.encrypted_payload`,
 * keeping only non-secret metadata (`title`, `category_id`, `is_favorite`) in
 * plaintext columns. Migrations are keyed on a schema/encryption version and
 * log only "migration applied". Task 4.2 adds the CRUD query layer, which is
 * encryption-agnostic: it stores and returns the payload as opaque ciphertext.
 * (Req 1.4, 4.2, 5.2, 7.2, 13.2, 20.1, 21.1)
 */

export { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_VERSION } from './schema.js';

export {
  getSchemaVersion,
  isUpToDate,
  MIGRATIONS,
  runMigrations,
  type Migration,
  type MigrationLogger,
} from './migrations.js';

export {
  closeDatabase,
  openDatabase,
  type OpenDatabaseOptions,
  type VaultDatabase,
} from './connection.js';

export type {
  CategoryRow,
  SettingsRow,
  VaultItemRow,
  VaultRow,
} from './types.js';

export {
  // Item CRUD
  createItem,
  updateItem,
  getItemById,
  listItems,
  listChildren,
  collectSubtreeIds,
  listTrashedItems,
  searchItems,
  trashItem,
  restoreItem,
  deleteItem,
  // Re-encryption support (master-password change)
  listAllItemRowsForReencryption,
  setItemEncryptedPayload,
  // Category CRUD
  createCategory,
  updateCategory,
  getCategoryById,
  listCategoriesWithCounts,
  countItemsInCategory,
  deleteCategory,
  // Types
  type CreateItemInput,
  type UpdateItemInput,
  type ItemPayloadRow,
  type ItemScope,
  type ItemSort,
  type ListItemsOptions,
  type CreateCategoryInput,
  type UpdateCategoryInput,
  type CategoryRowWithCount,
} from './queries.js';

export {
  // Settings key/value store (non-secret; string-based)
  getAllSettings,
  getSetting,
  setSetting,
  setSettings,
} from './settings.js';

export {
  // Emergency recovery code hash (non-secret one-way hash only)
  getEmergencyCodeHash,
  setEmergencyCodeHash,
} from './emergency-code.js';

/** Marker for the database package version surface. */
export const DATABASE_PACKAGE_VERSION = '0.1.0';
