/**
 * Pure password generator.
 *
 * Given a set of {@link GeneratorOptions}, produces a password that honours the
 * selected character classes, the exclude-similar / avoid-ambiguous filters,
 * the ensure-every-type guarantee, and the minimum-count constraints for
 * numbers and symbols. Randomness comes from a CSPRNG. Calling the function
 * again yields a fresh value.
 *
 * Unsatisfiable option combinations (minimums that exceed the length, a length
 * too small to hold every required class, or no usable characters) are rejected
 * with a clear, user-facing error instead of producing an invalid password.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 19.1, 19.2, 19.3, 19.4.
 */

import type { GeneratorOptions } from '@passshield/contracts';

import { type CharClass, effectiveCharset } from './charsets.js';
import { randomChar, shuffle } from './random.js';

/**
 * Error thrown when the requested options cannot be satisfied. Carries a
 * human-readable, non-secret message suitable for surfacing directly in the UI.
 * (Req 19.4)
 */
export class UnsatisfiableGeneratorOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsatisfiableGeneratorOptionsError';
  }
}

/** Ordered list of the four selectable classes. */
const ALL_CLASSES: readonly CharClass[] = ['upper', 'lower', 'numbers', 'symbols'];

interface ResolvedClass {
  cls: CharClass;
  charset: string;
  /** Minimum number of characters this class must contribute. */
  min: number;
}

/**
 * Validate options and resolve the enabled classes into usable charsets and
 * per-class minimums. Throws {@link UnsatisfiableGeneratorOptionsError} when
 * the request cannot be fulfilled.
 */
function resolve(options: GeneratorOptions): ResolvedClass[] {
  const { length, ensureEveryType, minNumbers, minSymbols } = options;

  if (!Number.isInteger(length) || length <= 0) {
    throw new UnsatisfiableGeneratorOptionsError('Password length must be a positive whole number.');
  }
  if (minNumbers < 0 || minSymbols < 0 || !Number.isInteger(minNumbers) || !Number.isInteger(minSymbols)) {
    throw new UnsatisfiableGeneratorOptionsError('Minimum counts must be zero or a positive whole number.');
  }

  const enabled: Record<CharClass, boolean> = {
    upper: options.upper,
    lower: options.lower,
    numbers: options.numbers,
    symbols: options.symbols,
  };

  // A class-specific minimum implicitly requires that class to be enabled.
  if (minNumbers > 0 && !enabled.numbers) {
    throw new UnsatisfiableGeneratorOptionsError(
      'A minimum number of digits was requested, but the Numbers option is turned off.',
    );
  }
  if (minSymbols > 0 && !enabled.symbols) {
    throw new UnsatisfiableGeneratorOptionsError(
      'A minimum number of symbols was requested, but the Symbols option is turned off.',
    );
  }

  const resolved: ResolvedClass[] = [];
  for (const cls of ALL_CLASSES) {
    if (!enabled[cls]) {
      continue;
    }
    const charset = effectiveCharset(cls, options);
    if (charset.length === 0) {
      throw new UnsatisfiableGeneratorOptionsError(
        `The ${cls} option is enabled but every candidate character was excluded by the current filters.`,
      );
    }

    let min = 0;
    if (cls === 'numbers') min = Math.max(min, minNumbers);
    if (cls === 'symbols') min = Math.max(min, minSymbols);
    // Ensure-every-type requires at least one from each enabled class.
    if (ensureEveryType) min = Math.max(min, 1);

    resolved.push({ cls, charset, min });
  }

  if (resolved.length === 0) {
    throw new UnsatisfiableGeneratorOptionsError('Select at least one character type to generate a password.');
  }

  const requiredMinimum = resolved.reduce((sum, r) => sum + r.min, 0);
  if (requiredMinimum > length) {
    throw new UnsatisfiableGeneratorOptionsError(
      `The required minimums add up to ${requiredMinimum} characters, which is more than the password length of ${length}.`,
    );
  }

  return resolved;
}

/**
 * Generate a password from the given options.
 *
 * The algorithm first places the required characters (per-class minimums and
 * the every-type guarantee), then fills the remaining slots from the combined
 * pool of enabled characters, and finally shuffles so the guaranteed characters
 * are not clustered at the front.
 *
 * @throws {UnsatisfiableGeneratorOptionsError} when the options cannot be met.
 */
export function generatePassword(options: GeneratorOptions): string {
  const resolved = resolve(options);
  const combinedPool = resolved.map((r) => r.charset).join('');

  const chars: string[] = [];

  // 1. Satisfy each class's required minimum.
  for (const { charset, min } of resolved) {
    for (let i = 0; i < min; i += 1) {
      chars.push(randomChar(charset));
    }
  }

  // 2. Fill the rest from the combined pool of all enabled characters.
  while (chars.length < options.length) {
    chars.push(randomChar(combinedPool));
  }

  // 3. Shuffle so guaranteed characters are randomly positioned.
  return shuffle(chars).join('');
}
