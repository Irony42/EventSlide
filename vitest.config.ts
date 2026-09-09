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
          include: ['src/**/*.test.ts'],
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
      include: ['src/**/*.ts', 'web/src/**/*.{ts,tsx}'],
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
      },
    },
  },
})
