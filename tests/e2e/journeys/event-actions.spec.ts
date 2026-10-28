import AxeBuilder from '@axe-core/playwright'
import { expect, signInAsHost, test } from '../fixtures/app'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's way out of the event page: five navigation tiles.
 *
 * What a component test cannot say is how they land in a real browser: whether the page
 * stays inside the screen on a phone with a real viewport and a real scrollbar, whether
 * the tiles clear the 44 px floor once layout has run, whether the ring is actually drawn
 * on one, and whether the contrast of the new surfaces survives axe. Which link goes where
 * is `EventActionLinks.test.tsx`'s job.
 */

/** 44 px is the floor, not the aspiration — docs/DESIGN-SYSTEM.md section 8. */
const TOUCH_MIN = 44

const ACTIONS = [
  fr.admin.openWall,
  fr.admin.openModeration,
  fr.mobileModeration.title,
  fr.admin.settings,
  fr.admin.download,
] as const

test('the event page lays its actions out inside the screen, as real targets', async ({
  app,
  page,
}) => {
  const event = await app.seedEvent({ slug: 'buffet', name: 'Camille & Sacha' })
  await signInAsHost(page, app)
  await page.goto(app.url(`/admin/events/${event.slug}`))
  await expect(page.getByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()

  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('the project declares no viewport')

  for (const name of ACTIONS) {
    const link = page.getByRole('link', { name })
    await expect(link).toBeVisible()
    const box = await link.boundingBox()
    if (box === null) throw new Error(`${name} was never laid out`)
    expect(box.height, `${name} is shorter than a thumb`).toBeGreaterThanOrEqual(TOUCH_MIN)
    expect(box.x, `${name} starts off the left edge`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `${name} runs off the right edge`).toBeLessThanOrEqual(viewport.width)
  }

  // The whole page, not only the tiles: a tile that cannot shrink drags the document wider
  // than the screen, and it is the document that scrolls sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the event page has no serious accessibility violation, tiles included', async ({
  app,
  page,
}) => {
  const event = await app.seedEvent({ slug: 'buffet', name: 'Camille & Sacha' })
  await signInAsHost(page, app)
  await page.goto(app.url(`/admin/events/${event.slug}`))
  await expect(page.getByRole('link', { name: fr.admin.openModeration })).toBeVisible()

  // The QR code is left out, and the exclusion is the finding rather than a convenience:
  // `qrcode.react` stamps `role="img"` on its own `<svg>`, inside the wrapper that already
  // carries the name (`EventQrCard`), so axe reports an unnamed image there on `main` too.
  // That is not this change's to fix, and it must not hide a violation on the tiles.
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('[role="img"][aria-label] > svg')
    .analyze()

  expect(
    violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([])
})

test('a tile shows the focus ring when the keyboard reaches it', async ({ app, page }) => {
  const event = await app.seedEvent({ slug: 'buffet', name: 'Camille & Sacha' })
  await signInAsHost(page, app)
  await page.goto(app.url(`/admin/events/${event.slug}`))
  const wall = page.getByRole('link', { name: fr.admin.openWall })
  await expect(wall).toBeVisible()

  // `focus()` from a script is not a keyboard arrival and would not match `:focus-visible`
  // in every engine; Tab is what a host without a mouse actually does.
  for (let presses = 0; presses < 20; presses += 1) {
    await page.keyboard.press('Tab')
    if (await wall.evaluate((node) => node === document.activeElement)) break
  }
  await expect(wall).toBeFocused()

  const ring = await wall.evaluate((node) => getComputedStyle(node).boxShadow)
  expect(ring).not.toBe('none')
})
