/**
 * Authenticated encryption/decryption (AEAD) wrappers for item payloads.
 *
 * These wrappers encrypt the secret fields of a vault item (see LoginPayload /
 * NotePayload) into an {@link EncryptedPayload} and decrypt them back. They use
 * AES-256-GCM: a random 96-bit IV per message and a 128-bit authentication tag
 * that binds the ciphertext and any optional AAD, so any tampering with the
 * stored record is detected on decrypt.
 *
 * The vault key is supplied by the caller and only ever exists in
 * main-process memory; it is never serialized, logged, or returned to the
 * renderer. (Req 11.5, 12.3)
 *
 * Concrete algorithm selection is governed by the Vault Cryptography
 * Specification; this module commits to the AEAD shape the design requires.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import type { AeadAlgorithm, EncryptedPayload, VaultKey } from './types.js';

/** The committed AEAD cipher for item payloads. */
const AEAD_ALGORITHM: AeadAlgorithm = 'aes-256-gcm';

/** AES-256 requires a 32-byte key. */
const KEY_LENGTH_BYTES = 32;

/** GCM standard nonce length: 96 bits. */
const IV_LENGTH_BYTES = 12;

/** GCM authentication tag length: 128 bits. */
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Encrypt an item payload with the vault key using AES-256-GCM.
 *
 * A fresh random IV is generated for every call, so encrypting the same
 * plaintext twice yields different ciphertext. The optional AAD is
 * authenticated (bound to the tag) but not encrypted; the same AAD must be
 * supplied to {@link decrypt}.
 *
 * @param key - The derived vault key (main-process memory only).
 * @param plaintext - The secret bytes to protect.
 * @param aad - Optional additional authenticated data to bind to the ciphertext.
 * @returns A base64-encoded {@link EncryptedPayload} safe to persist.
 * @throws If the key length is not 32 bytes.
 */
export function encrypt(
  key: VaultKey,
  plaintext: Buffer,
  aad?: Buffer,
): EncryptedPayload {
  assertKeyLength(key);

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(AEAD_ALGORITHM, key.key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  if (aad !== undefined) {
    cipher.setAAD(aad);
  }

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: AEAD_ALGORITHM,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

/**
 * Decrypt an {@link EncryptedPayload} with the vault key.
 *
 * Decryption verifies the authentication tag against the ciphertext and the
 * supplied AAD. If the ciphertext, IV, tag, or AAD have been tampered with, or
 * the wrong key is used, verification fails and this function throws rather
 * than returning corrupt plaintext. (Req 12.3)
 *
 * @param key - The derived vault key (main-process memory only).
 * @param payload - The stored encrypted payload.
 * @param aad - The same optional AAD supplied at encryption time.
 * @returns The decrypted plaintext bytes.
 * @throws If the key length is invalid, the algorithm is unsupported, or
 *   authentication fails (tampered or wrong-key input).
 */
export function decrypt(
  key: VaultKey,
  payload: EncryptedPayload,
  aad?: Buffer,
): Buffer {
  assertKeyLength(key);

  if (payload.algorithm !== AEAD_ALGORITHM) {
    throw new Error(`Unsupported AEAD algorithm: ${payload.algorithm}`);
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = createDecipheriv(AEAD_ALGORITHM, key.key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);

  if (aad !== undefined) {
    decipher.setAAD(aad);
  }

  // `final()` throws when the auth tag does not verify, which is how tampering
  // and wrong-key decryption are surfaced to the caller.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Guard that the vault key is the correct length for AES-256. Keeps the error
 * message free of any key material. (Req 13.1)
 */
function assertKeyLength(key: VaultKey): void {
  if (key.key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `Invalid vault key length: expected ${KEY_LENGTH_BYTES} bytes`,
    );
  }
}
