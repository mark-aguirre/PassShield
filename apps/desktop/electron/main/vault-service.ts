/**
 * Vault Service (Electron main process).
 *
 * Owns the vault's unlock lifecycle and the single source of truth for whether
 * the vault is locked or unlocked. The derived {@link VaultKey} is held only in
 * this object's memory in the main process; it is never serialized, logged, or
 * handed to the renderer. (Req 11.5, 12.4)
 *
 * The service orchestrates the three lower-level packages:
 * - `@passshield/crypto`  — deriveKey / createVerifier / verify / encrypt / decrypt
 * - `@passshield/database` — openDatabase + item/category CRUD over encrypted rows
 * - `@passshield/contracts` — the shared item/category/result types
 *
 * Every secret-bearing operation (reading a decrypted item, saving an item,
 * item/category mutations) is gated behind an unlocked vault: when the vault is
 * locked these operations fail with a `locked` error and never touch key
 * material or ciphertext decryption. (Req 2.5, 4.5, 11.5, 20.4)
 *
 * The renderer never reaches this service directly; the IPC router (task 6)
 * calls these methods and marshals the results across the narrow context
 * bridge. (Req 11.1, 11.2)
 */

import {
  createVerifier,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  verify,
  type EncryptedPayload,
  type VaultKey,
  type VerifierRecord,
} from '@passshield/crypto';
import {
  closeDatabase,
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  getItemById,
  listCategoriesWithCounts,
  listItems,
  openDatabase,
  restoreItem,
  searchItems,
  trashItem,
  updateCategory,
  updateItem,
  type CategoryRow,
  type CategoryRowWithCount,
  type ItemScope,
  type ItemSort as DbItemSort,
  type VaultDatabase,
  type VaultItemRow,
} from '@passshield/database';
import type {
  Category,
  CategoryWithCount,
  CreateVaultInput,
  ItemDetail,
  ItemListFilter,
  ItemSort,
  ItemSummary,
  LoginPayload,
  NotePayload,
  Result,
  SaveCategoryInput,
  SaveItemInput,
  VaultStatus,
} from '@passshield/contracts';

/** Default auto-lock timeout (minutes) surfaced in {@link VaultStatus}. */
const DEFAULT_AUTO_LOCK_MINUTES = 15;

/** The single vault row id used by this local, single-vault application. */
const VAULT_ROW_ID = 'vault';

/**
 * Options for constructing a {@link VaultService}. The database path is
 * injected so the service stays testable and free of a hard dependency on
 * Electron's `app` module; the main entry supplies the per-user application
 * data location. (Req 1.4, 15.3)
 */
export interface VaultServiceOptions {
  /** Absolute path to the vault SQLite file (e.g. `<userData>/vault.sqlite`). */
  readonly databasePath: string;
  /** Optional non-secret logger for operational events. (Req 13) */
  readonly logger?: { info: (message: string, meta?: Record<string, unknown>) => void };
  /**
   * Optional hook invoked whenever the vault transitions to locked (manual
   * lock, auto-lock, or app exit). The main entry uses this to clear the
   * clipboard so a copied secret does not linger after the vault is secured,
   * keeping the clipboard concern in `main.ts` rather than coupling the vault
   * to the clipboard service. Invoked only when the vault was actually
   * unlocked, and its errors are swallowed so a failing hook never blocks the
   * lock. (Req 9.5)
   */
  readonly onLock?: () => void;
  /**
   * Optional hook invoked whenever the vault transitions to unlocked (via a
   * successful {@link VaultService.unlock} or {@link VaultService.create}). The
   * main entry wires this to (re)start the Auto-Lock Manager so the inactivity
   * countdown is anchored to the moment the vault becomes unlocked rather than
   * to app launch. Its errors are swallowed so a failing hook never blocks the
   * unlock. (Req 3.1, 3.2)
   */
  readonly onUnlock?: () => void;
  /**
   * Optional provider for the configured auto-lock timeout (minutes) surfaced
   * in {@link VaultStatus}. The main entry wires this to the Auto-Lock Manager
   * so the status projection (and the sidebar countdown) reflect the value
   * actually in effect. When omitted, the built-in default is used. A value of
   * `<= 0` means auto-lock is disabled ("never"). (Req 2.6, 3.4)
   */
  readonly autoLockMinutesProvider?: () => number;
}

/**
 * A safe, non-secret error result. Never carries key material, secret values,
 * or raw internals. (Req 2.3, 11.4)
 */
function fail(
  code: 'locked' | 'auth' | 'validation' | 'not_found' | 'conflict' | 'io' | 'unknown',
  message: string,
): { ok: false; error: { code: typeof code; message: string } } {
  return { ok: false, error: { code, message } };
}

/** A successful result envelope. */
function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Map the renderer-facing sort options to the database sort options. */
function toDbSort(sort: ItemSort | undefined): DbItemSort {
  switch (sort) {
    case 'titleDesc':
      return 'titleDesc';
    case 'recent':
      return 'recent';
    // 'relevance' has no distinct DB ordering for substring search; fall back
    // to a stable title ordering. 'titleAsc' and undefined map here too.
    case 'titleAsc':
    case 'relevance':
    default:
      return 'titleAsc';
  }
}

/** Map a stored item row to the non-secret {@link ItemSummary} contract. */
function toItemSummary(row: VaultItemRow): ItemSummary {
  return {
    id: row.id,
    itemType: row.item_type,
    title: row.title,
    categoryId: row.category_id,
    isFavorite: row.is_favorite === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** Map a category row (optionally with a count) to the {@link Category} contract. */
function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Map a counted category row to the {@link CategoryWithCount} contract. */
function toCategoryWithCount(row: CategoryRowWithCount): CategoryWithCount {
  return { ...toCategory(row), itemCount: row.item_count };
}

/**
 * In-memory unlock state. When `unlocked` the derived key and open database
 * handle live here and nowhere else; locking discards both. Keeping them
 * together guarantees "locked = no key, no open secret-bearing handle".
 */
interface UnlockedState {
  readonly key: VaultKey;
  readonly db: VaultDatabase;
}

/**
 * Orchestrates vault creation, unlock/lock, status, and all secret operations.
 * A single instance is held by the main process for the lifetime of the app.
 */
export class VaultService {
  private readonly databasePath: string;
  private readonly logger?: VaultServiceOptions['logger'];
  private readonly onLock?: () => void;
  private readonly onUnlock?: () => void;
  private readonly autoLockMinutesProvider?: () => number;

  /** Non-null only while the vault is unlocked. */
  private state: UnlockedState | null = null;

  constructor(options: VaultServiceOptions) {
    this.databasePath = options.databasePath;
    this.logger = options.logger;
    this.onLock = options.onLock;
    this.onUnlock = options.onUnlock;
    this.autoLockMinutesProvider = options.autoLockMinutesProvider;
  }

  /**
   * Notify the unlock hook that the vault has transitioned to unlocked. Called
   * on a successful create/unlock so the main entry can (re)start the Auto-Lock
   * Manager's inactivity timer from the moment of unlock. Hook errors are
   * swallowed so a failing side effect never blocks the unlock. (Req 3.1)
   */
  private notifyUnlocked(): void {
    if (this.onUnlock === undefined) {
      return;
    }
    try {
      this.onUnlock();
    } catch {
      // Ignore hook errors; unlocking must always succeed.
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle: exists / create / unlock / lock / status
  // -------------------------------------------------------------------------

  /**
   * Whether a vault already exists on this device: the database file is present
   * and carries a `vault` row. Opening the DB here runs migrations if needed
   * but reads no secrets. (Req 1.1, 2.1)
   */
  exists(): boolean {
    const db = this.openDb();
    try {
      return this.readVaultRow(db) !== null;
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Create a new vault: validate the password confirmation, generate a salt,
   * derive the key, create verification material, and persist the vault row in
   * a freshly-initialised database at the per-user app data path. On success
   * the vault is left unlocked with the derived key held in memory. (Req 1)
   *
   * Rejects when the confirmation does not match, and when a vault already
   * exists, without creating or overwriting anything. (Req 1.6)
   */
  async create(input: CreateVaultInput): Promise<Result> {
    if (input.masterPassword !== input.confirmPassword) {
      // Do not create a vault on mismatch. (Req 1.6)
      return fail('validation', 'The confirmation password does not match.');
    }
    if (input.masterPassword.length === 0) {
      return fail('validation', 'A master password is required.');
    }

    const db = this.openDb();
    try {
      if (this.readVaultRow(db) !== null) {
        return fail('conflict', 'A vault already exists on this device.');
      }

      const salt = generateSalt();
      const key = await deriveKey(input.masterPassword, salt);
      const verifier = createVerifier(key, salt);

      const ts = new Date().toISOString();
      db.prepare(
        /* sql */ `
        INSERT INTO vault (
          id, name, created_at, updated_at,
          encryption_version, kdf_salt, verifier
        ) VALUES (
          @id, @name, @created_at, @updated_at,
          @encryption_version, @kdf_salt, @verifier
        )
      `,
      ).run({
        id: VAULT_ROW_ID,
        name: input.name,
        created_at: ts,
        updated_at: ts,
        encryption_version: 1,
        kdf_salt: verifier.salt,
        verifier: JSON.stringify(verifier),
      });

      // Leave the vault unlocked with the key held in memory only. (Req 11.5)
      this.state = { key, db };
      this.logger?.info('vault created');
      // Anchor the auto-lock inactivity timer to this unlock. (Req 3.1)
      this.notifyUnlocked();
      return ok(undefined);
    } catch {
      closeDatabase(db);
      // Never surface raw internals to the renderer. (Req 11.4)
      return fail('io', 'Could not create the vault.');
    }
  }

  /**
   * Unlock the vault with the master password. Loads the stored verifier,
   * verifies the password, and on success derives and holds the key in memory
   * and opens the database handle. On failure it returns a generic auth error
   * that reveals nothing about whether the vault exists or why verification
   * failed. (Req 2.2, 2.3)
   */
  async unlock(password: string): Promise<Result> {
    const db = this.openDb();
    let verifier: VerifierRecord | null;
    try {
      verifier = this.readVerifier(db);
    } catch {
      closeDatabase(db);
      return fail('auth', 'Unable to unlock the vault.');
    }

    if (verifier === null) {
      // No vault / unreadable verifier: same generic error, revealing nothing.
      closeDatabase(db);
      return fail('auth', 'Unable to unlock the vault.');
    }

    let passwordValid: boolean;
    try {
      passwordValid = await verify(password, verifier);
    } catch {
      closeDatabase(db);
      return fail('auth', 'Unable to unlock the vault.');
    }

    if (!passwordValid) {
      // Wrong password: deny access, reveal nothing. (Req 2.3)
      closeDatabase(db);
      return fail('auth', 'Unable to unlock the vault.');
    }

    let key: VaultKey;
    try {
      const salt = Buffer.from(verifier.salt, 'base64');
      key = await deriveKey(password, salt, verifier.params);
    } catch {
      closeDatabase(db);
      return fail('auth', 'Unable to unlock the vault.');
    }

    // Replace any prior state (defensive) and hold the key in memory. (Req 11.5)
    this.dropState();
    this.state = { key, db };
    this.logger?.info('vault unlocked');
    // Anchor the auto-lock inactivity timer to this unlock. (Req 3.1)
    this.notifyUnlocked();
    return ok(undefined);
  }

  /**
   * Lock the vault immediately: drop the in-memory key and cached secrets where
   * practical and close the database handle. Idempotent. Called for manual
   * lock, auto-lock, and app exit. (Req 2.4, 3.3)
   */
  lock(): void {
    const wasUnlocked = this.state !== null;
    this.dropState();
    if (wasUnlocked) {
      this.logger?.info('vault locked');
    }
    // Notify the lock hook (e.g. clipboard clear) whenever the vault was
    // unlocked. Swallow hook errors so a failing side effect never blocks the
    // lock itself. (Req 9.5)
    if (wasUnlocked && this.onLock !== undefined) {
      try {
        this.onLock();
      } catch {
        // Ignore hook errors; locking must always succeed.
      }
    }
  }

  /** Current lock state and auto-lock configuration. (Req 2.6) */
  status(): VaultStatus {
    return {
      locked: this.state === null,
      // Reflect the configured auto-lock timeout (from the Auto-Lock Manager)
      // when a provider is wired; otherwise fall back to the default. (Req 2.6, 3.4)
      autoLockMinutes: this.autoLockMinutesProvider?.() ?? DEFAULT_AUTO_LOCK_MINUTES,
    };
  }

  /** Whether the vault is currently unlocked. */
  isUnlocked(): boolean {
    return this.state !== null;
  }

  // -------------------------------------------------------------------------
  // Item operations (all gated behind an unlocked vault)
  // -------------------------------------------------------------------------

  /**
   * List item metadata for a scope/sort. Returns non-secret summaries only —
   * no payload is decrypted. Requires an unlocked vault so a locked renderer
   * cannot enumerate items. (Req 6.4, 17, 2.5)
   */
  listItems(filter?: ItemListFilter, sort?: ItemSort): Result<ItemSummary[]> {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }

    const scope: ItemScope = filter?.scope ?? 'all';
    const rows = listItems(state.db, {
      scope,
      categoryId: filter?.categoryId ?? null,
      sort: toDbSort(sort),
    });
    return ok(rows.map(toItemSummary));
  }

  /**
   * Fetch and decrypt a single item for display. This is the only path that
   * exposes secret values, and only for an explicit reveal. Fails `locked` when
   * the vault is locked and `not_found` when the item is missing. (Req 9.1, 9.2, 2.5)
   */
  getItem(id: string): Result<ItemDetail> {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }

    const row = getItemById(state.db, id);
    if (row === null) {
      return fail('not_found', 'Item not found.');
    }

    let payload: LoginPayload | NotePayload;
    try {
      payload = this.decryptPayload(state.key, row);
    } catch {
      // Tampered/corrupt ciphertext or wrong key: fail safe, reveal nothing.
      return fail('io', 'Could not read the item.');
    }

    const summary = toItemSummary(row);
    if (row.item_type === 'login') {
      return ok({ ...summary, itemType: 'login', payload: payload as LoginPayload });
    }
    return ok({ ...summary, itemType: 'note', payload: payload as NotePayload });
  }

  /**
   * Create or update an item. Secret fields are encrypted into
   * `encrypted_payload` before persistence; plaintext metadata columns are
   * written for list/search. Requires an unlocked vault. (Req 4.2, 4.3, 5.2, 4.5)
   */
  saveItem(input: SaveItemInput): Result<ItemSummary> {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }

    let encryptedPayload: string;
    try {
      const plaintext = Buffer.from(JSON.stringify(input.payload), 'utf8');
      const encrypted = encrypt(state.key, plaintext);
      encryptedPayload = JSON.stringify(encrypted);
    } catch {
      return fail('io', 'Could not save the item.');
    }

    if (input.id === undefined) {
      const row = createItem(state.db, {
        itemType: input.itemType,
        title: input.title,
        categoryId: input.categoryId,
        isFavorite: input.isFavorite,
        encryptedPayload,
      });
      return ok(toItemSummary(row));
    }

    const row = updateItem(state.db, {
      id: input.id,
      title: input.title,
      categoryId: input.categoryId,
      isFavorite: input.isFavorite,
      encryptedPayload,
    });
    if (row === null) {
      return fail('not_found', 'Item not found.');
    }
    return ok(toItemSummary(row));
  }

  /** Soft-delete (move to trash). Requires an unlocked vault. (Req 20.1, 20.4) */
  trashItem(id: string): Result {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }
    return trashItem(state.db, id) ? ok(undefined) : fail('not_found', 'Item not found.');
  }

  /** Restore a trashed item. Requires an unlocked vault. (Req 20.2, 20.4) */
  restoreItem(id: string): Result {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }
    return restoreItem(state.db, id) ? ok(undefined) : fail('not_found', 'Item not found.');
  }

  /** Permanently delete an item. Requires an unlocked vault. (Req 4.4, 20.3, 20.4) */
  deleteItem(id: string): Result {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }
    return deleteItem(state.db, id) ? ok(undefined) : fail('not_found', 'Item not found.');
  }

  /**
   * Search over plaintext metadata. Returns non-secret summaries only; no
   * payload is decrypted. Requires an unlocked vault. (Req 6.1, 6.2, 6.4, 2.5)
   */
  searchItems(query: string, sort?: ItemSort): Result<ItemSummary[]> {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }
    const rows = searchItems(state.db, query, toDbSort(sort));
    return ok(rows.map(toItemSummary));
  }

  // -------------------------------------------------------------------------
  // Category operations (all gated behind an unlocked vault)
  // -------------------------------------------------------------------------

  /** List categories with item counts. Requires an unlocked vault. (Req 21.2, 2.5) */
  listCategories(): Result<CategoryWithCount[]> {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }
    const rows = listCategoriesWithCounts(state.db);
    return ok(rows.map(toCategoryWithCount));
  }

  /** Create or update a category. Requires an unlocked vault. (Req 7.2, 21.1, 4.5) */
  saveCategory(input: SaveCategoryInput): Result<Category> {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }

    if (input.id === undefined) {
      const row = createCategory(state.db, {
        name: input.name,
        description: input.description,
        icon: input.icon,
        color: input.color,
      });
      return ok(toCategory(row));
    }

    const row = updateCategory(state.db, {
      id: input.id,
      name: input.name,
      description: input.description,
      icon: input.icon,
      color: input.color,
    });
    if (row === null) {
      return fail('not_found', 'Category not found.');
    }
    return ok(toCategory(row));
  }

  /**
   * Delete a category, safely clearing the assignment on any items that
   * referenced it. Requires an unlocked vault. (Req 21.3, 4.5)
   */
  deleteCategory(id: string): Result {
    const state = this.state;
    if (state === null) {
      return fail('locked', 'The vault is locked.');
    }
    return deleteCategory(state.db, id)
      ? ok(undefined)
      : fail('not_found', 'Category not found.');
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Drop the in-memory key and close the open database handle. Zeroes the key
   * buffer where practical before releasing the reference so raw key material
   * does not linger in memory. (Req 2.4, 11.5)
   */
  private dropState(): void {
    const state = this.state;
    if (state === null) {
      return;
    }
    this.state = null;
    try {
      // Best-effort zeroization of the derived key material. (Req 2.4)
      state.key.key.fill(0);
    } catch {
      // Ignore: the buffer may be non-writable in some environments.
    }
    try {
      closeDatabase(state.db);
    } catch {
      // Ignore close errors; the handle is being discarded regardless.
    }
  }

  /** Open the vault database at the configured path (runs migrations). */
  private openDb(): VaultDatabase {
    return openDatabase({ filename: this.databasePath, logger: this.logger });
  }

  /** Read the single vault row, or null when no vault has been created. */
  private readVaultRow(db: VaultDatabase): { verifier: string } | null {
    const row = db
      .prepare(/* sql */ `SELECT verifier FROM vault WHERE id = @id`)
      .get({ id: VAULT_ROW_ID }) as { verifier: string } | undefined;
    return row ?? null;
  }

  /** Read and parse the stored verifier, or null when absent/unparseable. */
  private readVerifier(db: VaultDatabase): VerifierRecord | null {
    const row = this.readVaultRow(db);
    if (row === null) {
      return null;
    }
    return JSON.parse(row.verifier) as VerifierRecord;
  }

  /** Decrypt an item row's payload into its typed shape. */
  private decryptPayload(key: VaultKey, row: VaultItemRow): LoginPayload | NotePayload {
    const encrypted = JSON.parse(row.encrypted_payload) as EncryptedPayload;
    const plaintext = decrypt(key, encrypted);
    return JSON.parse(plaintext.toString('utf8')) as LoginPayload | NotePayload;
  }
}
