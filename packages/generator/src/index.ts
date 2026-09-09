/**
 * @PassShield/generator
 *
 * A pure, environment-agnostic password generator shared by the renderer
 * (live preview) and any main-process needs. It uses the Web Crypto CSPRNG so
 * it runs unchanged in both the browser and Node.js, and it never touches the
 * database, filesystem, or keys.
 *
 * Design reference: "Password Generator" (pure function in a shared package).
 * Requirements: 8.1, 8.2, 8.3, 8.4, 18.1, 18.2, 18.3, 19.1, 19.2, 19.3, 19.4.
 */

import type { GeneratedPassword, GeneratorOptions } from '@PassShield/contracts';

import { generatePassword } from './generator.js';
import { computeStrength } from './strength.js';

export { generatePassword, UnsatisfiableGeneratorOptionsError } from './generator.js';
export { computeStrength } from './strength.js';
export {
  BASE_CHARSETS,
  SIMILAR_CHARS,
  AMBIGUOUS_CHARS,
  effectiveCharset,
  type CharClass,
} from './charsets.js';
export { randomInt, randomChar, shuffle } from './random.js';

/**
 * Generate a password and its locally-computed strength in one call, returning
 * the {@link GeneratedPassword} shape used across the IPC contract. Each call
 * draws fresh randomness, so repeated calls yield different values. (Req 8.1, 8.4, 18.1)
 *
 * @throws {UnsatisfiableGeneratorOptionsError} when the options cannot be met.
 */
export function generate(options: GeneratorOptions): GeneratedPassword {
  const value = generatePassword(options);
  return { value, strength: computeStrength(value) };
}

/** Marker for the generator package version surface. */
export const GENERATOR_PACKAGE_VERSION = '0.1.0';
