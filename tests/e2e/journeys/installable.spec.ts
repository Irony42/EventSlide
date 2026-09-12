import { expect, test } from '../fixtures/app'

/**
 * Whether a guest's phone will actually offer to keep EventSlide.
 *
 * This is a ring-6 test for a reason no cheaper ring can cover: installability is
 * decided by the browser from files fetched over HTTP, and the failure mode is silence.
 * A manifest that 404s, an icon the server does not serve, a missing 512px entry — none
 * of them log anything. The prompt simply never fires, and the only way to find out is
 * to ask the running server for every file the browser will ask it for.
 *
 * `@smoke` because it is three requests and it protects a feature that is otherwise
 * invisible when broken.
 */

test('the running server serves everything a browser needs to offer an install @smoke', async ({
  app,
  page,
}) => {
  const manifest = await page.request.get(app.url('/manifest.webmanifest'))
  expect(manifest.status()).toBe(200)

  const parsed = (await manifest.json()) as {
    name?: string
    start_url?: string
    display?: string
    prefer_related_applications?: boolean
    icons?: readonly { src: string; sizes: string; type: string; purpose?: string }[]
  }

  // Chromium's list, and it refuses without every one of them.
  expect(parsed.name).toBeTruthy()
  expect(parsed.start_url).toBeTruthy()
  expect(parsed.display).toBe('standalone')
  expect(parsed.prefer_related_applications ?? false).toBe(false)

  const icons = parsed.icons ?? []
  const square = icons.filter((icon) => icon.purpose !== 'maskable').map((icon) => icon.sizes)
  expect(square).toContain('192x192')
  expect(square).toContain('512x512')

  // Every icon the manifest promises, actually served. A manifest entry pointing at a
  // 404 is the failure this test exists for: the browser reports nothing at all.
  for (const icon of icons) {
    const response = await page.request.get(app.url(icon.src))
    expect(response.status(), `${icon.src} should be served`).toBe(200)
    expect(response.headers()['content-type']).toContain(icon.type.split('/')[0] ?? 'image')
  }
})

test('the guest page points iOS at an icon it will actually use @smoke', async ({ app, page }) => {
  // iOS ignores the manifest entirely. Without this link an installed EventSlide gets a
  // screenshot of the page as its home-screen icon.
  await page.goto(app.url('/join'))

  const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
  expect(href).toBeTruthy()

  const response = await page.request.get(app.url(href ?? ''))
  expect(response.status()).toBe(200)
})
