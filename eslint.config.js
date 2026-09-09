import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

/**
 * The architecture is enforced here, not in code review.
 *
 * Each layer gets an explicit list of imports it may not reach for. A violation is a
 * lint error, so an inward-pointing dependency graph is a property of the build rather
 * than a property of everyone remembering CLAUDE.md.
 */

const DOMAIN_FORBIDDEN = [
  {
    group: [
      '**/application/**',
      '**/infrastructure/**',
      '**/interface/**',
      '**/main/**',
      '**/web/**',
    ],
    message:
      'src/domain is pure and may not depend on an outer layer. Model the need as a port in src/application/ports/ instead.',
  },
  {
    group: [
      'express*',
      'better-sqlite3',
      'sharp',
      'multer',
      'archiver',
      'helmet',
      'bcrypt',
      'pino*',
      'zod',
      'react',
      'react-*',
      'fs',
      'path',
      'crypto',
      'node:*',
    ],
    message:
      'src/domain must have no I/O and no framework dependency. Time and randomness arrive as parameters; everything else belongs behind a port.',
  },
]

const APPLICATION_FORBIDDEN = [
  {
    group: ['**/infrastructure/**', '**/interface/**', '**/main/**', '**/web/**'],
    message:
      'src/application depends on ports, never on an adapter or on the HTTP layer. Inject the port; wire it in src/main/container.ts.',
  },
  {
    group: [
      'express*',
      'better-sqlite3',
      'sharp',
      'multer',
      'archiver',
      'helmet',
      'bcrypt',
      'pino*',
      'react',
      'react-*',
      'fs',
      'path',
      'node:*',
    ],
    message:
      'src/application must not touch I/O directly. Define a port in src/application/ports/ and implement it in src/infrastructure/.',
  },
]

/** `Date.now()`, `new Date()` and `Math.random()` make a test flaky by construction. */
const NO_AMBIENT_NONDETERMINISM = [
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      'Ambient time is banned in domain and application code. Take a Date parameter, or inject the Clock port.',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message:
      'Ambient time is banned in domain and application code. Take a Date parameter, or inject the Clock port.',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      'Ambient randomness is banned. Inject the IdGenerator port so ids are deterministic in tests.',
  },
]

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'playwright-report',
      'test-results',
      'data',
      'photos',
      'thumbnails',
      'media',
    ],
  },

  /* ---------------------------------------------------------------- server -- */
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      'prefer-const': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // One module reads the environment, validates it once, and exports a typed
          // object. Everything else takes configuration as a parameter.
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            'process.env is read only by src/infrastructure/config/env.ts. Take the value as configuration instead.',
        },
      ],
    },
  },

  /* ---------------------------------------------------------------- domain -- */
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: DOMAIN_FORBIDDEN }],
      'no-restricted-syntax': ['error', ...NO_AMBIENT_NONDETERMINISM],
    },
  },

  /* ----------------------------------------------------------- application -- */
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: APPLICATION_FORBIDDEN }],
      'no-restricted-syntax': ['error', ...NO_AMBIENT_NONDETERMINISM],
    },
  },

  /* -------------------------------------------------------- infrastructure -- */
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/interface/**', '**/main/**', '**/web/**'],
              message:
                'An adapter implements a port. It must not know about HTTP or about the composition root.',
            },
          ],
        },
      ],
    },
  },

  /* --------------------------------------------------------------- config -- */
  {
    files: ['src/infrastructure/config/env.ts'],
    rules: {
      // This is the one module allowed to read the environment.
      'no-restricted-syntax': 'off',
    },
  },

  /* ------------------------------------------------------------ interface -- */
  {
    files: ['src/interface/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/infrastructure/**', '**/main/**', '**/web/**'],
              message:
                'The HTTP layer receives its dependencies from src/main/container.ts. Import the port type, never the adapter.',
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------ main -- */
  {
    files: ['src/main/**/*.ts'],
    rules: {
      // The composition root is the one place that constructs adapters, and the one
      // place a startup banner on stdout is the right thing to do.
      'no-console': 'off',
    },
  },

  /* ------------------------------------------------------------------ web -- */
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/src/domain/**', '**/src/application/**', '**/src/infrastructure/**', '**/src/interface/**', '**/src/main/**'],
              message:
                'The web app talks to the server over HTTP only. Its types come from web/src/lib/api/, so the wire format stays an explicit contract.',
            },
          ],
        },
      ],
    },
  },

  /* --------------------------------------------------- tests: relax a little -- */
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts', '**/testing/**/*.{ts,tsx}'],
    rules: {
      // A fake repository legitimately stores mutable state and needs real time in
      // its own unit tests; the ban on ambient time applies to production code.
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },

  /* ------------------------------------------------------------------- e2e -- */
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'waitForTimeout is the single largest source of flake in an SSE-driven app. Use an auto-retrying expect() instead.',
        },
      ],
    },
  },
)
