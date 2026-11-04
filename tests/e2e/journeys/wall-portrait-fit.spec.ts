import type { Page } from '@playwright/test'
import { csrfHeaders, expect, signInAsHost, test, wallUrl } from '../fixtures/app'
import { joinAndUpload } from '../fixtures/guest'
import { aPhoto } from '../fixtures/media'

/**
 * A portrait photograph shown full screen is never cropped (bug report, November 2026).
 *
 * "A photo taken in portrait, full screen on the wall, is zoomed to the whole width, so you
 * cannot see it well." The assertion is on geometry, not on pixels: the rendered box of the
 * photograph (`getBoundingClientRect`, which includes the Ken Burns transform) lies inside
 * the 1920x1080 projector and keeps the photo's 3:4 ratio. A baseline would pass for a
 * photograph cropped the same way on both runs.
 */

const VIEWPORT = { width: 1920, height: 1080 }
const PORTRAIT = { width: 3000, height: 4000 }
const EDGE = 1 // a rounding pixel, never a crop

interface Fit {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly ratio: number
}

/**
 * The front photograph's box at the start and at the end of its Ken Burns zoom.
 *
 * The animation is paused and seeked rather than waited for: a 600 s slide is the longest
 * zoom the wall runs, and the end of it is the only frame that matters.
 */
const measure = async (page: Page, phase: 'start' | 'end'): Promise<Fit | null> =>
  page.evaluate((where) => {
    const slide = document.querySelector('[data-testid="wall-slide"]')
    const image = slide?.querySelector('img')
    if (!slide || !image || !image.complete || image.naturalWidth === 0) return null
    const animations = image.getAnimations()
    if (animations.length === 0)
      throw new Error('no Ken Burns animation: ' + slide.getAttribute('data-motion'))
    for (const animation of animations) {
      animation.pause()
      const timing = animation.effect?.getComputedTiming()
      animation.currentTime = where === 'end' ? Number(timing?.endTime ?? 0) : 0
    }
    const box = image.getBoundingClientRect()
    return {
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      ratio: box.width / box.height,
    }
  }, phase)

const expectWholePhoto = (fit: Fit | null) => {
  expect(fit).not.toBeNull()
  if (fit === null) return
  expect(fit.left).toBeGreaterThanOrEqual(-EDGE)
  expect(fit.top).toBeGreaterThanOrEqual(-EDGE)
  expect(fit.right).toBeLessThanOrEqual(VIEWPORT.width + EDGE)
  expect(fit.bottom).toBeLessThanOrEqual(VIEWPORT.height + EDGE)
  // Same ratio as the file: letterboxed, never stretched or cropped.
  expect(fit.ratio).toBeCloseTo(PORTRAIT.width / PORTRAIT.height, 1)
}

const expectFitAtBothEnds = async (page: Page) => {
  await expect.poll(async () => measure(page, 'start'), { timeout: 10_000 }).not.toBeNull()
  expectWholePhoto(await measure(page, 'start'))
  expectWholePhoto(await measure(page, 'end'))
}

test('a portrait photo fills the screen height, never its width, in every full-screen presentation', async ({
  app,
  surfaces,
}) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'portrait', name: 'Camille & Sacha' })
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  // Two photographs: a wall holding one never advances, so it never runs the zoom either.
  for (const label of ['un', 'deux']) {
    await joinAndUpload(guest, app, event.joinCode, {
      displayName: 'Léa',
      caption: 'Portrait ' + label,
      file: await aPhoto('portrait-fit-' + label, PORTRAIT.width, PORTRAIT.height),
    })
  }
  await expect(host.getByTestId('moderation-card')).toHaveCount(2)
  for (const left of [1, 0]) {
    await host
      .getByTestId('moderation-card')
      .first()
      .getByRole('button', { name: /Publier/i })
      .click()
    await expect(host.getByTestId('moderation-card')).toHaveCount(left)
  }

  // 1. The spotlight, on a slide long enough for the zoom to run its whole course.
  await projector.goto(wallUrl(app, event.slug, { layout: 'spotlight', intervalMs: 600_000 }))
  await expectFitAtBothEnds(projector)

  // 1b. Split shows two photographs side by side: each pane keeps its photograph whole.
  await projector.goto(wallUrl(app, event.slug, { layout: 'split', intervalMs: 600_000 }))
  await expect(projector.locator('[data-wall-layout="split"] img').first()).toBeVisible()
  const pane = await projector
    .locator('[data-wall-layout="split"] img')
    .first()
    .evaluate((node) => {
      const box = node.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, ratio: box.width / box.height }
    })
  expect(pane.top).toBeGreaterThanOrEqual(-EDGE)
  expect(pane.bottom).toBeLessThanOrEqual(VIEWPORT.height + EDGE)
  expect(pane.ratio).toBeCloseTo(PORTRAIT.width / PORTRAIT.height, 1)

  // 2. The slideshow half of the mixed wall is the same spotlight, reached by the phase.
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.patch(app.url(`/api/events/${event.slug}/settings`), {
    headers,
    data: { wall: { mixedEnabled: true } },
  })
  expect(saved.ok()).toBe(true)
  await projector.goto(`${wallUrl(app, event.slug, { intervalMs: 600_000 })}&e2e_phase_ms=2500`)
  await expect(projector.locator('[data-wall-phase="slideshow"]')).toBeVisible({
    timeout: 10_000,
  })
  await expectFitAtBothEnds(projector)
})

/**
 * The mosaic (Pierre: "the flat cells show little"). Every tile keeps at least 70 % of its
 * photograph visible: a photo near the cell's shape is cropped to it, anything further is
 * shown whole. Geometry, not pixels: the cell's box, the photo's file ratio and `object-fit`.
 */
test('every mosaic tile shows at least 70 % of its photograph', async ({ app, surfaces }) => {
  const { guest, host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'mosaique', name: 'Camille & Sacha' })
  await signInAsHost(host, app)
  await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
  const shapes = [
    [3000, 4000],
    [4000, 3000],
    [3000, 4000],
    [4000, 2000],
    [3000, 3000],
    [1600, 1200],
  ] as const
  for (const [index, [width, height]] of shapes.entries()) {
    await joinAndUpload(guest, app, event.joinCode, {
      displayName: 'Léa',
      file: await aPhoto(`mosaic-${index}`, width, height),
    })
  }
  await expect(host.getByTestId('moderation-card')).toHaveCount(shapes.length)
  for (let left = shapes.length - 1; left >= 0; left -= 1) {
    await host
      .getByTestId('moderation-card')
      .first()
      .getByRole('button', { name: /Publier/i })
      .click()
    await expect(host.getByTestId('moderation-card')).toHaveCount(left)
  }

  await projector.goto(wallUrl(app, event.slug, { layout: 'mosaic', intervalMs: 600_000 }))
  await expect(projector.getByTestId('wall-slide')).toHaveCount(shapes.length)
  await expect
    .poll(async () =>
      projector
        .locator('[data-wall-layout="mosaic"] [data-testid="wall-slide"] img')
        .evaluateAll((images) =>
          images.every((node) => node instanceof HTMLImageElement && node.complete),
        ),
    )
    .toBe(true)

  const tiles = await projector
    .locator('[data-wall-layout="mosaic"] [data-testid="wall-slide"] img')
    .evaluateAll((images) =>
      images.map((node) => {
        const image = node as HTMLImageElement
        const box = image.getBoundingClientRect()
        return {
          cell: box.width / box.height,
          photo: image.naturalWidth / image.naturalHeight,
          fit: getComputedStyle(image).objectFit,
        }
      }),
    )
  expect(tiles).toHaveLength(shapes.length)
  for (const tile of tiles) {
    const visible =
      tile.fit === 'cover' ? Math.min(tile.photo, tile.cell) / Math.max(tile.photo, tile.cell) : 1
    expect(visible).toBeGreaterThanOrEqual(0.7)
    // No flat strip: the cell is never more than twice as wide as tall.
    expect(tile.cell).toBeLessThan(2)
  }
  // The phone portraits are the ones shown whole.
  expect(tiles.filter((tile) => tile.fit === 'contain').length).toBeGreaterThanOrEqual(2)
})
