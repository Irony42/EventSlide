# 2. Vitest over Jest

## Status

Accepted. Replaced the `jest` configuration block and the `test` / `test:ci` scripts
1.0 carried in `package.json`; landed in `fa6e9bd`.

Implementation note: `vitest.config.ts`, `playwright.config.ts` and the coverage gates
exist. The paths they point at (`src/domain/**`, `web/src/**`, `tests/e2e/`) are the 2.0
layout being filled in commit by commit, so treat a path in the _Decision_ section as
the shape being built rather than as something already green.

## Date

2026-09-09

## Context

1.0 was configured for tests and ran none. Verified in the source on disk:

| Evidence                                                                                 | Where                       | Effect                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| `"preset": "ts-jest"`, `"collectCoverage": true`, `collectCoverageFrom: ["src/**/*.ts"]` | `package.json` (`jest` key) | full coverage machinery, no `coverageThreshold`, so no gate |
| `"test:ci": "jest --runInBand --passWithNoTests"`                                        | `package.json`              | exit code 0 on an empty suite                               |
| `- name: Test / run: npm run test:ci`                                                    | `.github/workflows/ci.yml`  | CI green while asserting nothing                            |
| `find src -name '*.test.*'` → 0 hits                                                     | repository                  | there was never a single test to run                        |
| `export let db` module-level mutable singleton                                           | `src/database.ts`           | nothing could be constructed under test anyway              |

So the runner was not the only problem — but it was the part that lied. A pipeline that
reports success on zero tests is worse than no pipeline: it makes "CI is green" evidence
of nothing.

2.0 also has to test two halves in one repository, and they do not share a runtime:

| Half                                                           | Runtime | Module system              | Needs                                                                            |
| -------------------------------------------------------------- | ------- | -------------------------- | -------------------------------------------------------------------------------- |
| `src/**` (domain, application, infrastructure, interface/http) | Node 22 | ESM, TS strict             | native `better-sqlite3`, real temp dirs, `supertest` against `buildServer(deps)` |
| `web/src/**` (React 19 + Vite)                                 | jsdom   | ESM, TSX, `jsx: react-jsx` | `@testing-library/react`, CSS Modules resolution, Vite plugin pipeline           |

1.0 expressed that split as two incompatible TypeScript projects — `tsconfig.json`
(`module: commonjs`, `exclude: ["src/frontend"]`) and `tsconfig.app.json`
(`module: esnext`, `moduleResolution: bundler`, `allowImportingTsExtensions`). Any runner
we pick has to honour both without a third, hand-maintained transform config.

Requirements used to choose:

| #   | Requirement                                                              | Why here                                                                                                      |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| R1  | An empty or filtered-away suite must **fail**                            | the 1.0 defect above                                                                                          |
| R2  | Per-scope coverage thresholds in one place                               | `src/domain` and `src/application` are gated at 100% branches (CLAUDE.md §5); adapters are deliberately lower |
| R3  | Two environments, one config, one command                                | `npm run verify` must cover both halves                                                                       |
| R4  | Reuse the Vite transform and path aliases already needed to build `web/` | avoids a second, drifting transform config                                                                    |
| R5  | Sub-second watch feedback on pure code                                   | ring 1 is TDD on `src/domain/**`; a multi-second loop kills the practice                                      |
| R6  | Native addons and real filesystem in the same run                        | ring 3 uses `better-sqlite3` `:memory:` and `mkdtemp`                                                         |

## Decision

Use **vitest** as the single runner, with two projects in one root config.

```ts
// vitest.config.ts (target shape)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          pool: 'forks', // native better-sqlite3 + per-test temp dirs
          setupFiles: ['src/testing/setup.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['web/src/testing/setup.ts'], // '@testing-library/jest-dom/vitest'
        },
      },
    ],
    coverage: {
      provider: 'v8',
      thresholds: {
        'src/domain/**': { statements: 100, branches: 100 },
        'src/application/**': { statements: 100, branches: 100 },
        'src/infrastructure/**': { statements: 90, branches: 85 },
        'src/interface/**': { statements: 95, branches: 90 },
        'web/src/**': { statements: 85, branches: 80 },
      },
    },
  },
})
```

Consequent choices:

| Concern                  | Choice                                                                      | Note                                                                            |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| HTTP contract (ring 4)   | `supertest` against `buildServer(deps)`                                     | no `listen()`, no port, runs in the `server` project                            |
| Components (ring 5)      | `@testing-library/react` + `@testing-library/jest-dom/vitest`               | jsdom only; a component test must never import `src/infrastructure`             |
| Coverage                 | `@vitest/coverage-v8`                                                       | V8 needs no instrumenting transform, so coverage costs little on the watch loop |
| Path aliases             | one `resolve.alias` block in `vitest.config.ts`, matching the tsconfigs     | not a duplicated jest `moduleNameMapper`                                        |
| Test doubles             | fakes from `src/application/testing/`; `vi.fn()` only for third-party seams | see `.claude/skills/eventslide-testing/`                                        |
| E2E                      | stays on Playwright in `tests/e2e/`, run by `npm run test:e2e`              | different lifecycle: real server, real SQLite file, real browsers               |
| Isolation of native code | `pool: 'forks'` on `server`                                                 | a failing native call kills one fork, not the run                               |

**`--passWithNoTests` is removed from every script.** CI runs `npm run verify`
(lint → typecheck → `test:coverage` → build); an empty suite, a bad `include` glob, or a
project that matched no files fails the job. R1 is satisfied by the absence of that flag,
not by a convention.

## Consequences

### Positive

- One runner, one config file, one `npm run verify` for server and web. No second
  transform config to keep in step with `vite.config.ts`.
- Native ESM and TS through esbuild: no `ts-jest` type-check-per-file cost, so ring 1 and
  ring 2 (`npm run test:unit`, pure code and in-memory fakes) stay in the sub-second range
  that domain TDD needs (R5).
- Thresholds are declared per scope in one object (R2), so "domain at 100% branches" is a
  build gate rather than a paragraph in a document.
- Project names are addressable: `npm run test:server`, `npm run test:web`,
  `vitest --project=server` — useful when a jsdom test accidentally reaches for `fs`.
- Type-checking stays where it belongs: `npm run typecheck` runs `tsc --noEmit` over the
  tsconfig projects. The runner is not also the type checker, so neither job hides the other.

### Negative

- Smaller ecosystem than jest. Plugins that assume jest globals (`jest-extended`,
  some snapshot serializers) need a vitest equivalent or must be dropped.
- Jest-specific API has to be translated on sight: `jest.fn` → `vi.fn`,
  `jest.mock` → `vi.mock`, `jest.useFakeTimers` → `vi.useFakeTimers`,
  `jest.setTimeout` → `testTimeout`. Copy-pasted snippets from jest answers will not run.
- `globals` are off by default; every test file imports `describe/it/expect` from `vitest`.
  That is a real (small) diff on every file, and it is intentional — explicit imports keep
  the two projects honest about what they are.
- Vitest moves faster than jest. `test.projects` itself replaced the earlier
  `vitest.workspace.ts`, so config can need a small migration on a major upgrade.

### Neutral

- Coverage numbers are V8-based, not Babel-instrumented; line and branch counts shift
  slightly versus jest's istanbul output. Thresholds above are calibrated against V8 and
  must be re-read, not ported, if the provider ever changes.
- `vi.mock` remains available, so the "fakes, not mocks" rule stays a review and skill
  rule, not something the runner enforces.

## Alternatives considered

### Keep jest, with two projects and ts-jest

Rejected. It requires a third transform configuration on top of `vite.config.ts` — a
`ts-jest` transform per project plus a `moduleNameMapper` for path aliases, CSS Modules,
and static assets that Vite already resolves. Those two resolvers drift, and the failure
mode is a test that passes while the built app is broken. `ts-jest` also type-checks every
file on every run, which is duplicated work next to `npm run typecheck` and slow enough to
discourage watch-mode TDD (R4, R5). Nothing in jest's larger ecosystem is needed by this
repo's six rings.

### `node:test` with `tsx`

Rejected. Fine for `src/domain/**`, insufficient for the whole repo: no jsdom environment
and no Vite transform, so `web/src/**/*.test.tsx` cannot run at all (R3), and coverage
thresholds per scope must be assembled by hand (R2). It would leave two runners for the two
halves, which is the option below.

### Jest for the server, vitest for the web

Rejected. Two runners, two configs, two coverage reports, two sets of globals, two upgrade
paths — and the shared code that makes ring 2 and ring 4 cheap (`src/application/testing/`
fakes, builders, port contract suites) would have to be importable under both transforms.
The split would also invite exactly the drift this ADR exists to remove: a fake fixed in
one runner's setup and not the other.
