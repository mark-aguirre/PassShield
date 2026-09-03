import { app, BrowserWindow, clipboard, shell } from 'electron';
import * as path from 'node:path';

import { AutoLockManager } from './auto-lock-manager.js';
import { BackupService } from './backup-service.js';
import { ClipboardService } from './clipboard-service.js';
import { registerIpcRouter } from './ipc-router.js';
import { createLogger, type Logger } from './logger.js';
import { SettingsStore } from './settings-store.js';
import { VaultService } from './vault-service.js';

/**
 * Electron main entry for passShield.
 *
 * Establishes the hard security boundary required by the design: the
 * renderer runs with context isolation on, Node integration off, and the
 * sandbox enabled, so a compromised renderer cannot reach SQLite, the
 * filesystem, encryption keys, or raw Node APIs. All privileged work is
 * performed here in the main process and reached only through the narrow
 * IPC surface exposed by the preload script. (Req 11.1, 11.3, 11.5)
 */

/** True when running under `electron .` without a packaged build. */
const isDev = !app.isPackaged;

/**
 * Development renderer URL. The Next.js dev server serves the renderer here
 * during `npm run dev:renderer`.
 */
const DEV_RENDERER_URL = process.env.PASSSHIELD_RENDERER_URL ?? 'http://localhost:3000';

/**
 * Path to the statically exported renderer used in production builds.
 * The Next.js renderer is exported to `renderer/out` and its entry is
 * `index.html`.
 */
const PROD_RENDERER_INDEX = path.join(__dirname, '..', '..', 'renderer', 'out', 'index.html');

/** Path to the compiled preload script. */
const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'preload.js');

/**
 * Path to the application window icon (PNG). The source lives in the
 * electron-builder buildResources dir (`build/icon.png`). From the compiled
 * main at `dist/main/main.js` that resolves to `<app>/build/icon.png` in both
 * unpacked (dev) and packaged runs, since `build/**` is shipped via the
 * packaging `files` list. Electron ignores a missing icon path gracefully.
 */
const WINDOW_ICON_PATH = path.join(__dirname, '..', '..', 'build', 'icon.png');

/**
 * Filename of the local SQLite vault stored under the per-user application
 * data directory (`app.getPath('userData')`). (Req 1.4, 15.3)
 */
const VAULT_DB_FILENAME = 'vault.sqlite';

/**
 * Fallback auto-lock inactivity timeout in minutes, used only for the vault
 * status projection when the Auto-Lock Manager has not yet been constructed.
 * The Auto-Lock Manager itself is now seeded from the persisted
 * `autoLockMinutes` setting on startup and re-seeded live when the setting
 * changes, so the timeout applies across sessions. (Req 3.4)
 */
const DEFAULT_AUTO_LOCK_MINUTES = 15;

let mainWindow: BrowserWindow | null = null;

/**
 * The single shared, non-secret logger for the main process. It writes
 * structured JSON lines for operational events (vault locked/unlocked,
 * migration applied, clipboard cleared) and redacts any secret `meta` fields
 * through its denylist, so secrets can never reach log output. It is injected
 * into VaultService (which forwards it to the database migration runner),
 * ClipboardService, and the Auto-Lock Manager. (Req 13.1, 13.2)
 */
const logger: Logger = createLogger();

/**
 * The single main-process vault service. Constructed at startup with the
 * per-user vault database path and owned by the IPC router; it holds the
 * derived key in main-process memory only. (Req 11.5)
 */
let vaultService: VaultService | null = null;

/**
 * The single main-process clipboard service. Routes secret copies through the
 * main process and manages the clipboard-clear timer. It is cleared on vault
 * lock via the vault service's `onLock` hook so a copied secret never lingers
 * after the vault is secured. (Req 9.3, 9.4, 9.5)
 */
let clipboardService: ClipboardService | null = null;

/**
 * The single main-process Auto-Lock Manager. Holds the inactivity timer and,
 * on timeout, locks the vault (which drops the derived key and cached secrets
 * where practical). It is reset by throttled, non-secret activity pings routed
 * from the renderer over the `activity:ping` IPC channel, and its configured
 * timeout is surfaced through the vault status projection. (Req 3.1, 3.2, 3.3)
 */
let autoLockManager: AutoLockManager | null = null;

/**
 * The single main-process Settings Store. Persists non-secret user settings in
 * the `settings` table (same SQLite file as the vault) so they apply across
 * sessions, independent of vault lock state. On startup its values seed the
 * Auto-Lock Manager's timeout and the Clipboard Service's clear interval, and a
 * change listener re-applies those live whenever settings are updated. (Req
 * 3.4, 9.4, 14.3)
 */
let settingsStore: SettingsStore | null = null;

/**
 * The single main-process Backup Service. Produces encrypted backups (a
 * versioned envelope around the encrypted vault database, so vault protection
 * is preserved and no plaintext is exported) and restores them fail-safely:
 * it validates format/version and integrity and confirms the master password
 * before atomically replacing the vault, and locks the vault first (via
 * `onBeforeRestore`) so no open database handle blocks the file replacement.
 * On any invalid/corrupt input the existing vault is left untouched. (Req 10.1,
 * 10.2, 10.3, 10.4, 10.5)
 */
let backupService: BackupService | null = null;

/**
 * Create the main application window with the required security flags and
 * load the renderer (dev server in development, static export in
 * production).
 */
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#1a1a1a',
    icon: WINDOW_ICON_PATH,
    webPreferences: {
      // Hard security boundary between renderer and main. (Req 11.3)
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_PATH,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in the user's browser, never in-app. (Req 11.1)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_RENDERER_URL);
  } else {
    void mainWindow.loadFile(PROD_RENDERER_INDEX);
  }
}

// Enforce a single application instance.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    // The per-user vault database path is shared by the vault service (which
    // owns it while unlocked) and the settings store (which opens its own
    // short-lived connection for non-secret settings, independent of lock
    // state). (Req 1.4, 15.3)
    const databasePath = path.join(app.getPath('userData'), VAULT_DB_FILENAME);

    // Construct the clipboard service first so the vault's lock hook can clear
    // any copied secret the moment the vault locks. (Req 9.3, 9.4, 9.5)
    clipboardService = new ClipboardService({ clipboard, logger });

    // Construct the settings store against the same database file. Settings are
    // non-secret and persisted across sessions, so the store reads/writes them
    // without needing the vault unlocked. We read the persisted settings once
    // now to seed the services below. (Req 3.4, 9.4, 14.3)
    settingsStore = new SettingsStore({ databasePath, logger });
    const persistedSettings = settingsStore.get();

    // Apply the persisted clipboard-clear interval so copies made this session
    // honour the user's saved preference. (Req 9.4)
    clipboardService.setClearSeconds(persistedSettings.clipboardClearSeconds);

    // Construct the vault service against the per-user vault database and wire
    // the narrow IPC surface before the renderer loads, so every renderer
    // request is validated and dispatched in the main process. On lock the
    // vault invokes the clipboard clear so secrets do not linger. (Req 11.2,
    // 11.5, 9.5)
    vaultService = new VaultService({
      databasePath,
      logger,
      onLock: () => {
        // Stop the inactivity timer so a stale timer cannot fire against an
        // already-locked vault, then clear the clipboard. (Req 3.2, 9.5)
        autoLockManager?.stop();
        clipboardService?.clearNow();
      },
      // (Re)start the inactivity timer the moment the vault unlocks so the
      // countdown is anchored to unlock rather than app launch. (Req 3.1, 3.2)
      onUnlock: () => autoLockManager?.start(),
      // Surface the configured auto-lock timeout through vault status so the
      // sidebar countdown reflects the value actually in effect. (Req 2.6, 3.4)
      autoLockMinutesProvider: () =>
        autoLockManager?.getTimeoutMinutes() ?? DEFAULT_AUTO_LOCK_MINUTES,
    });

    // Construct the Auto-Lock Manager with a lock callback wired to the vault.
    // On timeout it calls VaultService.lock(), which drops the key and cached
    // secrets and (via the vault's onLock hook) clears the clipboard. The
    // timeout is seeded from the persisted `autoLockMinutes` setting so it
    // applies across sessions, and is reset by renderer activity pings. (Req
    // 3.1, 3.2, 3.3, 3.4)
    autoLockManager = new AutoLockManager({
      timeoutMinutes: persistedSettings.autoLockMinutes,
      onLock: () => vaultService?.lock(),
      logger,
    });

    // Re-apply auto-lock and clipboard settings live whenever they change, so a
    // settings save takes effect immediately rather than only on next launch.
    // (Req 3.4, 9.4)
    settingsStore.setOnChange((next) => {
      autoLockManager?.setTimeoutMinutes(next.autoLockMinutes);
      clipboardService?.setClearSeconds(next.clipboardClearSeconds);
    });

    // Construct the Backup Service against the same per-user vault database.
    // Export wraps the encrypted database in a versioned backup envelope (no
    // plaintext export); restore validates format/version + integrity and
    // confirms the master password before atomically replacing the vault. Its
    // onBeforeRestore hook locks the vault so the vault service closes its DB
    // handle before the file is replaced, and the vault stays locked after a
    // restore until the user unlocks with the backup's password. (Req 10.1,
    // 10.2, 10.3, 10.4, 10.5, 2.4)
    backupService = new BackupService({
      databasePath,
      logger,
      onBeforeRestore: () => vaultService?.lock(),
    });

    registerIpcRouter(
      vaultService,
      clipboardService,
      autoLockManager,
      settingsStore,
      backupService,
    );

    // The inactivity timer is now driven by vault lock/unlock transitions
    // rather than app-ready: VaultService's onUnlock hook starts (anchors) it
    // at the moment of unlock, renderer activity pings reset it while the app
    // is in use, and its onLock hook (plus app exit) stops it so a stale timer
    // cannot fire against a locked vault. Starting it here would count down
    // against a still-locked vault and never re-anchor on unlock. (Req 3.1, 3.2)

    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  // Lock the vault on exit so the derived key and cached secrets are dropped
  // where practical. (Req 2.4, 3.3)
  app.on('before-quit', () => {
    // Stop the inactivity timer before locking so it cannot fire during exit.
    autoLockManager?.stop();
    vaultService?.lock();
  });

  app.on('window-all-closed', () => {
    // On non-macOS platforms, quit when all windows are closed.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
