/**
 * Settings Store (Electron main process).
 *
 * Persists user-facing application settings in the `settings` table so they
 * apply across sessions. (Req 3.4, 9.4, 14.3)
 *
 * Settings are NON-SECRET (theme, auto-lock minutes, clipboard-clear seconds,
 * startup behaviour, ...). They therefore have a different security posture
 * from vault items: they can be read and written regardless of vault lock
 * state, and require no derived key. The vault database connection, however,
 * is owned by {@link VaultService} and only exists while the vault is unlocked.
 *
 * To decouple settings from the vault's lifecycle, this store opens its OWN
 * short-lived read/write connection to the same SQLite file per operation
 * (`openDatabase` + `closeDatabase`). Settings reads/writes are low-frequency
 * (a settings screen save, a one-time seed at startup), so a per-operation
 * connection keeps the design simple and avoids coupling to the vault's locked
 * state. The connection is opened with the same migration-aware `openDatabase`
 * used elsewhere, so the `settings` table exists by the time this store runs.
 *
 * The DB layer (`@PassShield/database`) stores string values only; this store
 * is where a typed {@link Settings} value is serialized to strings on write and
 * coerced back on read. On read, stored values are merged OVER
 * {@link DEFAULT_SETTINGS} so any key that was never persisted falls back to a
 * sensible default rather than being missing. (Req 14.3)
 */

import type { CloseBehavior, Settings, ThemePreference } from '@PassShield/contracts';
import {
  closeDatabase,
  getAllSettings,
  openDatabase,
  setSettings,
  type VaultDatabase,
} from '@PassShield/database';

/** The minimal logger shape this store accepts, matching the shared Logger. */
export interface SettingsStoreLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * A callback invoked after settings are persisted by {@link SettingsStore.update},
 * receiving the fully merged {@link Settings}. `main.ts` uses this to re-seed
 * main-process services (auto-lock timeout, clipboard-clear seconds) so a
 * settings change applies live, not only on next launch. (Req 3.4, 9.4)
 */
export type SettingsChangeListener = (settings: Settings) => void;

/**
 * Default settings applied when a key has never been persisted. Mirrors the
 * {@link Settings} contract shape exactly. Kept conservative and privacy-
 * friendly: a 15-minute auto-lock and a 45-second clipboard clear match the
 * main-process defaults used before the store landed. (Req 3.4, 9.4, 14.3)
 */
export const DEFAULT_SETTINGS: Settings = {
  // General / startup
  launchOnStartup: false,
  startMinimized: false,
  closeBehavior: 'minimizeToTray',
  // Appearance
  theme: 'system',
  accentColor: '#3b82f6',
  language: 'en',
  checkForUpdates: true,
  // Security — vault lock
  autoLockMinutes: 15,
  lockOnSystemLock: true,
  lockOnSleep: true,
  lockOnAppExit: true,
  requireMasterPasswordOnRestart: true,
  // Security — clipboard
  clipboardClearSeconds: 45,
  preventClipboardHistory: true,
};

/** Options for constructing a {@link SettingsStore}. */
export interface SettingsStoreOptions {
  /**
   * Filesystem path to the SQLite vault file. The store opens its own
   * short-lived connection to this path per operation; it must be the same
   * path VaultService uses so settings live in the one vault database.
   */
  readonly databasePath: string;
  /** Optional non-secret logger for operational events. (Req 13) */
  readonly logger?: SettingsStoreLogger;
  /**
   * Optional listener invoked with the merged settings after every successful
   * {@link SettingsStore.update}, so callers can apply changes live. Can also
   * be set later via {@link SettingsStore.setOnChange}.
   */
  readonly onChange?: SettingsChangeListener;
}

/** Serialize a boolean setting to its stored string form. */
function boolToString(value: boolean): string {
  return value ? 'true' : 'false';
}

/** Coerce a stored string back to a boolean, falling back on anything odd. */
function stringToBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value === 'true';
}

/** Coerce a stored string back to an integer, falling back on anything odd. */
function stringToInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Coerce a stored theme string, falling back to the default on anything odd. */
function stringToTheme(value: string | undefined, fallback: ThemePreference): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : fallback;
}

/** Coerce a stored close-behavior string, falling back on anything odd. */
function stringToCloseBehavior(
  value: string | undefined,
  fallback: CloseBehavior,
): CloseBehavior {
  return value === 'minimizeToTray' || value === 'quit' ? value : fallback;
}

/**
 * Merge a raw string map (as read from the DB) over {@link DEFAULT_SETTINGS},
 * coercing each value to its typed form. Any missing or malformed key falls
 * back to its default. (Req 14.3)
 */
function mergeStored(stored: Record<string, string>): Settings {
  return {
    launchOnStartup: stringToBool(stored.launchOnStartup, DEFAULT_SETTINGS.launchOnStartup),
    startMinimized: stringToBool(stored.startMinimized, DEFAULT_SETTINGS.startMinimized),
    closeBehavior: stringToCloseBehavior(stored.closeBehavior, DEFAULT_SETTINGS.closeBehavior),
    theme: stringToTheme(stored.theme, DEFAULT_SETTINGS.theme),
    accentColor: stored.accentColor ?? DEFAULT_SETTINGS.accentColor,
    language: stored.language ?? DEFAULT_SETTINGS.language,
    checkForUpdates: stringToBool(stored.checkForUpdates, DEFAULT_SETTINGS.checkForUpdates),
    autoLockMinutes: stringToInt(stored.autoLockMinutes, DEFAULT_SETTINGS.autoLockMinutes),
    lockOnSystemLock: stringToBool(stored.lockOnSystemLock, DEFAULT_SETTINGS.lockOnSystemLock),
    lockOnSleep: stringToBool(stored.lockOnSleep, DEFAULT_SETTINGS.lockOnSleep),
    lockOnAppExit: stringToBool(stored.lockOnAppExit, DEFAULT_SETTINGS.lockOnAppExit),
    requireMasterPasswordOnRestart: stringToBool(
      stored.requireMasterPasswordOnRestart,
      DEFAULT_SETTINGS.requireMasterPasswordOnRestart,
    ),
    clipboardClearSeconds: stringToInt(
      stored.clipboardClearSeconds,
      DEFAULT_SETTINGS.clipboardClearSeconds,
    ),
    preventClipboardHistory: stringToBool(
      stored.preventClipboardHistory,
      DEFAULT_SETTINGS.preventClipboardHistory,
    ),
  };
}

/** Serialize a settings patch to the DB's string key/value form. */
function serializePatch(patch: Partial<Settings>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof Settings, Settings[keyof Settings]]
  >) {
    if (value === undefined) {
      continue;
    }
    out[key] = typeof value === 'boolean' ? boolToString(value) : String(value);
  }
  return out;
}

/**
 * Reads and writes the persisted {@link Settings} via the `settings` table.
 * A single instance is held by the main process for the app's lifetime and
 * shared with the IPC router.
 */
export class SettingsStore {
  private readonly databasePath: string;
  private readonly logger?: SettingsStoreLogger;
  private onChange?: SettingsChangeListener;

  constructor(options: SettingsStoreOptions) {
    this.databasePath = options.databasePath;
    this.logger = options.logger;
    this.onChange = options.onChange;
  }

  /**
   * Register (or replace) the change listener invoked after {@link update}.
   * `main.ts` sets this so a settings change re-seeds the auto-lock and
   * clipboard services live. (Req 3.4, 9.4)
   */
  setOnChange(listener: SettingsChangeListener): void {
    this.onChange = listener;
  }

  /**
   * Read the persisted settings, merged over {@link DEFAULT_SETTINGS} so any
   * key that was never stored falls back to its default. (Req 14.3)
   */
  get(): Settings {
    return this.withConnection((db) => mergeStored(getAllSettings(db)));
  }

  /**
   * Persist a partial patch and return the fully merged settings. Each patched
   * key is serialized to a string and upserted atomically; the returned value
   * is re-read from storage so it reflects exactly what was persisted merged
   * over defaults. The change listener, when set, is invoked with the merged
   * result so callers can apply changes live. (Req 3.4, 9.4, 14.3)
   */
  update(patch: Partial<Settings>): Settings {
    const entries = serializePatch(patch);
    const merged = this.withConnection((db) => {
      if (Object.keys(entries).length > 0) {
        setSettings(db, entries);
      }
      return mergeStored(getAllSettings(db));
    });

    this.logger?.info('settings updated', { keys: Object.keys(entries) });
    this.onChange?.(merged);
    return merged;
  }

  /**
   * Open a short-lived read/write connection to the vault database, run the
   * given operation, and always close the connection afterward. Settings are
   * low-frequency, so a per-operation connection keeps the store independent of
   * the vault's locked state without holding a long-lived handle.
   */
  private withConnection<T>(operation: (db: VaultDatabase) => T): T {
    const db = openDatabase({ filename: this.databasePath, logger: this.logger });
    try {
      return operation(db);
    } finally {
      closeDatabase(db);
    }
  }
}
