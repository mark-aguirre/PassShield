/**
 * Typed IPC router (Electron main process).
 *
 * This is the single dispatch point between the renderer and the privileged
 * main-process services. It registers one `ipcMain.handle` per operation in
 * the {@link PassShieldApi} surface (see `@passshield/contracts`) and, for each
 * request:
 *
 *   1. Validates the raw input against the `@passshield/validation`
 *      `ipcInputSchemas` registry with `safeParse`; on failure it returns a
 *      safe `{ ok:false, error:{ code:'validation', message } }` result and
 *      never touches the vault, crypto, or database layers. (Req 11.2, 11.4)
 *   2. Dispatches to the {@link VaultService}, which owns locked-vault gating:
 *      secret operations return a `locked` error while the vault is locked and
 *      the router surfaces those results verbatim. (Req 2.5, 4.5, 11.5)
 *   3. Returns only what the view needs. List/search results carry non-secret
 *      metadata only; decrypted secret values are returned solely by
 *      `items:get`. (Req 11.5)
 *   4. Never throws raw internals to the renderer. Every handler is wrapped so
 *      an unexpected error is converted into a safe, non-secret `unknown`
 *      error shape. (Req 11.4)
 *
 * Channel naming scheme
 * ---------------------
 * Channels use `group:operation`, mirroring the dotted `PassShieldApi` surface
 * in the design ("Security Boundary and IPC Contract"). The preload script
 * (task 6.2) exposes `window.passShield.<group>.<operation>` by invoking the
 * matching `group:operation` channel. The canonical list lives in
 * {@link IpcChannels} below so preload and main share one source of truth.
 *
 * There is no generic passthrough channel; every operation is explicit. (Req 11.2)
 */

import { app, ipcMain } from 'electron';

import type {
  Category,
  CategoryWithCount,
  GeneratedPassword,
  ItemDetail,
  ItemSummary,
  Result,
  Settings,
  VaultStatus,
} from '@passshield/contracts';
import { generate, UnsatisfiableGeneratorOptionsError } from '@passshield/generator';
import { ipcInputSchemas } from '@passshield/validation';

import type { BackupService } from './backup-service.js';
import type { ClipboardService } from './clipboard-service.js';
import type { AutoLockManager } from './auto-lock-manager.js';
import type { SettingsStore } from './settings-store.js';
import type { VaultService } from './vault-service.js';

/**
 * Canonical IPC channel names, grouped to match the `PassShieldApi` surface.
 * Shared with the preload script (task 6.2) so the two never drift apart.
 */
export const IpcChannels = {
  app: {
    version: 'app:version',
  },
  vault: {
    exists: 'vault:exists',
    create: 'vault:create',
    unlock: 'vault:unlock',
    lock: 'vault:lock',
    status: 'vault:status',
    changeMasterPassword: 'vault:changeMasterPassword',
  },
  items: {
    list: 'items:list',
    get: 'items:get',
    save: 'items:save',
    trash: 'items:trash',
    restore: 'items:restore',
    delete: 'items:delete',
    search: 'items:search',
  },
  categories: {
    list: 'categories:list',
    save: 'categories:save',
    delete: 'categories:delete',
  },
  generator: {
    generate: 'generator:generate',
  },
  clipboard: {
    copySecret: 'clipboard:copySecret',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
  },
  backup: {
    export: 'backup:export',
    restore: 'backup:restore',
  },
  activity: {
    ping: 'activity:ping',
  },
} as const;

/**
 * A safe, non-secret error result. Mirrors the shape used by the
 * {@link VaultService} so results returned by the router are uniform. Never
 * carries raw internals or secret values. (Req 11.4)
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

/**
 * Convert a Zod `safeParse` failure into a safe, non-secret validation error.
 * The first issue's message is surfaced (it describes the shape problem, never
 * the submitted value). (Req 11.4)
 */
function validationError(
  error: { issues: ReadonlyArray<{ message: string }> },
): { ok: false; error: { code: 'validation'; message: string } } {
  const first = error.issues[0]?.message ?? 'The request was not in the expected format.';
  return { ok: false, error: { code: 'validation', message: first } };
}

/**
 * Register a request/response handler on `channel`.
 *
 * The wrapper guarantees the renderer never sees a raw thrown error: any
 * exception escaping `handler` is caught and returned as a safe `unknown`
 * error shape. Handlers that legitimately need to return non-`Result` values
 * (e.g. `items:list` returns a bare array) do so directly; the catch converts
 * unexpected failures for those into a safe empty projection is *not* assumed —
 * such handlers guard their own errors and this wrapper is the last line of
 * defence only. (Req 11.4)
 */
function handle(
  channel: string,
  handler: (...args: unknown[]) => unknown | Promise<unknown>,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch {
      // Never leak raw internals across the boundary. (Req 11.4)
      return fail('unknown', 'The operation could not be completed.');
    }
  });
}

/**
 * Wire every IPC channel to the {@link VaultService}. Call once, after the
 * service is constructed and before the renderer loads. Idempotent within a
 * process is not guaranteed by Electron (`ipcMain.handle` throws on a duplicate
 * channel), so this is expected to be called exactly once from `main.ts`.
 *
 * @param vault - the single main-process vault service instance.
 * @param clipboard - the main-process clipboard service used to route secret
 *   copies and manage the clipboard-clear timer. (Req 9.3, 9.4)
 * @param autoLock - optional Auto-Lock Manager whose inactivity timer is reset
 *   by renderer activity pings on the `activity:ping` channel. When omitted the
 *   ping channel is still registered but no-ops, so the preload surface stays
 *   stable regardless of wiring. (Req 3.1)
 * @param settings - optional Settings store backing the `settings:get` /
 *   `settings:update` channels. Settings are non-secret and persisted in the
 *   `settings` table so they apply across sessions; the store reads/writes them
 *   independent of vault lock state. When omitted those channels fall back to a
 *   safe not-implemented error, keeping the preload surface stable. (Req 3.4,
 *   9.4, 14.3)
 * @param backup - optional Backup Service backing the `backup:export` /
 *   `backup:restore` channels. Export writes an encrypted backup (vault
 *   protection preserved, no plaintext export) to a user-selected path; restore
 *   validates format/version and integrity and confirms the master password
 *   before atomically replacing the vault, failing safely on any invalid input
 *   without touching the existing vault. When omitted those channels fall back
 *   to a safe not-implemented error, keeping the preload surface stable. (Req
 *   10.1, 10.2, 10.3, 10.4, 10.5)
 */
export function registerIpcRouter(
  vault: VaultService,
  clipboard: ClipboardService,
  autoLock?: AutoLockManager,
  settings?: SettingsStore,
  backup?: BackupService,
): void {
  // -------------------------------------------------------------------------
  // app.*
  // -------------------------------------------------------------------------

  // No input; returns the running app version (non-secret) from Electron, which
  // reads it from the packaged app's package.json. Keeps UI surfaces like the
  // About pane aligned with the real build instead of a hard-coded constant.
  handle(IpcChannels.app.version, (): string => app.getVersion());

  // -------------------------------------------------------------------------
  // vault.*
  // -------------------------------------------------------------------------

  // No input to validate; returns a bare boolean per the contract.
  handle(IpcChannels.vault.exists, (): boolean => vault.exists());

  handle(IpcChannels.vault.create, async (rawInput: unknown): Promise<Result> => {
    const parsed = ipcInputSchemas.vault.create.safeParse(rawInput);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.create(parsed.data);
  });

  handle(IpcChannels.vault.unlock, async (rawPassword: unknown): Promise<Result> => {
    const parsed = ipcInputSchemas.vault.unlock.safeParse(rawPassword);
    if (!parsed.success) {
      // A malformed unlock request reveals nothing beyond a shape complaint.
      return validationError(parsed.error);
    }
    return vault.unlock(parsed.data);
  });

  // No input; fire-and-forget lock. Returns void per the contract.
  handle(IpcChannels.vault.lock, (): void => {
    vault.lock();
  });

  // No input; returns the current lock/status projection (non-secret).
  handle(IpcChannels.vault.status, (): VaultStatus => vault.status());

  handle(IpcChannels.vault.changeMasterPassword, async (rawInput: unknown): Promise<Result> => {
    const parsed = ipcInputSchemas.vault.changeMasterPassword.safeParse(rawInput);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.changeMasterPassword(parsed.data);
  });

  // -------------------------------------------------------------------------
  // items.*  (secret gating is enforced by the VaultService)
  // -------------------------------------------------------------------------

  // items:list carries optional filter + sort. Both are validated only when
  // present; absent arguments select the default (all items, title A–Z).
  // Returns a bare ItemSummary[] (metadata only, no secrets). On a locked
  // vault or validation failure it returns an empty list so the renderer's
  // list projection stays simple; the authoritative lock signal comes from
  // vault:status. (Req 6.4, 11.5, 17)
  handle(
    IpcChannels.items.list,
    (rawFilter: unknown, rawSort: unknown): ItemSummary[] => {
      let filter: ReturnType<typeof ipcInputSchemas.items.list.parse> | undefined;
      if (rawFilter !== undefined && rawFilter !== null) {
        const parsed = ipcInputSchemas.items.list.safeParse(rawFilter);
        if (!parsed.success) {
          return [];
        }
        filter = parsed.data;
      }

      let sort: ReturnType<typeof ipcInputSchemas.items.listSort.parse> | undefined;
      if (rawSort !== undefined && rawSort !== null) {
        const parsedSort = ipcInputSchemas.items.listSort.safeParse(rawSort);
        if (!parsedSort.success) {
          return [];
        }
        sort = parsedSort.data;
      }

      const result = vault.listItems(filter, sort);
      // Surface only the view-needed metadata; drop the envelope for the
      // bare-array contract, returning [] when locked.
      return result.ok ? result.value : [];
    },
  );

  // items:get is the ONLY channel that returns decrypted secret values, and
  // only for an explicit reveal of a single item. (Req 11.5)
  handle(IpcChannels.items.get, (rawId: unknown): Result<ItemDetail> => {
    const parsed = ipcInputSchemas.items.get.safeParse(rawId);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.getItem(parsed.data);
  });

  handle(IpcChannels.items.save, (rawItem: unknown): Result<ItemSummary> => {
    const parsed = ipcInputSchemas.items.save.safeParse(rawItem);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    // Returns a non-secret summary; the encrypted payload never round-trips
    // back to the renderer. (Req 4.2, 11.5)
    return vault.saveItem(parsed.data);
  });

  handle(IpcChannels.items.trash, (rawId: unknown): Result => {
    const parsed = ipcInputSchemas.items.trash.safeParse(rawId);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.trashItem(parsed.data);
  });

  handle(IpcChannels.items.restore, (rawId: unknown): Result => {
    const parsed = ipcInputSchemas.items.restore.safeParse(rawId);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.restoreItem(parsed.data);
  });

  handle(IpcChannels.items.delete, (rawId: unknown): Result => {
    const parsed = ipcInputSchemas.items.delete.safeParse(rawId);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.deleteItem(parsed.data);
  });

  // items:search returns a bare ItemSummary[] (metadata only, no secrets).
  // A malformed request or locked vault yields an empty list. (Req 6.1, 6.4, 11.5)
  handle(IpcChannels.items.search, (rawInput: unknown): ItemSummary[] => {
    const parsed = ipcInputSchemas.items.search.safeParse(rawInput);
    if (!parsed.success) {
      return [];
    }
    const result = vault.searchItems(parsed.data.query, parsed.data.sort);
    return result.ok ? result.value : [];
  });

  // -------------------------------------------------------------------------
  // categories.*  (secret gating is enforced by the VaultService)
  // -------------------------------------------------------------------------

  // No input; returns categories with counts (non-secret metadata), or an
  // empty list when the vault is locked. (Req 21.2)
  handle(IpcChannels.categories.list, (): CategoryWithCount[] => {
    const result = vault.listCategories();
    return result.ok ? result.value : [];
  });

  handle(IpcChannels.categories.save, (rawCategory: unknown): Result<Category> => {
    const parsed = ipcInputSchemas.categories.save.safeParse(rawCategory);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.saveCategory(parsed.data);
  });

  handle(IpcChannels.categories.delete, (rawId: unknown): Result => {
    const parsed = ipcInputSchemas.categories.delete.safeParse(rawId);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    return vault.deleteCategory(parsed.data);
  });

  // -------------------------------------------------------------------------
  // generator.*  (pure; no vault state required)
  // -------------------------------------------------------------------------

  // Dispatches to the pure @passshield/generator. Unsatisfiable option
  // combinations are converted to a safe validation error carrying the
  // generator's user-facing message. (Req 8.1, 8.2, 19.4)
  handle(IpcChannels.generator.generate, (rawOpts: unknown): Result<GeneratedPassword> => {
    const parsed = ipcInputSchemas.generator.generate.safeParse(rawOpts);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    try {
      return ok(generate(parsed.data));
    } catch (error) {
      if (error instanceof UnsatisfiableGeneratorOptionsError) {
        return fail('validation', error.message);
      }
      throw error; // caught by the handle() wrapper as a safe unknown error.
    }
  });

  // -------------------------------------------------------------------------
  // clipboard.* / settings.* / backup.*  (services not yet built)
  // -------------------------------------------------------------------------
  //
  // These channels are registered now so the preload surface (task 6.2) is
  // complete and stable. clipboard.copySecret, settings.*, and backup.* are now
  // backed by their services (tasks 13, 16.4, 17.1); each validates its input
  // where applicable and returns a safe error/value rather than throwing.

  // clipboard:copySecret returns void per the contract. Validate the input
  // shape, then route the copy through the main-process ClipboardService, which
  // writes the value to the OS clipboard and starts the configured clear timer.
  // On a malformed request we no-op. We never log or echo the value (it is a
  // secret). (Req 9.3, 9.4, 13.1)
  handle(IpcChannels.clipboard.copySecret, (rawValue: unknown): void => {
    const parsed = ipcInputSchemas.clipboard.copySecret.safeParse(rawValue);
    if (!parsed.success) {
      return;
    }
    clipboard.copySecret(parsed.data);
  });

  // settings:get returns the full Settings object per the contract, read from
  // the settings store and merged over defaults so missing keys fall back
  // rather than being absent. Settings are non-secret and persisted across
  // sessions. When no store is wired the handler throws a safe unknown error
  // via the wrapper (the renderer tolerates this with its own defaults) so we
  // never fabricate values that look persisted. (Req 3.4, 9.4, 14.3)
  handle(IpcChannels.settings.get, (): Settings => {
    if (settings === undefined) {
      throw new Error('settings store not wired');
    }
    return settings.get();
  });

  // settings:update validates the patch shape, then persists it through the
  // settings store and returns the fully merged Settings. A malformed patch is
  // rejected before any write. The store's change listener (wired in main.ts)
  // applies auto-lock / clipboard changes live. (Req 3.4, 9.4, 14.3)
  handle(IpcChannels.settings.update, (rawPatch: unknown): Settings => {
    if (settings === undefined) {
      throw new Error('settings store not wired');
    }
    const parsed = ipcInputSchemas.settings.update.safeParse(rawPatch);
    if (!parsed.success) {
      // The handle() wrapper only catches thrown errors; surface the shape
      // problem as a thrown error so the renderer falls back to its defaults
      // rather than silently persisting nothing. The Settings return type
      // precludes returning a validation Result envelope here.
      throw new Error(parsed.error.issues[0]?.message ?? 'invalid settings patch');
    }
    return settings.update(parsed.data);
  });

  // backup:export validates the destination path, then produces an encrypted
  // backup at that path via the Backup Service. The backup preserves vault
  // protection (payloads stay AEAD-encrypted) and never contains a plaintext
  // export. When no service is wired it falls back to a safe error so the
  // renderer degrades gracefully. (Req 10.1, 10.2, 10.5)
  handle(IpcChannels.backup.export, async (rawInput: unknown): Promise<Result> => {
    const parsed = ipcInputSchemas.backup.export.safeParse(rawInput);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    if (backup === undefined) {
      return fail('unknown', 'Backup export is not available yet.');
    }
    return backup.export(parsed.data.path);
  });

  // backup:restore validates the source path + password, then asks the Backup
  // Service to validate the backup's format, version, and integrity and confirm
  // the password before atomically replacing the vault. On any invalid/corrupt
  // input it fails safely and leaves the existing vault untouched; the router
  // surfaces the service's safe Result verbatim. (Req 10.3, 10.4)
  handle(IpcChannels.backup.restore, async (rawInput: unknown): Promise<Result> => {
    const parsed = ipcInputSchemas.backup.restore.safeParse(rawInput);
    if (!parsed.success) {
      return validationError(parsed.error);
    }
    if (backup === undefined) {
      return fail('unknown', 'Backup restore is not available yet.');
    }
    return backup.restore(parsed.data.path, parsed.data.password);
  });

  // -------------------------------------------------------------------------
  // activity.*  (auto-lock inactivity signalling)
  // -------------------------------------------------------------------------

  // activity:ping is a fire-and-forget, NON-SECRET signal from the renderer
  // that the user is active (throttled mouse/keyboard events). It carries no
  // payload and returns nothing; it simply resets the Auto-Lock Manager's
  // inactivity timer. When no manager is wired it no-ops so the preload surface
  // stays stable. We never log the ping. (Req 3.1)
  handle(IpcChannels.activity.ping, (): void => {
    autoLock?.ping();
  });
}
