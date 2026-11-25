import { expect, test } from '../fixtures/app'
import { chooseAmbianceCard, openAppearance, saved } from '../fixtures/settingsPage'
import type { Locator, Page } from '@playwright/test'

/**
 * The appearance page (`/appearance`), in a real browser: what only a stylesheet can answer.
 *
 * The component tests know which attributes the cards and swatches carry; they cannot know that
 * `tokens.css` resolves them. Here the first swatch is shown to paint the accent of the ambiance
 * the event wears (and to follow a change of it), a card is shown to be drawn from its own
 * ambiance's photograph through the real tokens, the preview is shown to stay in view while the
 * settings scroll, and the phone's strip and its « Voir en grand » dialog are shown to work.
 */

const colourOf = (dot: Locator): Promise<string> =>
  dot.evaluate((element) => getComputedStyle(element).backgroundColor)

const swatch = (page: Page, name: 'violet' | 'rose' | 'azure' | 'teal'): Locator =>
  page.locator(`[data-template-preview="accent"][data-swatch="${name}"]`)

test('the first swatch paints the accent of the ambiance the event wears, and the cards are drawn from their own photographs', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'apparence-teinte', name: 'Camille & Sacha' })
  await openAppearance(host, app.url(`/admin/events/${event.slug}/appearance`))

  const ownAccent = swatch(host, 'violet')
  const root = await colourOf(ownAccent)
  const rose = await colourOf(swatch(host, 'rose'))
  expect(root).not.toBe(rose)

  await saved(host, () => chooseAmbianceCard(host, 'Champs d’or'))
  const champs = await colourOf(ownAccent)
  // Not always the product's violet: honey in the Champs d'or, whatever the hue stored (305).
  expect(champs).not.toBe(root)
  expect(champs).not.toBe(rose)
  // A colour of the host's own is the same colour in either ambiance (its hue is the stored one).
  expect(await colourOf(swatch(host, 'rose'))).toBe(rose)

  await saved(host, () => chooseAmbianceCard(host, 'Riviera'))
  expect(await colourOf(ownAccent)).not.toBe(champs)

  // A card is the ambiance's own ground, drawn through the real tokens: its photograph is in the
  // bundle, and the root look (no photograph) paints its aurora instead.
  const picture = (name: string) =>
    host
      .locator('label', { has: host.getByRole('radio', { name, exact: true }) })
      .locator('[data-template-preview="ambiance-card"]')
  expect(
    await picture('Guinguette').evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain('guinguette-ground')
  expect(
    await picture('EventSlide').evaluate((element) => getComputedStyle(element).backgroundImage),
  ).toContain('radial-gradient')
  // And each name is set in its own display face, not in the console's.
  const face = (name: string) =>
    picture(name)
      .locator('span')
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily)
  expect(await face('Riviera')).toContain('Playfair Display')
  expect(await face('Cabaret')).toContain('Poiret One')
})

test('the preview stays in view while the settings scroll, and follows a choice at once', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'apparence-collant', name: 'Camille & Sacha' })
  await host.setViewportSize({ width: 1440, height: 900 })
  await openAppearance(host, app.url(`/admin/events/${event.slug}/appearance`))
  const preview = host.getByRole('complementary', { name: 'Aperçu' })
  await expect(preview).toBeVisible()

  await host.getByText('Détails de l’écran de la salle').click()
  await host.getByRole('radio', { name: 'Coins droits' }).scrollIntoViewIfNeeded()
  const scrolled = await host.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  const box = await preview.boundingBox()
  expect(box?.y ?? Infinity).toBeGreaterThanOrEqual(0)
  expect(box?.y ?? Infinity).toBeLessThan(120)

  // The wall in the preview wears the choice before anything is read back from the server.
  await saved(host, () => host.getByRole('radio', { name: 'Coins droits' }).check())
  await expect(host.locator('[data-template-preview="wall"]')).toHaveAttribute(
    'data-event-frame',
    'square',
  )
})

test('on a phone the preview is a small bar, and « Voir en grand » opens the whole of it', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'apparence-telephone', name: 'Camille & Sacha' })
  await host.setViewportSize({ width: 390, height: 800 })
  await openAppearance(host, app.url(`/admin/events/${event.slug}/appearance`))

  await expect(host.locator('[data-template-preview="wall"]')).toBeVisible()
  await expect(host.locator('[data-template-preview="guest"]')).toHaveCount(0)
  // Nothing spills sideways at the width of a phone.
  expect(await host.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )

  await host.getByRole('button', { name: 'Voir en grand' }).click()
  const dialog = host.getByRole('dialog', { name: 'Aperçu' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-template-preview="guest"]')).toBeVisible()
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).last().click()
  await expect(dialog).toBeHidden()
})
