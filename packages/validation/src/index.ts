/**
 * @passshield/validation
 *
 * Input validation schemas for every mutating and input-bearing IPC
 * operation, so the main-process boundary can validate input shape.
 *
 * The IPC router in the Electron main process validates each incoming request
 * against these schemas before dispatching to a service. This enforces the
 * "validate input shape at the boundary" step of the design's IPC contract:
 * malformed or unexpected input is rejected with a safe validation error and
 * never reaches the vault, crypto, or database layers. _(Req 11.2, 11.4)_
 *
 * Schemas are intentionally self-contained (they do not import the
 * `@passshield/contracts` types) so the boundary validator has no build-order
 * coupling to the contracts package. Their shapes mirror the operation input
 * types declared in `@passshield/contracts`; each schema's inferred type is
 * exported so callers can rely on parse output being correctly typed.
 *
 * Design reference: "Security Boundary and IPC Contract" — every handler first
 * validates input shape (validation package / zod-style schema).
 */

import * as z from 'zod';

/** Marker for the validation package version surface. */
export const VALIDATION_PACKAGE_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A non-empty identifier string (used for item/category ids). */
const idSchema = z.string().min(1);

/** A non-empty title string. */
const titleSchema = z.string().min(1);

/** Storage mode chosen at vault creation. V1 supports local only. _(Req 1.7)_ */
export const storageModeSchema = z.literal('local');

// ---------------------------------------------------------------------------
// Item payloads
// ---------------------------------------------------------------------------

/** Secret fields for a login item. _(Req 4.1)_ */
export const loginPayloadSchema = z.object({
  username: z.string(),
  password: z.string(),
  website: z.string(),
  notes: z.string(),
});
export type LoginPayloadInput = z.infer<typeof loginPayloadSchema>;

/**
 * A single note attachment: an email-style, Base64-encoded file. `size` is a
 * non-negative integer (bytes) and `data` is the Base64 payload (no `data:`
 * prefix). Shape mirrors `NoteAttachment` in `@passshield/contracts`. _(Req 5.1)_
 */
export const noteAttachmentSchema = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().min(0),
  data: z.string(),
});
export type NoteAttachmentInput = z.infer<typeof noteAttachmentSchema>;

/**
 * Secret fields for a secure note. `subject` and `attachments` are optional so
 * legacy notes carrying only `content` still validate at the boundary. _(Req 5.1)_
 */
export const notePayloadSchema = z.object({
  content: z.string(),
  subject: z.string().optional(),
  attachments: z.array(noteAttachmentSchema).optional(),
});
export type NotePayloadInput = z.infer<typeof notePayloadSchema>;

// ---------------------------------------------------------------------------
// vault.*
// ---------------------------------------------------------------------------

/**
 * Input for `vault.create`. The master password and its confirmation must be
 * present; the router / vault service enforces that they match. _(Req 1.2, 1.3)_
 */
export const createVaultInputSchema = z.object({
  name: z.string().min(1),
  masterPassword: z.string().min(1),
  confirmPassword: z.string().min(1),
  storageMode: storageModeSchema,
});
export type CreateVaultInputParsed = z.infer<typeof createVaultInputSchema>;

/** Input for `vault.unlock`: the master password. _(Req 2.2, 2.3)_ */
export const unlockInputSchema = z.string().min(1);
export type UnlockInputParsed = z.infer<typeof unlockInputSchema>;

/**
 * Input for `vault.changeMasterPassword`. All three fields must be present and
 * non-empty; the vault service enforces that `newPassword` equals
 * `confirmPassword` and re-verifies `currentPassword`. _(Req 12)_
 */
export const changeMasterPasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
  confirmPassword: z.string().min(1),
});
export type ChangeMasterPasswordInputParsed = z.infer<typeof changeMasterPasswordInputSchema>;

// ---------------------------------------------------------------------------
// items.*
// ---------------------------------------------------------------------------

/** Scope selector for `items.list`. */
export const itemScopeSchema = z.enum([
  'all',
  'favorites',
  'recent',
  'logins',
  'notes',
  'category',
]);

/** Sort options for item lists and search results. _(Req 17.2)_ */
export const itemSortSchema = z.enum(['titleAsc', 'titleDesc', 'recent', 'relevance']);

/**
 * Filter for `items.list`. When scope is 'category', a categoryId must be
 * supplied; for every other scope categoryId must be omitted.
 */
export const itemListFilterSchema = z
  .object({
    scope: itemScopeSchema,
    categoryId: idSchema.optional(),
  })
  .refine(
    (f) => (f.scope === 'category' ? f.categoryId !== undefined : f.categoryId === undefined),
    {
      message: "categoryId is required when scope is 'category' and forbidden otherwise",
      path: ['categoryId'],
    },
  );
export type ItemListFilterParsed = z.infer<typeof itemListFilterSchema>;

/**
 * Input for `items.save`. A discriminated union on `itemType`: when `id` is
 * omitted the item is created, otherwise updated. The secret payload is
 * encrypted by the main process after validation. _(Req 4.2, 5.2)_
 */
export const saveItemInputSchema = z.discriminatedUnion('itemType', [
  z.object({
    id: idSchema.optional(),
    itemType: z.literal('login'),
    title: titleSchema,
    categoryId: idSchema.nullable(),
    isFavorite: z.boolean(),
    payload: loginPayloadSchema,
    // Sub-page parent id. Optional + nullable so callers that never set it
    // (and legacy renderer builds) still validate as top-level items. _(Req 5.1)_
    parentId: idSchema.nullable().optional(),
  }),
  z.object({
    id: idSchema.optional(),
    itemType: z.literal('note'),
    title: titleSchema,
    categoryId: idSchema.nullable(),
    isFavorite: z.boolean(),
    payload: notePayloadSchema,
    // Parent note id when this note is a sub-page; null/omitted = top-level.
    parentId: idSchema.nullable().optional(),
  }),
]);
export type SaveItemInputParsed = z.infer<typeof saveItemInputSchema>;

/**
 * Input for `items.listChildren`: the parent item id whose direct sub-pages
 * should be listed. _(Req 5.1)_
 */
export const listChildrenInputSchema = idSchema;
export type ListChildrenInputParsed = z.infer<typeof listChildrenInputSchema>;

/** Input for `items.get`: the item id. _(Req 9.1)_ */
export const itemIdInputSchema = idSchema;
export type ItemIdInputParsed = z.infer<typeof itemIdInputSchema>;

/**
 * Input for `items.search`. `query` may be empty (an empty query restores the
 * full list) with an optional sort. _(Req 6.1, 6.3)_
 */
export const searchInputSchema = z.object({
  query: z.string(),
  sort: itemSortSchema.optional(),
});
export type SearchInputParsed = z.infer<typeof searchInputSchema>;

// ---------------------------------------------------------------------------
// categories.*
// ---------------------------------------------------------------------------

/**
 * Input for `categories.save`. When `id` is omitted the category is created;
 * otherwise it is updated. _(Req 7.2, 21.1)_
 */
export const saveCategoryInputSchema = z.object({
  id: idSchema.optional(),
  name: z.string().min(1),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
});
export type SaveCategoryInputParsed = z.infer<typeof saveCategoryInputSchema>;

/** Input for `categories.delete`: the category id. _(Req 21.3)_ */
export const categoryIdInputSchema = idSchema;
export type CategoryIdInputParsed = z.infer<typeof categoryIdInputSchema>;

// ---------------------------------------------------------------------------
// generator.*
// ---------------------------------------------------------------------------

/**
 * Options for `generator.generate`. Length and minimums are constrained to
 * sane, non-negative integer bounds; unsatisfiable combinations are surfaced
 * by the generator itself, not here. _(Req 8.2, 19.1, 19.2, 19.3)_
 */
export const generatorOptionsSchema = z.object({
  length: z.number().int().min(1).max(4096),
  upper: z.boolean(),
  lower: z.boolean(),
  numbers: z.boolean(),
  symbols: z.boolean(),
  excludeSimilar: z.boolean(),
  avoidAmbiguous: z.boolean(),
  ensureEveryType: z.boolean(),
  minNumbers: z.number().int().min(0),
  minSymbols: z.number().int().min(0),
});
export type GeneratorOptionsParsed = z.infer<typeof generatorOptionsSchema>;

// ---------------------------------------------------------------------------
// clipboard.*
// ---------------------------------------------------------------------------

/** Input for `clipboard.copySecret`: the value to copy. _(Req 9.3, 9.4)_ */
export const copySecretInputSchema = z.string();
export type CopySecretInputParsed = z.infer<typeof copySecretInputSchema>;

// ---------------------------------------------------------------------------
// settings.*
// ---------------------------------------------------------------------------

/** Theme preference. */
export const themePreferenceSchema = z.enum(['light', 'dark', 'system']);

/** Action taken when the main window close control is used. */
export const closeBehaviorSchema = z.enum(['minimizeToTray', 'quit']);

/**
 * Full settings shape. Used to derive the partial patch accepted by
 * `settings.update`. All values are non-secret. _(Req 3.4, 9.4, 14.3)_
 */
export const settingsSchema = z.object({
  launchOnStartup: z.boolean(),
  startMinimized: z.boolean(),
  closeBehavior: closeBehaviorSchema,
  theme: themePreferenceSchema,
  accentColor: z.string(),
  language: z.string(),
  checkForUpdates: z.boolean(),
  autoLockMinutes: z.number().int().min(0),
  lockOnSystemLock: z.boolean(),
  lockOnSleep: z.boolean(),
  lockOnAppExit: z.boolean(),
  requireMasterPasswordOnRestart: z.boolean(),
  clipboardClearSeconds: z.number().int().min(0),
  preventClipboardHistory: z.boolean(),
});
export type SettingsParsed = z.infer<typeof settingsSchema>;

/**
 * Input for `settings.update`: a partial patch over the settings shape. At
 * least one recognized key must be present, and unknown keys are rejected so
 * the boundary does not silently accept unexpected fields. _(Req 3.4, 9.4)_
 */
export const settingsUpdateInputSchema = settingsSchema
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'settings update patch must contain at least one field',
  });
export type SettingsUpdateInputParsed = z.infer<typeof settingsUpdateInputSchema>;

// ---------------------------------------------------------------------------
// backup.*
// ---------------------------------------------------------------------------

/** Input for `backup.export`: the destination path. _(Req 10.1, 10.5)_ */
export const backupExportInputSchema = z.object({
  path: z.string().min(1),
});
export type BackupExportInputParsed = z.infer<typeof backupExportInputSchema>;

/**
 * Input for `backup.restore`: the source path and the password protecting the
 * backup. _(Req 10.3, 10.4)_
 */
export const backupRestoreInputSchema = z.object({
  path: z.string().min(1),
  password: z.string().min(1),
});
export type BackupRestoreInputParsed = z.infer<typeof backupRestoreInputSchema>;

// ---------------------------------------------------------------------------
// Aggregate registry
// ---------------------------------------------------------------------------

/**
 * A registry mapping every input-bearing IPC operation to its input schema,
 * grouped to match the `PassShieldApi` surface in `@passshield/contracts`.
 *
 * The IPC router can look up the schema for an operation and call `.parse` /
 * `.safeParse` on the raw request payload before dispatching. Read operations
 * that take no input (`vault.exists`, `vault.lock`, `vault.status`,
 * `settings.get`, `categories.list`) are intentionally absent — there is no
 * input shape to validate. `items.list` carries only optional filter/sort
 * arguments and is included so those can be validated when present.
 */
export const ipcInputSchemas = {
  vault: {
    create: createVaultInputSchema,
    unlock: unlockInputSchema,
    changeMasterPassword: changeMasterPasswordInputSchema,
  },
  items: {
    list: itemListFilterSchema,
    listSort: itemSortSchema,
    get: itemIdInputSchema,
    save: saveItemInputSchema,
    trash: itemIdInputSchema,
    restore: itemIdInputSchema,
    delete: itemIdInputSchema,
    search: searchInputSchema,
    listChildren: listChildrenInputSchema,
    listChildrenSort: itemSortSchema,
  },
  categories: {
    save: saveCategoryInputSchema,
    delete: categoryIdInputSchema,
  },
  generator: {
    generate: generatorOptionsSchema,
  },
  clipboard: {
    copySecret: copySecretInputSchema,
  },
  settings: {
    update: settingsUpdateInputSchema,
  },
  backup: {
    export: backupExportInputSchema,
    restore: backupRestoreInputSchema,
  },
} as const;
