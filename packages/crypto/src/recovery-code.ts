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

import { hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

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
