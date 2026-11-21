import { expect, test } from '../fixtures/app'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The host's "Invitations" page, from the event page to a link a guest opens (spec 29).
 *
 * What no cheaper ring can answer: **does what the host types in a form reach a guest's browser as
 * the right hour, on the real server?** The times are typed as a wall clock and read in the
 * invitation's zone, saved, activated, and the page behind the link says the same. The negatives sit
 * with the positives: before the date is saved the switch-on is not offered, a link changed in the
 * console leaves the old one one sentence, and a link switched off says the same sentence.
 */

const text = fr.guestInvite.host

test('the host writes the invitation, switches it on, and a guest opens it at the hour that was typed', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'fete-de-lea', name: 'Léa fête ses 40 ans' })

  // --- The way in: the invitations link of the event page.
  await host.goto(app.url(`/admin/events/${event.slug}`))
  await host.getByRole('link', { name: text.title }).first().click()
  await expect(host.getByRole('heading', { level: 1, name: text.title })).toBeVisible()
  await expect(host).toHaveURL(new RegExp(`/admin/events/${event.slug}/invitations$`))

  // --- Nothing saved yet: no switch-on, and the formats say why.
  await expect(host.getByRole('button', { name: text.activate })).toBeDisabled()
  await expect(host.getByText(text.locked)).toBeVisible()

  // --- The faire-part. The zone is the party's: Paris, whatever the laptop's.
  const form = host.getByRole('form', { name: text.formTitle })
  await form.getByRole('button', { name: text.zoneChange }).click()
  await form.getByLabel(text.zoneLabel).selectOption('Europe/Paris')
  await form.getByLabel(/^Début/).fill('2027-12-11T19:00')
  await form.getByLabel(/^Fin/).fill('2027-12-12T02:00')
  await form.getByLabel(/^Lieu/).fill('La Guinguette du Port')
  await form.getByLabel(/^Adresse/).fill('12 quai de la Loire\n44000 Nantes')
  await form.getByLabel(/^Votre mot/).fill('Apéro à 19 h, venez comme vous êtes.')
  await form.getByRole('button', { name: text.save }).click()
  await expect(host.getByRole('status').filter({ hasText: text.saved })).toBeVisible()

  // --- The hour the host typed in the zone of the party is what the server holds.
  const stored = await host.request.get(app.url(`/api/events/${event.slug}/guest-invite`))
  const body = (await stored.json()) as {
    guestInvite: { startsAt: string; timeZone: string; enabled: boolean }
  }
  expect(body.guestInvite.startsAt).toBe('2027-12-11T18:00:00.000Z')
  expect(body.guestInvite.timeZone).toBe('Europe/Paris')
  expect(body.guestInvite.enabled).toBe(false)

  // --- Switch on: the link appears, and the formats open.
  await host.getByRole('button', { name: text.activate }).click()
  const link = host.getByLabel(text.linkLabel)
  await expect(link).toHaveValue(new RegExp(`^${app.baseUrl}/i/[0-9A-Z]{16}$`))
  await expect(host.getByText(text.pillOn, { exact: true })).toBeVisible()
  await expect(host.getByRole('tabpanel')).toBeAttached()
  await expect(host.getByText(text.locked)).toHaveCount(0)
  const url = await link.inputValue()

  // --- A guest opens it, and reads the hour that was typed.
  const context = await browser.newContext({ locale: 'fr-FR' })
  const guest = await context.newPage()
  try {
    await guest.goto(url)
    await expect(
      guest.getByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' }),
    ).toBeVisible()
    await expect(guest.getByText('samedi 11 décembre 2027')).toBeVisible()
    await expect(guest.getByText('19 h – 2 h')).toBeVisible()
    await expect(guest.getByText('La Guinguette du Port')).toBeVisible()

    // --- Changing the link asks first, and kills the old one on the spot.
    await host.getByRole('button', { name: text.rotate }).click()
    await expect(host.getByRole('dialog', { name: text.rotateTitle })).toBeVisible()
    await host
      .getByRole('dialog', { name: text.rotateTitle })
      .getByRole('button', { name: text.rotateConfirm })
      .click()
    await expect(link).not.toHaveValue(url)
    const newUrl = await link.inputValue()
    await guest.reload()
    await expect(
      guest.getByRole('heading', { level: 1, name: fr.guestInvite.page.gone }),
    ).toBeVisible()
    await guest.goto(newUrl)
    await expect(
      guest.getByRole('heading', { level: 1, name: 'Léa fête ses 40 ans' }),
    ).toBeVisible()

    // --- Switching off keeps the text and answers the same sentence.
    await host.getByRole('button', { name: text.disable }).click()
    await expect(host.getByText(text.pillOff, { exact: true })).toBeVisible()
    await expect(host.getByLabel(/^Lieu/)).toHaveValue('La Guinguette du Port')
    await guest.reload()
    await expect(
      guest.getByRole('heading', { level: 1, name: fr.guestInvite.page.gone }),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})

test('the page is for the owner: the form fits a 360 px phone', async ({ app, surfaces }) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'fete-etroite', name: 'Camille & Sacha' })

  await host.setViewportSize({ width: 360, height: 740 })
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await expect(host.getByRole('heading', { level: 1, name: text.title })).toBeVisible()

  const overflow = await host.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const save = await host.getByRole('button', { name: text.save }).boundingBox()
  expect(save?.height ?? 0).toBeGreaterThanOrEqual(44)
})
