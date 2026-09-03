/**
 * Structured, non-secret logger for the Electron main process.
 *
 * passShield deliberately logs only NON-SECRET operational events — vault
 * locked, vault unlocked, migration applied, and similar lifecycle markers.
 * It must never log master passwords, encryption keys, decrypted passwords,
 * secure-note contents, authentication tokens, or recovery secrets. (Req 13.1)
 *
 * Because callers pass an optional `meta` object alongside each message, a
 * future caller could accidentally hand this logger a record that contains a
 * secret field. To make that mistake safe by construction, every `meta`
 * object is passed through a recursive DENYLIST that redacts values whose key
 * names look like secrets before anything is written. The redaction walks
 * nested objects and arrays and replaces matched values with a fixed marker;
 * it never inspects or emits the original secret value. (Req 13.1, 13.2)
 *
 * The logger matches the minimal shape every main-process service already
 * expects — `{ info(message, meta?) }` — and VaultService, ClipboardService,
 * the Auto-Lock Manager, and the database migration runner all accept it as an
 * optional `logger` option. A single shared instance is constructed in
 * `main.ts` and injected into those services.
 *
 * Logging is best-effort and NEVER throws: a failure to serialize or write a
 * record must not disrupt a privileged operation such as unlock or lock.
 */

/**
 * The shape every main-process service expects for its optional `logger`
 * option. Kept structurally identical to the inline types declared on
 * VaultService, ClipboardService, AutoLockManager, and the database
 * MigrationLogger so a single instance satisfies all of them.
 */
export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

/** Marker substituted for any value whose key matches the secret denylist. */
export const REDACTED = '[redacted]';

/**
 * Case-insensitive substrings that mark a `meta` key as secret. A key is
 * redacted when its lower-cased name contains any of these fragments, which
 * covers common variants (e.g. `masterPassword`, `newPassword`,
 * `access_token`, `recoverySecret`) without needing an exact match per field.
 *
 * Covers the secret categories called out by Req 13.1: master passwords and
 * password fields, encryption/vault keys and verification material, decrypted
 * passwords, secure-note contents, authentication tokens, and recovery
 * secrets — plus the KDF salt as a reasonable precaution. (Req 13.1)
 */
export const DENYLIST_KEY_FRAGMENTS: readonly string[] = [
  // Master password and any password-like field (masterPassword, newPassword,
  // confirmPassword, password, passphrase).
  'password',
  'passphrase',
  // Encryption keys and vault key handles (key, vaultKey, encryptionKey).
  'key',
  // Verification material derived from the master password.
  'verifier',
  // KDF salt — not strictly secret, but redacted as a reasonable precaution.
  'salt',
  // Decrypted secret payloads and revealed passwords.
  'decrypted',
  'plaintext',
  // Secure-note contents (noteContent, content).
  'content',
  'note',
  // Authentication tokens (token, accessToken, refreshToken).
  'token',
  // Recovery secrets and any generic secret field (recoverySecret, secret).
  'secret',
  'recovery',
  // Generic credential bundles.
  'credential',
];

/** Whether a `meta` key name matches the secret denylist (case-insensitive). */
function isDeniedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return DENYLIST_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Recursively redact denylisted keys from a value.
 *
 * Objects are walked key by key: a key that matches the denylist has its value
 * replaced with {@link REDACTED} regardless of the value's type (so a nested
 * secret object is redacted wholesale rather than descended into); other keys
 * are recursed. Arrays are mapped element-wise. Primitives are returned as-is.
 *
 * A `seen` set guards against circular references so redaction can never loop
 * forever on a self-referential `meta` object.
 */
function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((element) => redactValue(element, seen));
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    result[key] = isDeniedKey(key) ? REDACTED : redactValue(source[key], seen);
  }
  return result;
}

/**
 * Produce a redacted shallow-independent copy of a `meta` object with every
 * denylisted key (at any depth) replaced by {@link REDACTED}. Returns
 * `undefined` when there is no metadata to log. (Req 13.1)
 */
export function redactMeta(
  meta?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (meta === undefined) {
    return undefined;
  }
  return redactValue(meta, new WeakSet<object>()) as Record<string, unknown>;
}

/** Log levels emitted by {@link createLogger}, ordered from least to most severe. */
type Level = 'info' | 'warn' | 'error';

/** The console sink used by a logger; defaults to the global `console`. */
export interface ConsoleLike {
  log: (line: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
}

/** Options for {@link createLogger}. */
export interface CreateLoggerOptions {
  /** Console sink; defaults to the global `console`. Injectable for testing. */
  readonly console?: ConsoleLike;
  /** Clock returning an ISO timestamp; defaults to `new Date().toISOString`. */
  readonly now?: () => string;
}

/**
 * Emit one structured JSON log line for a level, message, and redacted meta.
 *
 * The entire operation is wrapped so a serialization or sink failure can never
 * propagate to the caller — logging is strictly best-effort. (Req 13.1)
 */
function emit(
  sink: ConsoleLike,
  now: () => string,
  level: Level,
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    const record: Record<string, unknown> = {
      ts: now(),
      level,
      message,
    };
    const safeMeta = redactMeta(meta);
    if (safeMeta !== undefined) {
      record.meta = safeMeta;
    }

    const line = JSON.stringify(record);
    if (level === 'error') {
      sink.error(line);
    } else if (level === 'warn') {
      sink.warn(line);
    } else {
      sink.log(line);
    }
  } catch {
    // Logging must never throw or disrupt a privileged operation. Swallow any
    // serialization/sink error and, importantly, do not attempt to re-log the
    // offending payload (which could itself carry a secret). (Req 13.1)
  }
}

/**
 * Create a structured logger that writes one redacted JSON line per event.
 *
 * The returned logger satisfies the {@link Logger} shape and is safe to share
 * across VaultService, ClipboardService, AutoLockManager, and the database
 * migration runner. Every call redacts denylisted `meta` keys and never
 * throws. (Req 13.1, 13.2)
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const sink: ConsoleLike = options.console ?? {
    log: (line) => console.log(line),
    warn: (line) => console.warn(line),
    error: (line) => console.error(line),
  };
  const now = options.now ?? (() => new Date().toISOString());

  return {
    info: (message, meta) => emit(sink, now, 'info', message, meta),
    warn: (message, meta) => emit(sink, now, 'warn', message, meta),
    error: (message, meta) => emit(sink, now, 'error', message, meta),
  };
}
