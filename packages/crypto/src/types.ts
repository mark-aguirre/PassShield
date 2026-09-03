/**
 * Shared crypto types for the vault key-derivation and verification surface.
 *
 * Concrete algorithm and parameter choices are governed by the Vault
 * Cryptography Specification. This module commits only to the shape the
 * design requires: KDF-based verification with pluggable KDF params and a
 * key that never leaves the main process. (Req 12.1, 12.2, 12.4)
 */

/**
 * Identifier for the key-derivation function in use. Pluggable so the
 * Vault Cryptography Specification can select or evolve the KDF without
 * changing the CryptoService shape.
 */
export type KdfAlgorithm = 'scrypt';

/**
 * Pluggable key-derivation parameters. Stored alongside the vault (with the
 * salt) so a derived key can be reproduced on unlock and so parameters can be
 * upgraded over time without breaking existing vaults.
 */
export interface KdfParams {
  /** The key-derivation function to use. */
  readonly algorithm: KdfAlgorithm;
  /** CPU/memory cost factor (scrypt `N`). Must be a power of two. */
  readonly cost: number;
  /** Block size (scrypt `r`). */
  readonly blockSize: number;
  /** Parallelization factor (scrypt `p`). */
  readonly parallelization: number;
  /** Derived key length in bytes. */
  readonly keyLength: number;
}

/**
 * A derived vault key held only in main-process memory. The raw key material
 * is never serialized, logged, or handed to the renderer. (Req 11.5, 12.4)
 */
export interface VaultKey {
  /** Raw derived key bytes. */
  readonly key: Buffer;
  /** The KDF params used to derive this key, for reproducibility. */
  readonly params: KdfParams;
}

/**
 * Verification material persisted with the vault. It lets the system confirm a
 * master password on unlock without storing the password or the raw key.
 * (Req 12.1, 12.2)
 */
export interface VerifierRecord {
  /** Salt (base64) used for key derivation; needed to re-derive the key. */
  readonly salt: string;
  /** KDF params used to derive the key that produced this verifier. */
  readonly params: KdfParams;
  /** Verifier tag (base64) derived from the key; compared in constant time. */
  readonly verifier: string;
}

/**
 * Identifier for the authenticated-encryption cipher used for item payloads.
 * Pluggable so the Vault Cryptography Specification can select or evolve the
 * cipher without changing the CryptoService shape.
 */
export type AeadAlgorithm = 'aes-256-gcm';

/**
 * An authenticated-encryption payload safe to persist in the database. All
 * binary fields are base64-encoded. The auth tag binds the ciphertext (and any
 * AAD) so tampering is detected on decrypt. (Req 12.3)
 */
export interface EncryptedPayload {
  /** The AEAD cipher used. */
  readonly algorithm: AeadAlgorithm;
  /** Per-message initialization vector / nonce (base64). */
  readonly iv: string;
  /** Authentication tag (base64). */
  readonly authTag: string;
  /** Ciphertext (base64). */
  readonly ciphertext: string;
}

/**
 * Sensible default KDF parameters used when a vault does not specify its own.
 * scrypt with N=2^15 balances resistance and interactive-unlock latency; the
 * Vault Cryptography Specification may override these.
 */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: 'scrypt',
  cost: 32768,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32,
};
