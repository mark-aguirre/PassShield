/**
 * Character-class definitions for the password generator.
 *
 * A "class" is one of the four selectable character groups (uppercase,
 * lowercase, numbers, symbols). Each class contributes a set of candidate
 * characters; the generator filters those candidates through the
 * exclude-similar / avoid-ambiguous options before drawing from them.
 *
 * Requirements: 8.2 (charset selection), 19.1 (exclude similar/ambiguous).
 */

/** The four selectable character classes. */
export type CharClass = 'upper' | 'lower' | 'numbers' | 'symbols';

/** Base candidate characters for each class, before any exclusions. */
export const BASE_CHARSETS: Record<CharClass, string> = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/',
};

/**
 * Characters that look alike and are easy to confuse when read (the set called
 * out by Req 19.1). Removed when `excludeSimilar` is enabled.
 */
export const SIMILAR_CHARS = new Set(['l', '1', 'I', '0', 'O', 'o']);

/**
 * Characters that are ambiguous in many contexts (shells, URLs, quoting).
 * Removed when `avoidAmbiguous` is enabled. These are drawn from the symbol
 * and bracket space where copy/paste and manual entry most often go wrong.
 */
export const AMBIGUOUS_CHARS = new Set([
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '/',
  '\\',
  "'",
  '"',
  '`',
  '~',
  ',',
  ';',
  ':',
  '.',
  '<',
  '>',
]);

/**
 * Build the effective candidate string for a class after applying the
 * exclude-similar and avoid-ambiguous options. May return an empty string if
 * every candidate for the class was excluded.
 */
export function effectiveCharset(
  cls: CharClass,
  options: { excludeSimilar: boolean; avoidAmbiguous: boolean },
): string {
  const chars = [...BASE_CHARSETS[cls]].filter((ch) => {
    if (options.excludeSimilar && SIMILAR_CHARS.has(ch)) {
      return false;
    }
    if (options.avoidAmbiguous && AMBIGUOUS_CHARS.has(ch)) {
      return false;
    }
    return true;
  });
  return chars.join('');
}
