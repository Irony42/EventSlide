import { expect, test } from '../fixtures/app'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The moderation choice is two cards, and the whole card is the radio's label.
 *
 * jsdom draws no overlay, so only a browser knows that a click on the sentence under the name
 * reaches the radio (and so asks before « automatique »). The radio itself stays clickable above the overlay: the
 * privacy-notice journey clicks it directly.
 */
test('a click on the sentence of a moderation card chooses that card, and still asks first', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'cartes-moderation', name: 'Soirée cartes' })
  await host.goto(`/admin/events/${event.slug}/settings`)

  // `force`: Playwright's own check refuses the click because the label's overlay answers it,
  // which is the point; the real mouse event still lands on that overlay.
  await host.getByText(fr.admin.moderationAutoEffect).click({ force: true })

  const dialog = host.getByRole('dialog')
  await expect(dialog.getByText(fr.admin.moderationAutoWarning)).toBeVisible()
  // Nothing is chosen until the host confirms: the manual card is still the checked one.
  await dialog.getByRole('button', { name: fr.app.cancel }).click()
  await expect(host.getByRole('radio', { name: fr.admin.moderationManual })).toBeChecked()

  // And the radio itself, with no force: a plain click reaches it above the overlay in every engine.
  await host.getByRole('radio', { name: fr.admin.moderationAuto }).click()
  await expect(host.getByRole('dialog').getByText(fr.admin.moderationAutoWarning)).toBeVisible()
})
