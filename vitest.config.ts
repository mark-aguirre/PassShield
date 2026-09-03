import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration for unit and integration tests.
 *
 * Unit and integration suites live under `tests/unit` and `tests/integration`
 * as well as co-located `*.test.ts` files inside packages. End-to-end tests
 * under `tests/e2e` are excluded here; they run under a separate harness.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
  },
});
