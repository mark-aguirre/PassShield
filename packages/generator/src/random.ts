/**
 * Cryptographically secure random primitives.
 *
 * The generator is a pure function used by both the Next.js renderer and any
 * main-process code, so it must not depend on `node:crypto` directly. Instead
 * it draws from the Web Crypto API (`crypto.getRandomValues`), which is
 * available as a global in modern browsers and in Node.js 20+. This keeps the
 * package environment-agnostic while still using a CSPRNG. (Req 8, 19)
 */

/**
 * The Web Crypto surface this module relies on. Typed structurally rather than
 * against the DOM `Crypto` lib type so the package needs no DOM lib and stays
 * usable in both the renderer and Node.js.
 */
interface WebCryptoLike {
  getRandomValues<T extends Uint32Array>(array: T): T;
}

/** Resolve the Web Crypto instance for the current environment. */
function getWebCrypto(): WebCryptoLike {
  const c = (globalThis as { crypto?: Partial<WebCryptoLike> }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('A Web Crypto implementation with getRandomValues is required.');
  }
  return c as WebCryptoLike;
}

/**
 * Return a uniformly distributed random integer in the half-open range
 * [0, max). Uses rejection sampling over 32-bit random words to avoid the
 * modulo bias that a naive `random % max` would introduce.
 *
 * @param max Exclusive upper bound; must be a positive integer.
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error('randomInt requires a positive integer bound.');
  }

  const crypto = getWebCrypto();
  const buffer = new Uint32Array(1);
  // Largest multiple of `max` that fits in the 32-bit space. Values at or above
  // this limit are rejected so every residue class is equally likely.
  const limit = Math.floor(0x1_0000_0000 / max) * max;

  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);

  return value % max;
}

/** Pick a uniformly random character from a non-empty string. */
export function randomChar(chars: string): string {
  if (chars.length === 0) {
    throw new Error('randomChar requires a non-empty character set.');
  }
  return chars[randomInt(chars.length)]!;
}

/**
 * Fisher-Yates shuffle using the CSPRNG. Returns a new array; the input is not
 * mutated. Used to place the guaranteed characters at random positions so the
 * every-type / minimum guarantees do not leak positional structure.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
