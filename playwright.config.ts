import { defineConfig, devices } from '@playwright/test'

/**
 * E2E answers the one question no other ring can: does a photo taken on a phone
 * actually reach the projector? Each worker boots a real server on its own port with
 * its own SQLite file and media root (see tests/e2e/fixtures/app.ts), so there is no
 * shared state and no network stubbing anywhere in this suite.
 */
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Locally a retry hides a bug. In CI a browser occasionally loses a frame.
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: {
    // SSE propagation across two browser contexts is the slowest thing asserted here.
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  reporter: process.env.CI
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
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // The guest surface. Most guests at an event are on a phone, so this project
      // runs the upload journeys.
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      // The browser the largest share of guests actually use.
      name: 'webkit-mobile',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'firefox-desktop',
      use: { ...devices['Desktop Firefox'] },
      // Cross-browser confidence without tripling every run.
      grep: /@smoke/,
    },
  ],
})
