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
