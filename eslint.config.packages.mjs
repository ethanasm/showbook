// Shared ESLint flat config for the workspace libraries under packages/*.
//
// The two apps own their own configs (apps/web/eslint.config.mjs uses
// eslint-config-next; apps/mobile/eslint.config.js uses eslint-config-expo).
// The packages had no lint config at all, so a tsc-clean library could still
// ship a console.* call, a sparse array, or an unnecessary regex escape. This
// config closes that gap.
//
// It is referenced EXPLICITLY by each package's `lint` script:
//   eslint --no-config-lookup -c ../../eslint.config.packages.mjs src
// The filename is intentionally NOT `eslint.config.*`, so ESLint never
// auto-discovers it — the app configs are unaffected.
//
// Scope: library source under packages/*/src. Test files are excluded — they
// are node:test modules with intentional `any`/console in mocks and sit
// outside the coverage gate; the typecheck target still covers them.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/__tests__/**', '**/*.test.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Enforce the @showbook/observability convention: package source logs
      // through the shared logger, never console.* (CLAUDE.md "Observability").
      'no-console': 'error',
      // Allow deliberately-unused `_`-prefixed args/vars/catch bindings.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
