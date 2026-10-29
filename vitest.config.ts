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
    // No on-disk module cache. Vitest 5 turns it on by itself and keys an entry by the
    // module's own text, but the guards read the tree with an eager `import.meta.glob`, whose
    // result depends on which files exist and not on the text of the module holding it. A
    // cached entry written before a file was added (or in another worktree sharing
    // `node_modules`) is served unchanged: `keysRead.guard.test.ts` then failed with every
    // `admin.venuePhoto*` sentence "unread" while `VenuePhotoField.tsx` read them, and any edit
    // to the guard made it pass. The opposite is worse: a guard stays green after someone adds
    // the file it exists to catch. A clean CI checkout never sees this, so nothing there
    // would have said so.
    fsModuleCache: false,
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
        // What `web/vite.config.ts` injects at build time, fixed. A component test is about
        // the component: it must not change when `package.json` is bumped for a release,
        // and it must be able to tell these values from what `GET /api/about` answers.
        define: {
          __APP_VERSION__: JSON.stringify('0.0.0-build'),
          __SOURCE_URL__: JSON.stringify('https://source.test/eventslide/tree/v0.0.0-build'),
        },
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
      include: ['src/**/*.ts', 'web/src/**/*.{ts,tsx}', 'scripts/**/*.{ts,mts}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Test doubles and harnesses are themselves covered by the port contract
        // suites; counting them again would only inflate the number.
        'src/application/testing/**',
        'src/interface/http/testing/**',
        // The in-process SMTP relay the mailer adapter is tested against: a test double,
        // exercised by the Mailer contract suite, not production code.
        'src/infrastructure/**/testing/**',
        'web/src/testing/**',
        // Any `testing/` folder, not just the top-level one: a port's contract suite
        // lives beside the port it describes (web/src/lib/offline/testing/), exactly as
        // src/application/testing/contracts/ does on the server side.
        'web/src/**/testing/**',
        // Composition root and bootstrap: wiring with no branches worth asserting.
        // Covered end to end by the Playwright suite instead.
        'src/main/**',
        'web/src/main.tsx',
        // Barrel files re-export only.
        '**/index.ts',
        // The README's screenshot driver: run by a maintainer to photograph a throwaway
        // server, touching nobody's data, and asserting nothing by design. Named rather
        // than left out of `include` by its extension, so the next `.mts` under
        // `scripts/` is counted by the ratchet below instead of skipped in silence.
        'scripts/showcase.mts',
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
         * A percentage floor was the obvious move and it is the wrong one here: the
         * three files that carry most of the debt are near 0%, so the only floor they can
         * pass is 0, and a threshold of 0 is a threshold that cannot fail — the same
         * thing the visual suite was doing in CI before this change, and worse than
         * having none.
         *
         * **These numbers go down as tests land, and never up.** Raising one to admit a
         * new untested script is how a ratchet becomes a rubber stamp; write the test
         * and lower the number instead. They are the uncovered counts of a full
         * `npm run test:coverage` (208 statements, 91 branches, 20 functions, 194 lines),
         * not of the scripts' own tests alone, and they were once set 70 statements above
         * that, room for a script of about that size to land untested without a word.
         * `backup.ts` and `restore.ts` show the shape — they sit near 90% because
         * `scripts/backup.test.ts` and `scripts/restore.test.ts` drive the real CLIs.
         * What is still the debt: `seedDemo.ts` (79 statements), which refuses to run when
         * `config.isProduction`, a guard rail with nothing asserting it still works;
         * `purge.ts` (75), whose `--dry-run` must touch nothing; and `migrate.ts` (26), the
         * tool an operator points at the database holding someone's wedding album.
         */
        'scripts/**': { statements: -208, branches: -91, functions: -20, lines: -194 },
      },
    },
  },
})
