import { SUITE_LOCALE } from './tests/e2e/fixtures/suiteLocale'
import type { EventCreation } from './tests/e2e/fixtures/startTestApp'
import { defineConfig, devices } from '@playwright/test'

/**
 * E2E answers the one question no other ring can: does a photo taken on a phone
 * actually reach the projector? Each worker boots a real server on its own port with
 * its own SQLite file and media root (see tests/e2e/fixtures/app.ts), so there is no
 * shared state and no network stubbing anywhere in this suite.
 */

/**
 * The offline journeys run in one project and nowhere else: they take the network away
 * from a live page, and every other project would inherit that state by accident.
 *
 * A glob rather than a regular expression, because Playwright matches these against
 * native paths — a hand-rolled `/offline\//` never matches on Windows, where half of
 * this repository's development happens, and the specs would silently run everywhere.
 */
const OFFLINE_JOURNEYS = '**/offline/**'

/**
 * The frame-rate specs (`tests/e2e/perf/`) run in the `perf` project and nowhere else, so each
 * one still runs exactly once in gating, and alone: a frame rate measured while another browser
 * renders on the same machine is a number about the neighbour. Same glob reasoning as above.
 */
const PERF_SPECS = '**/perf/**/*.spec.ts'

/** What every journey project leaves out: the offline specs and the frame-rate specs. */
const NOT_A_JOURNEY = [OFFLINE_JOURNEYS, PERF_SPECS]

/**
 * `@quarantine`: a test known to be flaky, kept running but out of the gate (policy and exit
 * criteria: docs/TESTING.md §9). Tag it in its title like `@smoke`:
 * `test('does the thing @quarantine', ...)`.
 *
 * Every project carries `...selection()`, and the reason it is per project rather than one
 * top-level `grepInvert` is that Playwright takes a project's own `grep` *instead of* the
 * top-level one, so `firefox-desktop`'s `@smoke` filter would have let a quarantined smoke test
 * back into the gate. Gating runs exclude the tag; `E2E_QUARANTINE=only` (the non-blocking
 * `quarantine` job in ci.yml) selects only it, on the projects it belongs to.
 * `scripts/e2eQuarantine.test.ts` asks each project what it selects under both modes.
 */
const QUARANTINE = /@quarantine/
const QUARANTINE_ONLY = process.env['E2E_QUARANTINE'] === 'only'

/** A project's test selection: its own `required` filter (`@smoke`), and the quarantine rule. */
function selection(required?: RegExp): { grep?: RegExp; grepInvert?: RegExp } {
  if (QUARANTINE_ONLY) {
    return {
      grep: required
        ? new RegExp(`(?=.*${required.source})(?=.*${QUARANTINE.source})`)
        : QUARANTINE,
    }
  }
  return { grepInvert: QUARANTINE, ...(required ? { grep: required } : {}) }
}

/**
 * The one worker option this suite declares: who may create an event on the server a
 * worker boots (`eventCreation`, see `tests/e2e/fixtures/app.ts`). Typed here so a project's
 * `use` can set it and a misspelt policy is a compile error rather than a server that boots
 * under the default and quietly tests nothing.
 */
export default defineConfig<object, { eventCreation: EventCreation }>({
  testDir: './tests/e2e',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',

  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // Locally a retry hides a bug. In CI a browser occasionally loses a frame.
  retries: process.env['CI'] ? 2 : 0,
  // Two in CI to bound memory; locally Playwright's own default (half the cores)
  // is right, and it is applied by omitting the key entirely — under
  // exactOptionalPropertyTypes an explicit undefined is not the same as absent.
  ...(process.env['CI'] ? { workers: 2 } : {}),
  timeout: 60_000,
  // CI only: a hung journey ends the run with the report written (and the job's upload step
  // keeps it) instead of consuming the 55-minute job bound and ending as a cancellation. The
  // slowest healthy job takes 18 minutes. Locally a run is the person's to interrupt.
  ...(process.env['CI'] ? { globalTimeout: 40 * 60_000 } : {}),
  expect: {
    // SSE propagation across two browser contexts is the slowest thing asserted here.
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  reporter: process.env['CI']
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['list'],
        // Per-test outcomes for scripts/flakeRate.ts; CI uploads the file (playwright-json-*).
        ['json', { outputFile: 'playwright-json/report.json' }],
        ['./tests/e2e/reporters/failOnFlaky.ts'],
      ]
    : [['html', { open: 'never' }], ['list']],

  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    /**
     * French, pinned — and the reason is bigger than the line.
     *
     * **This suite's browsers have always inherited the machine's locale.** Playwright
     * sets no default, so every context has been started in whatever language the person
     * running it had configured. That did not matter while the app answered in French
     * whoever asked; since roadmap 1.5 the browser's own preference decides what the
     * guest surface says, and the moment it did, sixty-six specs went red on this machine
     * — every journey that types into `getByLabel(/Votre prénom/i)` waiting fifteen
     * seconds for a field that now says "Your first name".
     *
     * Read the other way round, that is the finding: **the end-to-end signal on this
     * repository was machine-dependent, and nothing said so.** It was invisible only
     * because one language made every browser locale equivalent. A suite whose result
     * depends on the operating system of whoever ran it is not a suite; it just had no
     * way to demonstrate that until now.
     *
     * So the locale is part of the fixture, like the throwaway SQLite file and the fixed
     * `CREATED_AT` in the component harness — a stated input rather than an ambient one.
     * Same decision `renderWithProviders` makes at ring 5: French unless a test says
     * otherwise. A spec that is *about* a language sets its own with
     * `test.use({ locale })` — see `tests/e2e/journeys/guest-language.spec.ts`.
     *
     * **This setting alone did not finish the job, and roadmap 1.5's second half is what
     * made that visible.** `use.locale` reaches the `page` and `context` fixtures
     * Playwright builds; it does not reach a manual `browser.newContext()`, and
     * `openSurfaces` opens three of those because the product is three people at three
     * screens. Those three went on inheriting the machine's language. It was survivable
     * while the host console and the wall answered in French whoever asked — only the
     * guest surface was exposed — and it stopped being survivable the moment every
     * surface started following either its reader or its event. The constant is shared
     * with `openSurfaces` now, and `tests/e2e/fixtures/suiteLocale.ts` is where it lives.
     */
    locale: SUITE_LOCALE,
    // The suite drives the wall's timing through query hooks rather than real
    // waiting; those hooks only exist when the server is started with E2E_HOOKS=1.
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium-desktop',
      ...selection(),
      testIgnore: NOT_A_JOURNEY,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      /**
       * The security specs again, on a server started with `EVENT_CREATION=clientMembers`
       * (and `SITE_ADMIN=on`, which boot requires of it) — roadmap §10.9: "`tenant-isolation`
       * runs under both policies".
       *
       * Its own project, with a `testMatch`, because the policy is a property of the server a
       * worker boots and the cheapest way to run one spec under it is a project that selects
       * that spec alone. The default projects run the same file under `anyAccount`; between
       * them the file runs under both, and the specs that only make sense under one say so
       * and skip under the other.
       */
      name: 'chromium-client-members',
      ...selection(),
      testMatch: '**/security/tenant-isolation.spec.ts',
      testIgnore: NOT_A_JOURNEY,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        eventCreation: 'clientMembers',
      },
    },
    {
      // The guest surface. Most guests at an event are on a phone, so this project
      // runs the upload journeys.
      name: 'chromium-mobile',
      ...selection(),
      testIgnore: NOT_A_JOURNEY,
      use: { ...devices['Pixel 7'] },
    },
    {
      // The browser the largest share of guests actually use.
      name: 'webkit-mobile',
      testIgnore: NOT_A_JOURNEY,
      use: {
        ...devices['iPhone 14'],
        /**
         * The trace keeps its DOM snapshots and drops its screencast frames, because on WebKit
         * the recording itself starves the page it records.
         *
         * Measured, not assumed: two journeys, 260 runs at twelve workers with `--retries=0`,
         * failed 9 times with the default trace and 0 times with `screenshots: false` (1 of 260
         * with only `snapshots: false`, 0 of 260 with no trace, 0 of 156 with video alone). None
         * of those was an assertion. A page stopped producing frames mid-journey (`requestAnimationFrame`
         * silent for seconds), so a `click` waited fifteen seconds for a button to be "stable" and
         * a `goto` waited for a `load` that did not come, until the 60 s test timeout closed the
         * browser under it ("Target page, context or browser has been closed"). The service
         * worker is not involved: blocking it changed nothing. The screencast pays for a frame
         * the page was already slow to paint (see the aurora in `tokens.css`), so the two fixes
         * go together. A failing test still keeps its snapshots, its network log, its screenshot
         * and its video.
         */
        trace: { mode: 'retain-on-failure', screenshots: false },
      },
    },
    {
      /**
       * The frame-rate check (`tests/e2e/perf/frame-budget.spec.ts`, roadmap 11.3), and the only
       * project that selects it. A project of its own so that CI can give it a runner to itself
       * with one worker (`--project=perf`, see ci.yml): the other projects run two workers a
       * runner and, sharded or not, a browser rendering beside the wall changes the number this
       * file exists to read. `workers: 1` is the same promise for a local run that selects it
       * with other projects: it never runs two of its own at once.
       */
      name: 'perf',
      ...selection(),
      testMatch: PERF_SPECS,
      workers: 1,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'firefox-desktop',
      ...selection(/@smoke/),
      testIgnore: NOT_A_JOURNEY,
      use: { ...devices['Desktop Firefox'] },
      // Cross-browser confidence without tripling every run: the `@smoke` subset, via selection().
    },
    {
      /**
       * The offline upload queue, and the only project allowed to run it.
       *
       * Its own project rather than a tag, for two reasons. These specs cut the
       * network out from under a live page, which is a state every other journey would
       * rather not inherit by accident; and the feature needs a registered service
       * worker, which only Chromium gives a Playwright context reliably — WebKit here
       * has neither Background Sync nor a dependable worker registration, and a
       * permanently-red project is a project people stop reading.
       *
       * The foreground drain — the path every guest gets, worker or not — is what these
       * specs assert. Background Sync is a bonus the browser may or may not grant, and
       * no assertion depends on it.
       */
      name: 'chromium-offline',
      ...selection(),
      testDir: './tests/e2e/offline',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
