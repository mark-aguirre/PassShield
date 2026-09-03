/**
 * Backup Service (Electron main process).
 *
 * Produces and restores encrypted local backups of the vault. Because cloud
 * sync is out of scope for V1, this is the user's recovery path: an encrypted
 * backup that preserves vault protection and a restore that validates format,
 * version, and integrity before touching the live vault, failing safely on any
 * corrupt or invalid input. (Req 10.1, 10.2, 10.3, 10.4, 10.5)
 *
 * Backup format (V1)
 * ------------------
 * The vault SQLite database already stores every secret field as AEAD
 * ciphertext in `vault_item.encrypted_payload`, and the `vault` row carries the
 * KDF salt + verification material. So a backup of the database file *is* an
 * encrypted backup: the payloads stay encrypted and no plaintext credential
 * export is produced. (Req 10.1, 10.2)
 *
 * The V1 backup file is therefore the raw database bytes wrapped in a small,
 * versioned envelope:
 *
 *   line 1: a single JSON header line, then `\n`
 *   rest  : the database bytes, base64-encoded
 *
 * The header carries a magic/format identifier, a format version, an
 * encryption-format version (the vault's `encryption_version`), a SHA-256
 * checksum of the raw database bytes, and the encoded body length. The header
 * lets restore reject anything that is not a passShield backup or is a version
 * it does not understand; the checksum lets it reject a corrupted body before
 * applying it. No secrets appear in the header. (Req 10.3, 10.4)
 *
 * Fail-safe restore
 * -----------------
 * Restore never mutates the live vault until every check has passed:
 *   1. Read + parse the envelope; reject on a bad magic/version/shape.
 *   2. Decode the body and verify its SHA-256 matches the header checksum.
 *   3. Write the decoded database bytes to a temp file and open it to read the
 *      backup's stored verifier, then confirm the supplied master password
 *      unlocks the backup via `@passshield/crypto` `verify`.
 *   4. Only then close any live DB handle (via the injected `onBeforeRestore`
 *      hook, which locks the vault) and atomically replace the live database
 *      file (write to a temp file next to it, then rename over it).
 * Any failure before step 4 returns a safe error and leaves the existing vault
 * completely untouched. (Req 10.3, 10.4)
 *
 * This service never logs secrets: it logs only non-secret operational events
 * (backup exported, backup restored) through the injected logger. (Req 13.1)
 */

import { createHash, randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { verify as cryptoVerify, type VerifierRecord } from '@passshield/crypto';
import {
  closeDatabase,
  openDatabase,
  type VaultDatabase,
} from '@passshield/database';

import type { Result } from '@passshield/contracts';

/**
 * Magic identifier written into every backup header. Restore rejects any file
 * whose header does not carry this exact value, so a random or foreign file is
 * never mistaken for a passShield backup. (Req 10.3)
 */
const BACKUP_MAGIC = 'passShield-backup';

/**
 * Current backup envelope format version. Restore accepts only versions it
 * understands and rejects anything newer/unknown, so a future format cannot be
 * half-applied by an older build. (Req 10.3)
 */
const BACKUP_FORMAT_VERSION = 1;

/** Checksum algorithm used for the integrity check over the raw DB bytes. */
const CHECKSUM_ALGORITHM = 'sha256';

/** The single vault row id used by this local, single-vault application. */
const VAULT_ROW_ID = 'vault';

/**
 * The non-secret header written as the first line of a backup file. All fields
 * are metadata; none carry key material or plaintext secrets. (Req 10.2, 13.1)
 */
interface BackupHeader {
  /** Format identifier; must equal {@link BACKUP_MAGIC}. */
  readonly magic: string;
  /** Envelope format version; must be a supported {@link BACKUP_FORMAT_VERSION}. */
  readonly formatVersion: number;
  /** The vault's `encryption_version`, recorded for compatibility checks. */
  readonly encryptionVersion: number;
  /** Checksum algorithm (currently always sha256). */
  readonly checksumAlgorithm: string;
  /** Hex SHA-256 of the raw (pre-base64) database bytes. (Req 10.3) */
  readonly checksum: string;
  /** Length in bytes of the base64-encoded body, for a quick shape check. */
  readonly bodyLength: number;
  /** ISO 8601 creation timestamp (non-secret). */
  readonly createdAt: string;
}

/** The minimal logger shape this service accepts, matching the shared Logger. */
export interface BackupServiceLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * A minimal async filesystem surface, injected so the service is testable
 * without touching the real disk. Mirrors the subset of `node:fs/promises`
 * used here.
 */
export interface BackupFileSystem {
  readFile(filePath: string): Promise<Buffer>;
  writeFile(filePath: string, data: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(filePath: string, options?: { force?: boolean }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
}

/** Options for constructing a {@link BackupService}. */
export interface BackupServiceOptions {
  /** Absolute path to the live vault SQLite file (e.g. `<userData>/vault.sqlite`). */
  readonly databasePath: string;
  /** Optional non-secret logger for operational events. (Req 13) */
  readonly logger?: BackupServiceLogger;
  /**
   * Hook invoked immediately before the live database file is replaced during a
   * successful restore. The main entry wires this to `vaultService.lock()` so
   * the vault service drops its key and, crucially, closes its open handle to
   * the database file before it is overwritten. Restore requires the vault be
   * locked (no open write handle) so the file can be atomically replaced. After
   * restore the vault stays locked and the user must unlock again. (Req 2.4)
   */
  readonly onBeforeRestore?: () => void;
  /**
   * Password verifier from `@passshield/crypto`, injected for testability.
   * Defaults to the real `verify`.
   */
  readonly verify?: (password: string, verifier: VerifierRecord) => Promise<boolean>;
  /**
   * Filesystem surface, injected for testability. Defaults to
   * `node:fs/promises`.
   */
  readonly fs?: BackupFileSystem;
  /**
   * Opens a vault database at the given path (runs migrations, reads no
   * secrets). Injected for testability; defaults to `@passshield/database`
   * `openDatabase`. Used to read the backup's stored verifier from a temp file.
   */
  readonly openDatabase?: (filename: string) => VaultDatabase;
}

/**
 * A safe, non-secret error result mirroring the shape used across the IPC
 * boundary. Never carries raw internals or secret values. (Req 11.4)
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

/** Compute the hex checksum of a buffer with the configured algorithm. */
function checksumOf(data: Buffer): string {
  return createHash(CHECKSUM_ALGORITHM).update(data).digest('hex');
}

/**
 * Reads and restores encrypted vault backups. A single instance is held by the
 * main process for the app's lifetime and shared with the IPC router.
 */
export class BackupService {
  private readonly databasePath: string;
  private readonly logger?: BackupServiceLogger;
  private readonly onBeforeRestore?: () => void;
  private readonly verify: (password: string, verifier: VerifierRecord) => Promise<boolean>;
  private readonly fs: BackupFileSystem;
  private readonly openDatabase: (filename: string) => VaultDatabase;

  constructor(options: BackupServiceOptions) {
    this.databasePath = options.databasePath;
    this.logger = options.logger;
    this.onBeforeRestore = options.onBeforeRestore;
    this.verify = options.verify ?? cryptoVerify;
    this.fs = options.fs ?? defaultFileSystem();
    this.openDatabase =
      options.openDatabase ?? ((filename: string) => openDatabase({ filename }));
  }

  /**
   * Export an encrypted backup to `destinationPath`.
   *
   * Reads a consistent snapshot of the vault database, wraps it in the
   * versioned envelope (JSON header line + base64 body) with a SHA-256 checksum
   * of the raw bytes, and writes it to the user-selected path. The database
   * bytes carry the vault's AEAD ciphertext and verifier as-is, so vault
   * protection is preserved and no plaintext export is produced. (Req 10.1,
   * 10.2, 10.5)
   */
  async export(destinationPath: string): Promise<Result> {
    // Fold any WAL contents into the main database file and read its
    // `encryption_version` in one short-lived connection, so the bytes we copy
    // are a complete, self-contained snapshot even if the vault is unlocked and
    // has pending WAL writes. This connection reads no secrets. (Req 10.1)
    let encryptionVersion: number;
    try {
      encryptionVersion = this.checkpointAndReadVersion();
    } catch {
      // No vault database exists yet, or it could not be opened.
      return fail('not_found', 'There is no vault to back up.');
    }

    let dbBytes: Buffer;
    try {
      dbBytes = await this.fs.readFile(this.databasePath);
    } catch {
      // No database file yet, or it could not be read.
      return fail('not_found', 'There is no vault to back up.');
    }

    if (dbBytes.length === 0) {
      return fail('not_found', 'There is no vault to back up.');
    }

    const body = dbBytes.toString('base64');
    const header: BackupHeader = {
      magic: BACKUP_MAGIC,
      formatVersion: BACKUP_FORMAT_VERSION,
      encryptionVersion,
      checksumAlgorithm: CHECKSUM_ALGORITHM,
      checksum: checksumOf(dbBytes),
      bodyLength: body.length,
      createdAt: new Date().toISOString(),
    };

    const file = Buffer.from(`${JSON.stringify(header)}\n${body}`, 'utf8');
    try {
      await this.fs.writeFile(destinationPath, file);
    } catch {
      return fail('io', 'The backup could not be written to the selected location.');
    }

    // Non-secret event only. (Req 13.1)
    this.logger?.info('backup exported');
    return ok(undefined);
  }

  /**
   * Restore the vault from an encrypted backup at `sourcePath`, protected by
   * `password`.
   *
   * Validates the envelope (magic + supported version), verifies the body's
   * integrity against the header checksum, and confirms the supplied master
   * password unlocks the backup — all before touching the live vault. Only when
   * every check passes does it lock the live vault (closing its DB handle) and
   * atomically replace the database file. Any earlier failure returns a safe
   * error and leaves the existing vault untouched. (Req 10.3, 10.4)
   */
  async restore(sourcePath: string, password: string): Promise<Result> {
    // --- Read the backup file (never touches the live vault). ---
    let raw: Buffer;
    try {
      raw = await this.fs.readFile(sourcePath);
    } catch {
      return fail('not_found', 'The backup file could not be read.');
    }

    // --- Parse + validate the envelope. ---
    const parsed = parseEnvelope(raw);
    if (parsed === null) {
      return fail('validation', 'The selected file is not a valid passShield backup.');
    }
    const { header, dbBytes } = parsed;

    if (header.magic !== BACKUP_MAGIC) {
      return fail('validation', 'The selected file is not a valid passShield backup.');
    }
    if (header.formatVersion !== BACKUP_FORMAT_VERSION) {
      return fail(
        'validation',
        'This backup was made with an unsupported version and cannot be restored.',
      );
    }

    // --- Integrity: the body must match the header checksum. (Req 10.3) ---
    if (
      header.checksumAlgorithm !== CHECKSUM_ALGORITHM ||
      checksumOf(dbBytes) !== header.checksum
    ) {
      return fail('validation', 'The backup is corrupted and cannot be restored.');
    }

    // --- Auth: the master password must unlock the backup. This proves the
    // backup is a real, compatible vault AND that the user can open it, before
    // we ever consider replacing the live vault. (Req 10.3) ---
    let tempDir: string | null = null;
    let backupOk = false;
    try {
      tempDir = await this.fs.mkdtemp(path.join(os.tmpdir(), 'passshield-restore-'));
      const backupDbPath = path.join(tempDir, 'backup.sqlite');
      await this.fs.writeFile(backupDbPath, dbBytes);

      const verifier = this.readVerifierFromDb(backupDbPath);
      if (verifier === null) {
        return fail('validation', 'The backup does not contain a valid vault.');
      }

      const unlocks = await this.verify(password, verifier);
      if (!unlocks) {
        // Wrong password (or a tampered verifier): reveal nothing specific.
        return fail('auth', 'The password does not match this backup.');
      }
      backupOk = true;
    } catch {
      return fail('io', 'The backup could not be validated.');
    } finally {
      if (tempDir !== null) {
        // Best-effort cleanup of the temp validation copy.
        await this.fs.rm(tempDir, { force: true }).catch(() => undefined);
      }
    }

    if (!backupOk) {
      // Defensive: never proceed unless validation explicitly succeeded.
      return fail('unknown', 'The backup could not be restored.');
    }

    // --- Apply: everything validated. Lock the live vault (closing its DB
    // handle) then atomically replace the database file. Up to this point the
    // live vault has not been touched. (Req 10.4) ---
    try {
      this.onBeforeRestore?.();
    } catch {
      // A failing lock hook must not leave us in a half-applied state; abort
      // before writing anything to the live path.
      return fail('io', 'The vault could not be prepared for restore.');
    }

    const stagingPath = `${this.databasePath}.restore-${randomUUID()}`;
    try {
      await this.fs.writeFile(stagingPath, dbBytes);
      await this.fs.rename(stagingPath, this.databasePath);
    } catch {
      // Clean up the staging file so a failed restore leaves no debris; the
      // live vault file was not renamed over on a write failure, so it is
      // still intact. (Req 10.4)
      await this.fs.rm(stagingPath, { force: true }).catch(() => undefined);
      return fail('io', 'The backup could not be applied. Your existing vault is unchanged.');
    }

    // Non-secret event only. The vault is now locked and must be unlocked with
    // the backup's master password. (Req 13.1, 2.4)
    this.logger?.info('backup restored');
    return ok(undefined);
  }

  /**
   * Open the live vault database, checkpoint the WAL into the main file so the
   * on-disk bytes are a complete snapshot, and read the vault's
   * `encryption_version`. Throws when no vault row exists so `export` can report
   * that there is nothing to back up. Reads no secrets.
   */
  private checkpointAndReadVersion(): number {
    const db = this.openDatabase(this.databasePath);
    try {
      // Fold WAL contents into the main .sqlite file so a plain byte copy is a
      // consistent snapshot. TRUNCATE also resets the WAL file afterward.
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // If checkpointing is unsupported (e.g. a non-WAL/in-memory test DB),
        // fall through; the main file is already the source of truth.
      }
      const row = db
        .prepare(/* sql */ `SELECT encryption_version FROM vault WHERE id = @id`)
        .get({ id: VAULT_ROW_ID }) as { encryption_version: number } | undefined;
      if (row === undefined) {
        throw new Error('no vault');
      }
      return row.encryption_version;
    } finally {
      closeDatabase(db);
    }
  }

  /**
   * Open the database at `dbPath` and read + parse the stored verifier from the
   * single vault row. Returns null when the row or verifier is absent or
   * unparseable. Reads no secrets beyond the (non-secret) verification material.
   */
  private readVerifierFromDb(dbPath: string): VerifierRecord | null {
    const db = this.openDatabase(dbPath);
    try {
      const row = db
        .prepare(/* sql */ `SELECT verifier FROM vault WHERE id = @id`)
        .get({ id: VAULT_ROW_ID }) as { verifier: string } | undefined;
      if (row === undefined) {
        return null;
      }
      return JSON.parse(row.verifier) as VerifierRecord;
    } catch {
      return null;
    } finally {
      try {
        closeDatabase(db);
      } catch {
        // Ignore close errors; the handle is being discarded regardless.
      }
    }
  }
}

/**
 * Parse a backup file buffer into its header and decoded database bytes.
 * Returns null when the file is not a well-formed envelope (missing header
 * line, unparseable JSON, missing/mistyped fields, or an undecodable body).
 * Performs no integrity or auth checks — the caller does those. (Req 10.3)
 */
function parseEnvelope(raw: Buffer): { header: BackupHeader; dbBytes: Buffer } | null {
  const text = raw.toString('utf8');
  const newlineIndex = text.indexOf('\n');
  if (newlineIndex <= 0) {
    return null;
  }

  const headerLine = text.slice(0, newlineIndex);
  const body = text.slice(newlineIndex + 1);

  let headerUnknown: unknown;
  try {
    headerUnknown = JSON.parse(headerLine);
  } catch {
    return null;
  }
  if (!isBackupHeader(headerUnknown)) {
    return null;
  }

  let dbBytes: Buffer;
  try {
    dbBytes = Buffer.from(body, 'base64');
  } catch {
    return null;
  }
  if (dbBytes.length === 0) {
    return null;
  }

  return { header: headerUnknown, dbBytes };
}

/** Structural type guard for a parsed backup header. */
function isBackupHeader(value: unknown): value is BackupHeader {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.magic === 'string' &&
    typeof v.formatVersion === 'number' &&
    typeof v.encryptionVersion === 'number' &&
    typeof v.checksumAlgorithm === 'string' &&
    typeof v.checksum === 'string' &&
    typeof v.bodyLength === 'number' &&
    typeof v.createdAt === 'string'
  );
}

/** Adapt `node:fs/promises` to the {@link BackupFileSystem} surface. */
function defaultFileSystem(): BackupFileSystem {
  return {
    readFile: (filePath) => nodeFs.readFile(filePath),
    writeFile: (filePath, data) => nodeFs.writeFile(filePath, data),
    rename: (from, to) => nodeFs.rename(from, to),
    rm: (filePath, options) => nodeFs.rm(filePath, { force: options?.force ?? false }),
    mkdtemp: (prefix) => nodeFs.mkdtemp(prefix),
  };
}
