/**
 * @passshield/contracts
 *
 * Shared type definitions for the IPC surface and vault item model.
 *
 * These types form the single source of truth for the boundary between the
 * Electron main process and the Next.js renderer. The renderer only ever
 * reaches the main process through the narrow, typed IPC surface defined at
 * the bottom of this file (`PassShieldApi`), exposed via the preload
 * contextBridge as `window.passShield`.
 *
 * Design references: "Security Boundary and IPC Contract" and "Data Model".
 * Requirements: 4.1, 5.1, 7.2, 11.4.
 */

/** Marker for the contracts package version surface. */
export const CONTRACTS_PACKAGE_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Item model
// ---------------------------------------------------------------------------

/** The kind of item stored in the vault. */
export type ItemType = 'login' | 'note';

/**
 * Non-secret metadata for a vault item, used to render lists, search results,
 * category filters, and favorites without decrypting the encrypted payload.
 *
 * These fields map to the plaintext columns on `vault_item`. Secret values are
 * never included here; they are returned only by `items.get`. _(Req 4.1, 6.4, 7.4)_
 */
export interface ItemSummary {
  /** Stable UUID for the item. */
  id: string;
  /** Whether this is a login or a secure note. */
  itemType: ItemType;
  /** Non-secret display title. */
  title: string;
  /** Assigned category id, or null when uncategorized. */
  categoryId: string | null;
  /** Whether the user has flagged the item as a favorite. */
  isFavorite: boolean;
  /** Monotonic edit/sync version, bumped on each save. */
  version: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
  /** ISO 8601 soft-delete (trash) timestamp, or null when active. */
  deletedAt: string | null;
  /**
   * Parent item id when this item is a sub-page of another item, or null when
   * it is a top-level item. Enables secure-note sub-pages (arbitrary depth).
   */
  parentId: string | null;
}

/**
 * Decrypted secret fields for a login item. Never persisted in plaintext;
 * lives inside the AEAD `encrypted_payload`. _(Req 4.1)_
 */
export interface LoginPayload {
  username: string;
  password: string;
  website: string;
  notes: string;
}

/**
 * A file attached to a secure note. Modeled on an email attachment: the raw
 * bytes are Base64-encoded (MIME-style) into `data` and travel inside the same
 * AEAD `encrypted_payload` as the note body, so attachments inherit the vault's
 * encryption with no separate storage. `filename`, `mimeType`, and `size`
 * describe the original file for display and for reconstructing a download.
 * _(Req 5.1)_
 */
export interface NoteAttachment {
  /** Original file name, used for display and download. */
  filename: string;
  /** MIME content type (e.g. `application/pdf`), used to rebuild the data URL. */
  mimeType: string;
  /** Original size of the decoded file, in bytes. */
  size: number;
  /** Base64-encoded file bytes (no `data:` prefix). */
  data: string;
}

/**
 * Decrypted secret fields for a secure note. Never persisted in plaintext;
 * lives inside the AEAD `encrypted_payload`. _(Req 5.1)_
 *
 * A note is composed like an email message: an optional `subject` line, a
 * markdown `content` body, and optional file `attachments`. `subject` and
 * `attachments` are optional so notes created before this shape existed (which
 * carry only `content`) remain valid.
 */
export interface NotePayload {
  /** Markdown note body. */
  content: string;
  /** Optional subject/heading line, like an email subject. */
  subject?: string;
  /** Optional Base64-encoded file attachments. */
  attachments?: NoteAttachment[];
}

/**
 * A fully decrypted item as returned by `items.get` for display. Carries the
 * summary metadata plus the decrypted secret payload appropriate to its type.
 * This is the only shape that exposes secret values, and only in explicit
 * reveal flows. _(Req 9.1)_
 */
export type ItemDetail =
  | (ItemSummary & { itemType: 'login'; payload: LoginPayload })
  | (ItemSummary & { itemType: 'note'; payload: NotePayload });

/**
 * A category used to organize items. Persists name, description, icon, and
 * color. _(Req 7.2, 21.1)_
 */
export interface Category {
  /** Stable UUID for the category. */
  id: string;
  /** Display name. */
  name: string;
  /** Optional free-form description. */
  description: string | null;
  /** Icon identifier (name/key resolved by the renderer). */
  icon: string | null;
  /** Color token or hex string. */
  color: string | null;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

/**
 * A category augmented with its current item count, used by the category
 * management view. _(Req 21.2)_
 */
export interface CategoryWithCount extends Category {
  /** Number of active (non-trashed) items assigned to this category. */
  itemCount: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Theme preference. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** Action taken when the main window close control is used. */
export type CloseBehavior = 'minimizeToTray' | 'quit';

/**
 * User-facing application settings, persisted in the `settings` table and
 * applied across sessions. Values are non-secret. _(Req 3.4, 9.4, 14.3)_
 */
export interface Settings {
  // General / startup
  launchOnStartup: boolean;
  startMinimized: boolean;
  closeBehavior: CloseBehavior;
  // Appearance
  theme: ThemePreference;
  accentColor: string;
  language: string;
  checkForUpdates: boolean;
  // Security — vault lock
  autoLockMinutes: number;
  lockOnSystemLock: boolean;
  lockOnSleep: boolean;
  lockOnAppExit: boolean;
  requireMasterPasswordOnRestart: boolean;
  // Security — clipboard
  clipboardClearSeconds: number;
  preventClipboardHistory: boolean;
}

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

/**
 * Safe, non-secret error shape returned across the IPC boundary. Never carries
 * raw internals or secret values. _(Req 11.4, Error Handling)_
 */
export interface IpcError {
  /** Stable, machine-readable error code. */
  code: 'locked' | 'auth' | 'validation' | 'not_found' | 'conflict' | 'io' | 'unknown';
  /** Human-readable, non-secret message safe to surface in the renderer. */
  message: string;
}

/** Discriminated result envelope for operations that can fail. */
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: IpcError };

// ---------------------------------------------------------------------------
// Operation inputs
// ---------------------------------------------------------------------------

/** Storage mode chosen at vault creation. V1 defaults to local. _(Req 1.7)_ */
export type StorageMode = 'local';

/** Input for creating a new vault. _(Req 1.2, 1.3)_ */
export interface CreateVaultInput {
  /** Vault display name. */
  name: string;
  /** Chosen master password. */
  masterPassword: string;
  /** Confirmation of the master password; must match. */
  confirmPassword: string;
  /** Storage mode; defaults to local in V1. */
  storageMode: StorageMode;
}

/** Current vault lock/state, returned by `vault.status`. _(Req 2.6)_ */
export interface VaultStatus {
  locked: boolean;
  autoLockMinutes: number;
}

/**
 * Input for `vault.changeMasterPassword`. The current password is re-verified
 * before any change, and the new password must equal its confirmation. On
 * success the main process re-encrypts every item under a key derived from the
 * new password and recomputes the stored verifier. No secret values cross the
 * IPC boundary beyond these passwords. _(Req 12)_
 */
export interface ChangeMasterPasswordInput {
  /** The current master password, re-verified before any change is made. */
  currentPassword: string;
  /** The new master password to set. */
  newPassword: string;
  /** Confirmation of the new master password; must match `newPassword`. */
  confirmPassword: string;
}

/** Scope selector for `items.list`. */
export type ItemScope = 'all' | 'favorites' | 'recent' | 'logins' | 'notes' | 'category';

/** Filter for `items.list`. */
export interface ItemListFilter {
  scope: ItemScope;
  /** Required when scope is 'category'. */
  categoryId?: string;
}

/** Sort options for item lists and search results. _(Req 17.2)_ */
export type ItemSort = 'titleAsc' | 'titleDesc' | 'recent' | 'relevance';

/**
 * Input for creating or updating an item via `items.save`. When `id` is
 * omitted the item is created; otherwise it is updated. The secret payload is
 * encrypted by the main process before persistence. _(Req 4.2, 5.2)_
 */
export type SaveItemInput =
  | {
      id?: string;
      itemType: 'login';
      title: string;
      categoryId: string | null;
      isFavorite: boolean;
      payload: LoginPayload;
      /**
       * Parent item id when saving a sub-page, or null/omitted for a top-level
       * item. Logins are always top-level in practice, but the field is present
       * on both arms so the update round-trip preserves it uniformly.
       */
      parentId?: string | null;
    }
  | {
      id?: string;
      itemType: 'note';
      title: string;
      categoryId: string | null;
      isFavorite: boolean;
      payload: NotePayload;
      /**
       * Parent note id when this note is a sub-page, or null/omitted for a
       * top-level note. Enables arbitrary-depth secure-note sub-pages.
       */
      parentId?: string | null;
    };

/**
 * Input for creating or updating a category via `categories.save`. When `id`
 * is omitted the category is created; otherwise it is updated. _(Req 7.2, 21.1)_
 */
export interface SaveCategoryInput {
  id?: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

/**
 * Options for the password generator. _(Req 8.2, 19.1, 19.2, 19.3)_
 */
export interface GeneratorOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeSimilar: boolean;
  avoidAmbiguous: boolean;
  ensureEveryType: boolean;
  minNumbers: number;
  minSymbols: number;
}

/** Result of a password generation request. _(Req 8.1, 18.1)_ */
export interface GeneratedPassword {
  value: string;
  /** Locally-computed strength score/label. _(Req 18.2)_ */
  strength: PasswordStrength;
}

/** Locally-computed password strength feedback. _(Req 18.1, 18.3)_ */
export interface PasswordStrength {
  /** 0–4 strength score. */
  score: 0 | 1 | 2 | 3 | 4;
  /** Non-prescriptive label (no policy-compliance claim). */
  label: string;
}

// ---------------------------------------------------------------------------
// Typed IPC surface
// ---------------------------------------------------------------------------

/**
 * The complete, narrow IPC contract exposed to the renderer via the preload
 * contextBridge as `window.passShield`. There is no generic passthrough
 * channel; every operation is an explicit, typed method. _(Req 11.2, 11.4)_
 *
 * Grouping matches the design's "Security Boundary and IPC Contract" section:
 * vault.*, items.*, categories.*, generator.*, clipboard.*, settings.*,
 * backup.*, activity.*.
 */
export interface PassShieldApi {
  app: {
    /**
     * The running application's version (e.g. "1.0.3"), sourced from the
     * packaged app so UI surfaces like the About pane always reflect the real
     * build rather than a hard-coded constant. _(Req 14)_
     */
    version(): Promise<string>;
  };

  vault: {
    /** Whether a vault already exists on this device. _(Req 1.1, 2.1)_ */
    exists(): Promise<boolean>;
    /** Create a new vault. _(Req 1)_ */
    create(input: CreateVaultInput): Promise<Result>;
    /** Unlock the vault with the master password. _(Req 2.2, 2.3)_ */
    unlock(password: string): Promise<Result>;
    /** Lock the vault immediately. _(Req 2.4)_ */
    lock(): Promise<void>;
    /** Current lock state and auto-lock configuration. _(Req 2.6)_ */
    status(): Promise<VaultStatus>;
    /**
     * Change the master password. Re-verifies the current password, then
     * re-encrypts the vault under a key derived from the new password and
     * updates the stored verifier. _(Req 12)_
     */
    changeMasterPassword(input: ChangeMasterPasswordInput): Promise<Result>;
    /**
     * Subscribe to vault-lock notifications pushed by the main process. Fires
     * whenever the vault becomes locked without an explicit renderer request —
     * most importantly when the auto-lock inactivity timer elapses — so the UI
     * can redirect to the unlock screen instead of showing a stale unlocked
     * shell. Returns an unsubscribe function. _(Req 2.4, 3.2)_
     */
    onLocked(callback: () => void): () => void;
  };

  items: {
    /** List item metadata for a scope/sort. No secrets. _(Req 6.4, 17)_ */
    list(filter?: ItemListFilter, sort?: ItemSort): Promise<ItemSummary[]>;
    /** Fetch a single decrypted item for display. _(Req 9.1, 9.2)_ */
    get(id: string): Promise<Result<ItemDetail>>;
    /** Create or update an item. _(Req 4.2, 4.3, 5.2)_ */
    save(item: SaveItemInput): Promise<Result<ItemSummary>>;
    /** Soft-delete (move to trash). _(Req 20.1)_ */
    trash(id: string): Promise<Result>;
    /** Restore a trashed item. _(Req 20.2)_ */
    restore(id: string): Promise<Result>;
    /** Permanently delete an item. _(Req 4.4, 20.3)_ */
    delete(id: string): Promise<Result>;
    /** Search over plaintext metadata. No secrets. _(Req 6.1, 6.2)_ */
    search(query: string, sort?: ItemSort): Promise<ItemSummary[]>;
    /**
     * List the direct sub-pages (children) of a note. Metadata only, no
     * secrets. Returns an empty array when the parent has none or the vault is
     * locked.
     */
    listChildren(parentId: string, sort?: ItemSort): Promise<ItemSummary[]>;
  };

  categories: {
    /** List categories with item counts. _(Req 21.2)_ */
    list(): Promise<CategoryWithCount[]>;
    /** Create or update a category. _(Req 7.2, 21.1)_ */
    save(category: SaveCategoryInput): Promise<Result<Category>>;
    /** Delete a category with safe item reassignment. _(Req 21.3)_ */
    delete(id: string): Promise<Result>;
  };

  generator: {
    /** Generate a password from options. _(Req 8.1, 8.2)_ */
    generate(opts: GeneratorOptions): Promise<Result<GeneratedPassword>>;
  };

  clipboard: {
    /** Copy a secret via the main process, which manages the clear timer. _(Req 9.3, 9.4)_ */
    copySecret(value: string): Promise<void>;
  };

  settings: {
    /** Read all settings. _(Req 14.3)_ */
    get(): Promise<Settings>;
    /** Apply a partial settings update; returns the merged result. _(Req 3.4, 9.4)_ */
    update(patch: Partial<Settings>): Promise<Settings>;
  };

  backup: {
    /** Export an encrypted backup to a user-selected path. _(Req 10.1, 10.5)_ */
    export(path: string): Promise<Result>;
    /** Validate and restore from an encrypted backup. _(Req 10.3, 10.4)_ */
    restore(path: string, password: string): Promise<Result>;
  };

  activity: {
    /**
     * Notify the main process of non-secret user activity so the Auto-Lock
     * Manager can reset its inactivity timer. Fire-and-forget: it carries no
     * payload and returns nothing. The renderer is expected to throttle these
     * pings. _(Req 3.1)_
     */
    ping(): void;
  };
}

/** Global augmentation for the renderer-visible API. */
declare global {
  interface Window {
    passShield: PassShieldApi;
  }
}
