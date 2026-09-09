/**
 * Verification material create/verify.
 *
 * At vault creation a verifier tag is derived from the vault key and stored
 * with the salt and KDF params. On unlock, the same derivation is reproduced
 * from the entered master password and compared in constant time. This proves
 * the password without ever storing the password or the raw key. (Req 12.1,
 * 12.2)
 */

import { hkdfSync, timingSafeEqual } from 'node:crypto';

import { deriveKey } from './kdf.js';
import type { VaultKey, VerifierRecord } from './types.js';

/** Domain-separation label so the verifier tag is not the encryption key. */
const VERIFIER_INFO = Buffer.from('PassShield/vault-verifier/v1', 'utf8');

/**
 * Legacy domain-separation label used before the project-wide `passShield` →
 * `PassShield` rename (commit "rename"). Vaults created before that rename
 * stored a verifier tag derived from this lowercase label. `verify` still
 * accepts it so those vaults continue to unlock with the correct password;
 * only the info label differs — it is domain separation, not a secret, and the
 * derived key is identical either way. New verifiers always use
 * {@link VERIFIER_INFO}.
 */
const LEGACY_VERIFIER_INFO = Buffer.from('passShield/vault-verifier/v1', 'utf8');

/** Length of the derived verifier tag in bytes. */
const VERIFIER_TAG_BYTES = 32;

/**
 * Derive the verifier tag from a vault key. Uses HKDF with a fixed info label
 * so the tag is cryptographically separated from the key used for payload
 * encryption; the tag reveals nothing usable about the key.
 */
function deriveVerifierTag(key: VaultKey, info: Buffer = VERIFIER_INFO): Buffer {
  const derived = hkdfSync('sha256', key.key, Buffer.alloc(0), info, VERIFIER_TAG_BYTES);
  return Buffer.from(derived);
}

/**
 * Create verification material for a newly derived vault key.
 *
 * @param key The vault key derived at vault creation.
 * @param salt The salt used to derive `key`; stored so unlock can reproduce it.
 * @returns A {@link VerifierRecord} safe to persist alongside the vault.
 */
export function createVerifier(key: VaultKey, salt: Buffer): VerifierRecord {
  return {
    salt: salt.toString('base64'),
    params: key.params,
    verifier: deriveVerifierTag(key).toString('base64'),
  };
}

/**
 * Verify a master password against stored verification material.
 *
 * Re-derives the key from the entered password using the salt and KDF params
 * recorded in the verifier, recomputes the tag, and compares it to the stored
 * tag in constant time. Returns false on any mismatch without revealing why.
 * (Req 12.2)
 *
 * @param masterPassword The candidate master password.
 * @param verifier The stored verification material.
 * @returns True when the password reproduces the stored verifier tag.
 */
export async function verify(masterPassword: string, verifier: VerifierRecord): Promise<boolean> {
  const salt = Buffer.from(verifier.salt, 'base64');
  const key = await deriveKey(masterPassword, salt, verifier.params);
  const storedTag = Buffer.from(verifier.verifier, 'base64');

  if (storedTag.length !== VERIFIER_TAG_BYTES) {
    return false;
  }

  // Match against the current label first, then the pre-rename legacy label so
  // vaults created before the rename still unlock. Both branches run so timing
  // does not reveal which label matched. (Backward compatibility for the
  // `passShield` → `PassShield` verifier-label change.)
  const currentTag = deriveVerifierTag(key, VERIFIER_INFO);
  const legacyTag = deriveVerifierTag(key, LEGACY_VERIFIER_INFO);
  const currentMatch = timingSafeEqual(currentTag, storedTag);
  const legacyMatch = timingSafeEqual(legacyTag, storedTag);
  return currentMatch || legacyMatch;
}
