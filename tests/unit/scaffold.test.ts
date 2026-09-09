import { describe, it, expect } from 'vitest';
import { CONTRACTS_PACKAGE_VERSION } from '@PassShield/contracts';
import { CRYPTO_PACKAGE_VERSION } from '@PassShield/crypto';
import { DATABASE_PACKAGE_VERSION } from '@PassShield/database';
import { VALIDATION_PACKAGE_VERSION } from '@PassShield/validation';

/**
 * Scaffold smoke test.
 *
 * Confirms the workspace resolves every shared package and that the unit
 * test runner is wired up. Replaced/extended by real suites in later tasks.
 */
describe('workspace scaffold', () => {
  it('resolves all shared packages', () => {
    expect(CONTRACTS_PACKAGE_VERSION).toBe('0.1.0');
    expect(CRYPTO_PACKAGE_VERSION).toBe('0.1.0');
    expect(DATABASE_PACKAGE_VERSION).toBe('0.1.0');
    expect(VALIDATION_PACKAGE_VERSION).toBe('0.1.0');
  });
});
