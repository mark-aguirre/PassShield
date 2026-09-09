/**
 * Local password-strength estimation.
 *
 * Strength is computed entirely locally from the password's length and
 * character-class variety; the value is never transmitted. The label is
 * deliberately non-prescriptive and makes no claim about compliance with any
 * external or enterprise password policy. (Req 18.1, 18.2, 18.3)
 */

import type { PasswordStrength } from '@PassShield/contracts';

const LABELS: Record<PasswordStrength['score'], string> = {
  0: 'Very Weak',
  1: 'Weak',
  2: 'Fair',
  3: 'Strong',
  4: 'Very Strong',
};

/**
 * Estimate the strength of a password on a 0-4 scale using a lightweight
 * entropy heuristic: the size of the character space actually used times the
 * length gives an approximate bit count, which is bucketed into five bands.
 *
 * This is a local heuristic for user feedback, not a security guarantee.
 */
export function computeStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return { score: 0, label: LABELS[0] };
  }

  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;

  const bits = password.length * Math.log2(Math.max(poolSize, 1));

  let score: PasswordStrength['score'];
  if (bits < 28) {
    score = 0;
  } else if (bits < 40) {
    score = 1;
  } else if (bits < 60) {
    score = 2;
  } else if (bits < 80) {
    score = 3;
  } else {
    score = 4;
  }

  return { score, label: LABELS[score] };
}
