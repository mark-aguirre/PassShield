/**
 * Emergency recovery code — generate, hash, and verify.
 *
 * An emergency recovery code is a high-entropy, human-transcribable token
 * that the user stores offline (printed or written down). If they forget their
 * master password they can present this code to the app to prove ownership of
 * the vault and set a new master password.
 *
 * Design principles
 * -----------------
 * - **Only the hash is persisted.** The raw code is returned from
 *   {@link generateRecoveryCode} exactly once and never stored by this module.
 *   The caller must display it to the user immediately; it cannot be recovered
 *   afterward.
 * - **The hash uses HKDF-SHA-256** over the raw code bytes with a domain-
 *   separation label, consistent with the verifier approach used for the
 *   master password. This keeps all cryptography on Node built-ins and avoids
 *   adding bcrypt/argon2 as a dependency for a one-shot, high-entropy secret
 *   (a 128-bit random code has no need for a slow KDF).
 * - **Constant-time comparison** via `timingSafeEqual` prevents timing
 *   side-channels on the hash comparison.
 * - **Formatted for legibility.** The 128-bit raw code is hex-encoded and
 *   split into five groups of six characters separated by dashes so users can
 *   transcribe it accurately, e.g. `ABCDEF-123456-GHIJKL-789012-MNOPQR`.
 *   Verification strips dashes and normalizes case before comparing.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of raw random bytes for the code — 128 bits of entropy. */
const CODE_BYTES = 16;

/** Domain-separation label distinguishing this hash from the vault verifier. */
const RECOVERY_INFO = Buffer.from('PassShield/recovery-code/v1', 'utf8');

/** Length of the derived hash tag in bytes. */
const HASH_TAG_BYTES = 32;

/** Number of hex characters per display group. */
const GROUP_SIZE = 6;

/** Separator used between display groups. */
const GROUP_SEPARATOR = '-';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derive a fixed-length tag from the raw code bytes using HKDF-SHA-256 with a
 * domain-separation label. The tag is what we store; the raw bytes are never
 * persisted.
 */
function deriveHash(rawCodeHex: string): Buffer {
  const ikm = Buffer.from(rawCodeHex.toUpperCase(), 'utf8');
  const derived = hkdfSync('sha256', ikm, Buffer.alloc(0), RECOVERY_INFO, HASH_TAG_BYTES);
  return Buffer.from(derived);
}

/**
 * Format 32 uppercase hex characters as five dash-separated groups of six,
 * e.g. `ABCDEF-123456-GHIJKL-789012-MNOPQR`.
 *
 * Note: 16 bytes → 32 hex chars, split as 6-6-6-6-8 to fill evenly.
 * We use groups of 6-6-6-6-8 for a 32-char string (5 groups with the last
 * being 8 chars). This keeps the total concise while remaining human-readable.
 */
function formatCode(hexUpperCase: string): string {
  const groups: string[] = [];
  let offset = 0;
  while (offset < hexUpperCase.length) {
    groups.push(hexUpperCase.slice(offset, offset + GROUP_SIZE));
    offset += GROUP_SIZE;
  }
  return groups.join(GROUP_SEPARATOR);
}

/**
 * Strip dashes and normalize to uppercase so users can enter the code with or
 * without separators and in any case.
 */
function normalizeCode(raw: string): string {
  return raw.replace(/-/g, '').toUpperCase().trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The result of generating a new emergency recovery code.
 *
 * `plainCode` is the formatted, human-readable code the user must record —
 * it is shown **once** and is never re-derivable. `codeHash` is the value to
 * persist in the vault row's `emergency_code_hash` column.
 */
export interface RecoveryCodeResult {
  /**
   * The raw recovery code, formatted for display and transcription, e.g.
   * `ABCDEF-123456-GHIJKL-789012-MNOPQR`. Show once; never store.
   */
  readonly plainCode: string;
  /**
   * The HKDF-SHA-256 tag of the raw code (base64). Store this in the
   * `emergency_code_hash` column of the vault row.
   */
  readonly codeHash: string;
}

/**
 * Generate a new emergency recovery code.
 *
 * Produces 128 bits of cryptographic randomness, formats it for human
 * transcription, and derives its hash. The caller is responsible for
 * displaying `plainCode` to the user and persisting `codeHash` in the vault
 * row. The raw code is not retained internally.
 *
 * @returns A {@link RecoveryCodeResult} containing the display code and its
 *   hash for storage.
 */
export function generateRecoveryCode(): RecoveryCodeResult {
  const rawBytes = randomBytes(CODE_BYTES);
  const hexUpper = rawBytes.toString('hex').toUpperCase();
  const plainCode = formatCode(hexUpper);
  const codeHash = deriveHash(hexUpper).toString('base64');
  return { plainCode, codeHash };
}

/**
 * Hash a candidate recovery code for storage or comparison.
 *
 * Normalizes the input (strips dashes, uppercases), then runs the same
 * HKDF derivation as {@link generateRecoveryCode}. Use this to compute the
 * hash before a constant-time comparison or before persisting a regenerated
 * kit.
 *
 * @param candidateCode - The raw code string as entered by the user (dashes
 *   and mixed case are accepted).
 * @returns The HKDF-SHA-256 tag as a base64 string.
 */
export function hashRecoveryCode(candidateCode: string): string {
  return deriveHash(normalizeCode(candidateCode)).toString('base64');
}

/**
 * Verify a candidate recovery code against a stored hash in constant time.
 *
 * Returns `true` only when the candidate, after normalization, produces the
 * same HKDF tag as the stored hash. Uses `timingSafeEqual` to prevent timing
 * side-channels.
 *
 * @param candidateCode - The code the user entered.
 * @param storedHash - The base64 hash stored in `emergency_code_hash`.
 * @returns `true` when the code is valid; `false` otherwise.
 */
export function verifyRecoveryCode(candidateCode: string, storedHash: string): boolean {
  try {
    const candidateHash = Buffer.from(hashRecoveryCode(candidateCode), 'base64');
    const stored = Buffer.from(storedHash, 'base64');
    if (candidateHash.length !== stored.length) {
      return false;
    }
    return timingSafeEqual(candidateHash, stored);
  } catch {
    // Any decoding or derivation error is treated as a non-match.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Recovery-code key escrow (wrapped vault key)
// ---------------------------------------------------------------------------
//
// The recovery-code hash above only *authenticates* a code — it cannot recover
// the vault key, because a hash is one-way. To make locked-vault recovery
// actually work, the emergency kit also stores the vault key *wrapped* under a
// key derived from the recovery code. The recovery code is the only input, so
// a locked-out user (who lacks the master password) can still unwrap the vault
// key, decrypt existing items, and re-encrypt them under a new password.
//
// Design:
//   - A wrapping key is derived from the normalized recovery code with scrypt
//     over a per-kit random salt. scrypt (not raw HKDF) is used here because,
//     unlike the authentication hash, this key protects the vault key at rest,
//     so a slow KDF adds defense in depth even though the code has 128 bits of
//     entropy.
//   - The 32-byte vault key is sealed with AES-256-GCM (a fresh random IV per
//     wrap) so any tampering with the stored blob is detected on unwrap.
//   - The salt, IV, tag, and ciphertext are packed into one self-describing
//     JSON blob (all base64) stored in the vault row's
//     `emergency_wrapped_key` column. Nothing here reveals the master password.

/** scrypt cost params for deriving the recovery-code wrapping key. */
const WRAP_KDF = { N: 32768, r: 8, p: 1 } as const;

/** Salt length (bytes) for the wrapping-key derivation. */
const WRAP_SALT_BYTES = 16;

/** AES-256 key length (bytes) for wrapping. */
const WRAP_KEY_BYTES = 32;

/** GCM nonce length (bytes). */
const WRAP_IV_BYTES = 12;

/** GCM authentication tag length (bytes). */
const WRAP_AUTH_TAG_BYTES = 16;

/** AEAD cipher used to seal the vault key under the recovery-code key. */
const WRAP_ALGORITHM = 'aes-256-gcm';

/** scrypt `maxmem` headroom so higher cost factors do not trip the default. */
const WRAP_MAXMEM = Math.max(32 * 1024 * 1024, 128 * WRAP_KDF.N * WRAP_KDF.r * WRAP_KDF.p * 2);

/**
 * A wrapped (encrypted) copy of the vault key, sealed under a key derived from
 * the recovery code. Persisted as JSON in `vault.emergency_wrapped_key`. All
 * binary fields are base64. `v` is a format version for forward compatibility.
 */
export interface WrappedVaultKey {
  /** Blob format version. */
  readonly v: 1;
  /** scrypt salt (base64) for deriving the wrapping key from the code. */
  readonly salt: string;
  /** GCM IV / nonce (base64). */
  readonly iv: string;
  /** GCM authentication tag (base64). */
  readonly authTag: string;
  /** Wrapped vault-key bytes (base64). */
  readonly ciphertext: string;
}

/**
 * Derive the 32-byte wrapping key from the (normalized) recovery code and a
 * salt using scrypt. Deterministic for a given code + salt, so the same code
 * later reproduces the key needed to unwrap.
 */
function deriveWrappingKey(recoveryCode: string, salt: Buffer): Buffer {
  const normalized = Buffer.from(normalizeCode(recoveryCode), 'utf8');
  return scryptSync(normalized, salt, WRAP_KEY_BYTES, {
    N: WRAP_KDF.N,
    r: WRAP_KDF.r,
    p: WRAP_KDF.p,
    maxmem: WRAP_MAXMEM,
  });
}

/**
 * Wrap (encrypt) the raw vault key under a key derived from the recovery code.
 *
 * Called at emergency-kit generation time, while the vault is unlocked and the
 * raw key is available. The returned blob is safe to persist; it can only be
 * unwrapped with the matching recovery code.
 *
 * @param recoveryCode - The raw recovery code (dashes/case are normalized).
 * @param vaultKey - The 32-byte raw vault key to seal.
 * @returns A {@link WrappedVaultKey} to store in `emergency_wrapped_key`.
 * @throws If `vaultKey` is not 32 bytes.
 */
export function wrapVaultKey(recoveryCode: string, vaultKey: Buffer): WrappedVaultKey {
  if (vaultKey.length !== WRAP_KEY_BYTES) {
    throw new Error(`Invalid vault key length: expected ${WRAP_KEY_BYTES} bytes`);
  }
  const salt = randomBytes(WRAP_SALT_BYTES);
  const wrappingKey = deriveWrappingKey(recoveryCode, salt);
  const iv = randomBytes(WRAP_IV_BYTES);
  const cipher = createCipheriv(WRAP_ALGORITHM, wrappingKey, iv, {
    authTagLength: WRAP_AUTH_TAG_BYTES,
  });
  const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  wrappingKey.fill(0);
  return {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Unwrap (decrypt) the vault key from a stored blob using the recovery code.
 *
 * Called during locked-vault recovery: the code is the only input, so a user
 * who has forgotten their master password can still recover the raw key. GCM
 * verification means a wrong code or a tampered blob throws rather than
 * returning a bad key.
 *
 * @param recoveryCode - The raw recovery code entered by the user.
 * @param wrapped - The stored {@link WrappedVaultKey}.
 * @returns The raw 32-byte vault key.
 * @throws If the code is wrong, the blob is tampered/corrupt, or unsupported.
 */
export function unwrapVaultKey(recoveryCode: string, wrapped: WrappedVaultKey): Buffer {
  if (wrapped.v !== 1) {
    throw new Error(`Unsupported wrapped-key version: ${String(wrapped.v)}`);
  }
  const salt = Buffer.from(wrapped.salt, 'base64');
  const iv = Buffer.from(wrapped.iv, 'base64');
  const authTag = Buffer.from(wrapped.authTag, 'base64');
  const ciphertext = Buffer.from(wrapped.ciphertext, 'base64');
  const wrappingKey = deriveWrappingKey(recoveryCode, salt);
  const decipher = createDecipheriv(WRAP_ALGORITHM, wrappingKey, iv, {
    authTagLength: WRAP_AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);
  try {
    // `final()` throws when the tag does not verify (wrong code or tampering).
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } finally {
    wrappingKey.fill(0);
  }
}
