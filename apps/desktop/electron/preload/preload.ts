import { contextBridge, ipcRenderer } from 'electron';

import type {
  Category,
  CategoryWithCount,
  ChangeMasterPasswordInput,
  CreateVaultInput,
  GeneratedPassword,
  GeneratorOptions,
  ItemDetail,
  ItemListFilter,
  ItemSort,
  ItemSummary,
  PassShieldApi,
  Result,
  SaveCategoryInput,
  SaveItemInput,
  Settings,
  VaultStatus,
} from '@PassShield/contracts';

/**
 * Preload script for PassShield.
 *
 * Runs in an isolated context and is the only bridge between the renderer and
 * the main process. It publishes exactly the narrow {@link PassShieldApi}
 * surface on `window.PassShield` via `contextBridge.exposeInMainWorld`. Every
 * operation is an explicit, typed method that forwards to a single named IPC
 * channel; there is no generic `send(channel, data)` passthrough and no
 * arbitrary channel is reachable from the renderer. (Req 11.1, 11.2, 11.4)
 *
 * Channel names
 * -------------
 * The strings below MUST match the `group:operation` channels registered by
 * the IPC router (`../main/ipc-router.ts`, task 6.1), whose canonical list is
 * its exported `IpcChannels` constant. They are mirrored here rather than
 * imported so the preload bundle does not pull the router's main-process-only
 * runtime dependencies (`ipcMain`, the generator/validation packages) into the
 * renderer-facing preload context. Keep these two lists in lockstep.
 */

/**
 * Canonical IPC channel names, mirrored from the router's `IpcChannels`
 * (`../main/ipc-router.ts`). Single source of truth lives in the router; this
 * copy exists only to avoid importing main-process runtime into preload.
 */
const CHANNELS = {
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
    // Main→renderer push channel: emitted by the main process when the vault
    // becomes locked (auto-lock timeout, manual lock, or exit). Delivered via
    // ipcRenderer.on, not invoke. Keep in sync with main.ts. (Req 2.4, 3.2)
    locked: 'vault:locked',
  },
  items: {
    list: 'items:list',
    get: 'items:get',
    save: 'items:save',
    trash: 'items:trash',
    restore: 'items:restore',
    delete: 'items:delete',
    search: 'items:search',
    listChildren: 'items:listChildren',
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
 * The narrow API surface exposed to the renderer. Typed as {@link PassShieldApi}
 * so it stays structurally in sync with the shared contract; each method is a
 * thin, explicit wrapper over `ipcRenderer.invoke` for one channel.
 */
const PassShieldApi: PassShieldApi = {
  app: {
    version: (): Promise<string> => ipcRenderer.invoke(CHANNELS.app.version),
  },

  vault: {
    exists: (): Promise<boolean> => ipcRenderer.invoke(CHANNELS.vault.exists),
    create: (input: CreateVaultInput): Promise<Result> =>
      ipcRenderer.invoke(CHANNELS.vault.create, input),
    unlock: (password: string): Promise<Result> =>
      ipcRenderer.invoke(CHANNELS.vault.unlock, password),
    lock: (): Promise<void> => ipcRenderer.invoke(CHANNELS.vault.lock),
    status: (): Promise<VaultStatus> => ipcRenderer.invoke(CHANNELS.vault.status),
    changeMasterPassword: (input: ChangeMasterPasswordInput): Promise<Result> =>
      ipcRenderer.invoke(CHANNELS.vault.changeMasterPassword, input),
    // Subscribe to main-process lock notifications. We wrap the raw IPC event
    // so the renderer never receives the Electron `IpcRendererEvent` (which
    // would leak `sender`/`ports`); the callback is invoked with no arguments.
    // Returns an unsubscribe function that detaches the listener. (Req 2.4, 3.2)
    onLocked: (callback: () => void): (() => void) => {
      const listener = (): void => callback();
      ipcRenderer.on(CHANNELS.vault.locked, listener);
      return () => {
        ipcRenderer.removeListener(CHANNELS.vault.locked, listener);
      };
    },
  },

  items: {
    list: (filter?: ItemListFilter, sort?: ItemSort): Promise<ItemSummary[]> =>
      ipcRenderer.invoke(CHANNELS.items.list, filter, sort),
    get: (id: string): Promise<Result<ItemDetail>> => ipcRenderer.invoke(CHANNELS.items.get, id),
    save: (item: SaveItemInput): Promise<Result<ItemSummary>> =>
      ipcRenderer.invoke(CHANNELS.items.save, item),
    trash: (id: string): Promise<Result> => ipcRenderer.invoke(CHANNELS.items.trash, id),
    restore: (id: string): Promise<Result> => ipcRenderer.invoke(CHANNELS.items.restore, id),
    delete: (id: string): Promise<Result> => ipcRenderer.invoke(CHANNELS.items.delete, id),
    search: (query: string, sort?: ItemSort): Promise<ItemSummary[]> =>
      ipcRenderer.invoke(CHANNELS.items.search, { query, sort }),
    listChildren: (parentId: string, sort?: ItemSort): Promise<ItemSummary[]> =>
      ipcRenderer.invoke(CHANNELS.items.listChildren, parentId, sort),
  },

  categories: {
    list: (): Promise<CategoryWithCount[]> => ipcRenderer.invoke(CHANNELS.categories.list),
    save: (category: SaveCategoryInput): Promise<Result<Category>> =>
      ipcRenderer.invoke(CHANNELS.categories.save, category),
    delete: (id: string): Promise<Result> => ipcRenderer.invoke(CHANNELS.categories.delete, id),
  },

  generator: {
    generate: (opts: GeneratorOptions): Promise<Result<GeneratedPassword>> =>
      ipcRenderer.invoke(CHANNELS.generator.generate, opts),
  },

  clipboard: {
    copySecret: (value: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.clipboard.copySecret, value),
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(CHANNELS.settings.get),
    update: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(CHANNELS.settings.update, patch),
  },

  backup: {
    export: (path: string): Promise<Result> => ipcRenderer.invoke(CHANNELS.backup.export, path),
    restore: (path: string, password: string): Promise<Result> =>
      ipcRenderer.invoke(CHANNELS.backup.restore, path, password),
  },

  activity: {
    // Fire-and-forget, non-secret activity ping. The renderer throttles these;
    // we invoke the handler channel and intentionally ignore the returned
    // promise so callers see a synchronous void per the contract. (Req 3.1)
    ping: (): void => {
      void ipcRenderer.invoke(CHANNELS.activity.ping);
    },
  },
};

// Publish exactly the PassShieldApi surface. No generic passthrough. (Req 11.1, 11.2)
contextBridge.exposeInMainWorld('PassShield', PassShieldApi);
