import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Two projects, one runner.
 *
 * `server` runs on Node against real SQLite `:memory:` databases and temp dirs.
 * `web` runs on jsdom with Testing Library. They share this transform pipeline, so
 * there is one TypeScript story for the whole repo — which is what 1.0's ts-jest
 * preset never managed for the React half.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          // `scripts/` is in here so that a test written next to an operator tool is
          // actually collected. It was not, and that was not hypothetical:
          // `scripts/backup.test.ts` was sitting in the tree with fifteen tests in it,
          // collected by nothing and run by no one — `vitest list --project server`
          // reported 0 from `scripts/` before this line and 15 after. A test file that
          // never runs is the same failure as a snapshot suite no CI job executes, and
          // it is worse than absent because it reads as coverage.
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          // A single event-scoped SQLite file per test keeps these isolated, so
          // there is no reason to serialise them.
          isolate: true,
          testTimeout: 10_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/**/*.test.{ts,tsx}'],
          setupFiles: ['./web/src/testing/setup.ts'],
          css: true,
          testTimeout: 10_000,
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // `scripts/` is here because it is production code by any honest definition:
      // `migrate.ts` is what an operator runs against the database holding someone's
      // wedding album, `purge.ts` and `restore.ts` delete and overwrite it. It was
      // outside `include` entirely, so it did not appear in the report at all — not as
      // a low number, as nothing, which is the one way a gap stays invisible.
      include: ['src/**/*.ts', 'web/src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Test doubles and harnesses are themselves covered by the port contract
        // suites; counting them again would only inflate the number.
        'src/application/testing/**',
        'src/interface/http/testing/**',
        'web/src/testing/**',
        // Composition root and bootstrap: wiring with no branches worth asserting.
        // Covered end to end by the Playwright suite instead.
        'src/main/**',
        'web/src/main.tsx',
        // Barrel files re-export only.
        '**/index.ts',
      ],

      /**
       * Gates, not goals. Domain and application are pure or fake-driven, so 100%
       * is achievable and the gate genuinely catches an unhandled rule. Adapters sit
       * lower on purpose: some error branches need a real disk failure to reach, and
       * faking that proves nothing.
       */
      thresholds: {
        'src/domain/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/application/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/infrastructure/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'src/interface/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'web/src/**': { statements: 85, branches: 80, functions: 85, lines: 85 },

        /**
         * `scripts/` is a ratchet, not a floor, and the negative numbers are what say
         * so: a negative threshold is the maximum number of *uncovered* entities
         * allowed, rather than a percentage that must be reached. They are pinned to
         * the debt as measured, so the gate is green as it stands and fails the moment
         * the untested surface grows — a new operator tool with no test pushes the
         * count past the pin and `npm run test:coverage` names the number it exceeded.
         *
         * A percentage floor was the obvious move and it is the wrong one here. Four of
         * these five files are at 0%, so the only floor they can pass is 0, and a
         * threshold of 0 is a threshold that cannot fail — the same thing the visual
         * suite was doing in CI before this change, and worse than having none.
         *
         * **These numbers go down as tests land, and never up.** Raising one to admit a
         * new untested script is how a ratchet becomes a rubber stamp; write the test
         * and lower the number instead. `backup.ts` shows the shape — it sits at 88%
         * because `scripts/backup.test.ts` drives the real CLI. What is still at zero:
         * `migrate.ts`, the tool an operator points at the database holding someone's
         * wedding album; `restore.ts`, which refuses a non-empty target without
         * `--force`; `purge.ts --dry-run`, which must touch nothing; and
         * `seedDemo.ts`, which refuses to run when `config.isProduction` — a guard rail
         * with nothing asserting it still works.
         */
        'scripts/**': { statements: -280, branches: -109, functions: -22, lines: -263 },
      },
    },
  },
})
