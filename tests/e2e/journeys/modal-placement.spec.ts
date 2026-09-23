import { expect, test } from '../fixtures/app'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A modal opens in the middle of the screen, on every project's viewport.
 *
 * Ring 6 because only a stylesheet in a real browser decides it. A native `<dialog>`
 * opened with `showModal()` is centred by the user agent's own `margin: auto`, and
 * `base.css` resets `* { margin: 0 }` — which reached the dialog too, so every modal in
 * the app (confirmations, the privacy notice, the moderation lightbox, the shared
 * gallery's viewer) sat pinned to the top-left corner, overflowing the right edge of a
 * phone. Nothing in jsdom lays anything out, so no cheaper ring could have seen it.
 *
 * The privacy notice's re-read dialog is the vehicle because it is the one modal a guest
 * reaches in two taps; the property under test belongs to `Dialog`, which they all share.
 */
test('a modal opens centred on the screen, not pinned to a corner @smoke', async ({
  app,
  page,
}) => {
  const event = await app.seedEvent({ slug: 'modale-centree', name: 'Camille & Sacha' })
  await page.goto(app.url(`/join/${event.joinCode}`))
  await page.getByRole('button', { name: fr.join.submit }).click()
  await page.waitForURL(/\/e\/[^/]+\/upload/)
  await page
    .getByRole('region', { name: fr.upload.noticeTitle })
    .getByRole('button', { name: fr.upload.noticeAcknowledge })
    .click()

  await page.getByRole('button', { name: fr.upload.noticeLink }).click()
  const dialog = page.getByRole('dialog', { name: fr.upload.noticeLink })
  await expect(dialog).toBeVisible()

  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()
  if (box === null || viewport === null) throw new Error('the dialog was never laid out')

  const left = box.x
  const right = viewport.width - (box.x + box.width)
  const top = box.y
  const bottom = viewport.height - (box.y + box.height)
  // Inside the screen on every side, and the same gap either side of it.
  expect(left).toBeGreaterThan(0)
  expect(right).toBeGreaterThan(0)
  expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
  expect(top).toBeGreaterThanOrEqual(0)
  expect(bottom).toBeGreaterThanOrEqual(0)
  expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1)
})
