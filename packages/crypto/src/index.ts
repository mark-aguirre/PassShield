/**
 * @PassShield/crypto
 *
 * KDF-based key derivation, verification-material, and AEAD encrypt/decrypt
 * wrappers for the vault.
 *
 * This package commits to the shape the design requires: KDF-based
 * verification with pluggable KDF params, AEAD-based item encryption, and a
 * derived key held only in main-process memory. Concrete algorithm/parameter
 * choices are governed by the Vault Cryptography Specification; Node's built-in
 * scrypt and AES-256-GCM are the sound defaults.
 * (Req 12.1, 12.2, 12.3, 12.4, 11.5)
 */

export {
  DEFAULT_KDF_PARAMS,
  type AeadAlgorithm,
  type EncryptedPayload,
  type KdfAlgorithm,
  type KdfParams,
  type VaultKey,
  type VerifierRecord,
} from './types.js';

export { deriveKey, generateSalt } from './kdf.js';

export { createVerifier, verify } from './verifier.js';

export { decrypt, encrypt } from './aead.js';

/** Marker for the crypto package version surface. */
export const CRYPTO_PACKAGE_VERSION = '0.1.0';
