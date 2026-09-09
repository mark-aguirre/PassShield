import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),

  // -------------------------------------------------------------------------
  // Security boundary: window.passShield must ONLY be referenced in
  // src/lib/api.ts. All other renderer code must go through `api.*` from that
  // module. This rule catches accidental direct window.passShield calls at lint
  // time so the abstraction boundary doesn't erode silently.
  // -------------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/api.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name='window'][property.name='passShield']",
          message:
            "Direct access to window.passShield is forbidden outside src/lib/api.ts. " +
            "Import `api` from '@/lib/api' instead.",
        },
      ],
    },
  },
];

export default config;
