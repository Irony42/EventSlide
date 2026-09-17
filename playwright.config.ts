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

export default defineConfig({
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
  expect: {
    // SSE propagation across two browser contexts is the slowest thing asserted here.
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  reporter: process.env['CI']
    ? [['github'], ['html', { open: 'never' }], ['list']]
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
     */
    locale: 'fr-FR',
    // The suite drives the wall's timing through query hooks rather than real
    // waiting; those hooks only exist when the server is started with E2E_HOOKS=1.
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium-desktop',
      testIgnore: OFFLINE_JOURNEYS,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // The guest surface. Most guests at an event are on a phone, so this project
      // runs the upload journeys.
      name: 'chromium-mobile',
      testIgnore: OFFLINE_JOURNEYS,
      use: { ...devices['Pixel 7'] },
    },
    {
      // The browser the largest share of guests actually use.
      name: 'webkit-mobile',
      testIgnore: OFFLINE_JOURNEYS,
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'firefox-desktop',
      testIgnore: OFFLINE_JOURNEYS,
      use: { ...devices['Desktop Firefox'] },
      // Cross-browser confidence without tripling every run.
      grep: /@smoke/,
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
      testDir: './tests/e2e/offline',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
