import { expect, test } from '../fixtures/app'
import type { Locator } from '@playwright/test'

/**
 * The create form's template miniatures, in a real browser.
 *
 * The component tests know that each miniature carries its template's `data-event-*`
 * markers; only a browser knows that `tokens.css` turns them into a colour, a face and a
 * corner. jsdom computes no custom property, so this is the half of the feature that is
 * either measured here or not at all.
 *
 * The assertions are relative — one template against another, and against "Sans modèle" —
 * rather than written as pixels: a raw radius in a spec would be a second copy of a token,
 * and the claim is that the preview moves with the theme, not what a radius is today.
 */

const computed = (locator: Locator, property: string): Promise<string> =>
  locator
    .first()
    .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)

const px = async (locator: Locator, property: string): Promise<number> =>
  Number.parseFloat(await computed(locator, property))

test('each template card shows its own colour, typography and photo corners', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  await host.goto(app.url('/admin/events/new'))

  const preview = (key: string): Locator => host.locator(`[data-template-preview="${key}"]`)
  const photo = (key: string): Locator => preview(key).locator('[data-preview-photo]')
  const heading = (key: string): Locator => preview(key).locator('span').first()

  await expect(preview('wedding')).toBeVisible()
  await expect(photo('wedding')).toHaveCount(3)

  // Colour: the accent re-derived on the miniature itself, so the wedding is rose and the
  // conference azure. "Sans modèle" keeps the product's own accent, which is the Guinguette's
  // kraft (ADR 0010) and no longer a violet derived from hue 305: that hue is the sentinel for
  // "nothing chosen", so the miniature re-derives nothing and inherits the root's accent.
  expect(await computed(preview('wedding'), '--accent')).toContain('345')
  expect(await computed(preview('conference'), '--accent')).toContain('250')
  const rootAccent = await host.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent'),
  )
  expect(rootAccent).not.toBe('')
  expect(await computed(preview('none'), '--accent')).toBe(rootAccent)

  // The swatch is what paints the accent: the root carrying `--accent` is not the same fact as
  // something using it, and a stylesheet that stopped reading it would leave the colour right
  // on the element and absent from the page.
  const swatch = (key: string): Locator => preview(key).locator('[data-preview-accent]')
  const rose = await computed(swatch('wedding'), 'background-color')
  const azure = await computed(swatch('conference'), 'background-color')
  const violet = await computed(swatch('none'), 'background-color')
  expect(new Set([rose, azure, violet]).size).toBe(3)
  expect(await computed(swatch('birthday'), 'background-color')).toBe(violet)

  // Corners: round > the product's own > square, which is the order of the names the cards
  // print ("Coins très arrondis" for a wedding, "Coins droits" for a conference).
  const round = await px(photo('wedding').first(), 'border-top-left-radius')
  const normal = await px(photo('none').first(), 'border-top-left-radius')
  const square = await px(photo('conference').first(), 'border-top-left-radius')
  expect(round).toBeGreaterThan(normal)
  expect(normal).toBeGreaterThan(square)
  expect(square).toBe(0)

  // Typography: the wedding's heading is in the serif pairing, everything else in the sans.
  const serif = await computed(heading('wedding'), 'font-family')
  expect(serif).not.toBe(await computed(heading('none'), 'font-family'))
  expect(await computed(heading('birthday'), 'font-family')).toBe(
    await computed(heading('none'), 'font-family'),
  )
})

test('the miniatures are decorative and do not join the radio group', async ({ app, surfaces }) => {
  const { host } = surfaces
  await host.goto(app.url('/admin/events/new'))

  await expect(host.getByRole('radio')).toHaveCount(5)
  await expect(host.locator('[data-template-preview]')).toHaveCount(5)
  for (const preview of await host.locator('[data-template-preview]').all()) {
    await expect(preview).toHaveAttribute('aria-hidden', 'true')
  }
})
