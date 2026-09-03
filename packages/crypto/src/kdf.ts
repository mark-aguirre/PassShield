/**
 * KDF-based key derivation.
 *
 * Derives a vault key from the master password and a stored salt using a
 * pluggable KDF. Node's built-in scrypt is the sound default; parameters are
 * carried in {@link KdfParams} so the Vault Cryptography Specification can tune
 * or replace them without changing this surface. The derived key stays in
 * main-process memory only. (Req 12.1, 12.4, 11.5)
 */

import { randomBytes, scrypt, type ScryptOptions } from 'node:crypto';

import { DEFAULT_KDF_PARAMS, type KdfParams, type VaultKey } from './types.js';

/** Promise wrapper around the callback scrypt so options are typed correctly. */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/** Number of bytes of salt generated for a new vault. */
const SALT_BYTES = 16;

/**
 * scrypt requires `maxmem` to admit roughly `128 * N * r * p` bytes. Compute a
 * headroom-padded limit from the params so higher cost factors do not trip the
 * default 32 MiB ceiling.
 */
function scryptMaxMem(params: KdfParams): number {
  const required = 128 * params.cost * params.blockSize * params.parallelization;
  return Math.max(32 * 1024 * 1024, required * 2);
}

function assertScryptParams(params: KdfParams): void {
  if (params.algorithm !== 'scrypt') {
    throw new Error(`Unsupported KDF algorithm: ${params.algorithm}`);
  }
  const isPowerOfTwo = params.cost > 1 && (params.cost & (params.cost - 1)) === 0;
  if (!isPowerOfTwo) {
    throw new Error('KDF cost (scrypt N) must be a power of two greater than 1');
  }
  if (params.blockSize < 1 || params.parallelization < 1 || params.keyLength < 1) {
    throw new Error('KDF blockSize, parallelization, and keyLength must be positive');
  }
}

/**
 * Generate a fresh, cryptographically random salt for a new vault.
 */
export function generateSalt(): Buffer {
  return randomBytes(SALT_BYTES);
}

/**
 * Derive a vault key from the master password and stored salt.
 *
 * @param masterPassword The user's master password (never persisted).
 * @param salt The per-vault salt stored alongside the vault.
 * @param params Pluggable KDF parameters; defaults to {@link DEFAULT_KDF_PARAMS}.
 * @returns A {@link VaultKey} bound to the params used to derive it.
 */
export async function deriveKey(
  masterPassword: string,
  salt: Buffer,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<VaultKey> {
  assertScryptParams(params);

  const key = await scryptAsync(masterPassword.normalize('NFKC'), salt, params.keyLength, {
    N: params.cost,
    r: params.blockSize,
    p: params.parallelization,
    maxmem: scryptMaxMem(params),
  });

  return { key, params };
}
