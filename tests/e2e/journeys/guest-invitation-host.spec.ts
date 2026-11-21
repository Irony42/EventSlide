import { expect, signInAsHost, test } from '../fixtures/app'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
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

test('the page is for the owner: the form fits a 320 px phone', async ({ app, surfaces }) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'fete-etroite', name: 'Camille & Sacha' })

  await host.setViewportSize({ width: 320, height: 640 })
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await expect(host.getByRole('heading', { level: 1, name: text.title })).toBeVisible()

  const overflow = await host.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const save = await host.getByRole('button', { name: text.save }).boundingBox()
  expect(save?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('the zone is taken from the browser on the first save: a host in Auckland types Auckland time', async ({
  app,
  browser,
}) => {
  const event = await app.seedEvent({ slug: 'fete-auckland', name: 'Léa fête ses 40 ans' })
  // A laptop in New Zealand, and a host who never touches the zone selector.
  const context = await browser.newContext({
    timezoneId: 'Pacific/Auckland',
    locale: SUITE_LOCALE,
    viewport: { width: 1280, height: 800 },
  })
  const page = await context.newPage()
  try {
    await signInAsHost(page, app)
    await page.goto(app.url(`/admin/events/${event.slug}/invitations`))
    const form = page.getByRole('form', { name: text.formTitle })

    await form.getByLabel(/^Début/).fill('2027-12-11T19:00')
    await form.getByRole('button', { name: text.save }).click()
    await expect(page.getByRole('status').filter({ hasText: text.saved })).toBeVisible()

    const stored = await page.request.get(app.url(`/api/events/${event.slug}/guest-invite`))
    const body = (await stored.json()) as { guestInvite: { startsAt: string; timeZone: string } }
    // 19:00 at +13:00 (New Zealand summer time) is 06:00 UTC, and the zone the invitation keeps is the laptop's.
    expect(body.guestInvite.timeZone).toBe('Pacific/Auckland')
    expect(body.guestInvite.startsAt).toBe('2027-12-11T06:00:00.000Z')

    // Opened again from the same laptop, it reads what was typed; the zone is the saved one.
    await page.reload()
    await expect(page.getByRole('form', { name: text.formTitle }).getByLabel(/^Début/)).toHaveValue(
      '2027-12-11T19:00',
    )
  } finally {
    await context.close()
  }
})

test('a moderator sees that only the owner writes the invitation, and no form', async ({
  app,
  surfaces,
  browser,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'fete-moderee', name: 'Camille & Sacha' })
  const moderator = `moderateur-${app.baseUrl.split(':').at(-1) ?? '0'}@eventslide.test`

  await host.goto(app.url(`/admin/events/${event.slug}`))
  await host.getByLabel(fr.admin.moderatorEmail).fill(moderator)
  await host.getByRole('button', { name: fr.admin.inviteSubmit }).click()
  const link = await host.getByLabel(fr.admin.inviteLinkUrl).inputValue()

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    baseURL: app.baseUrl,
    locale: SUITE_LOCALE,
  })
  const page = await context.newPage()
  try {
    await page.goto(link)
    await page.getByLabel(fr.auth.invitationName).fill('Le modérateur')
    await page
      .getByLabel(fr.auth.password, { exact: true })
      .fill('phrase-que-seul-le-moderateur-connait')
    await page
      .getByLabel(fr.auth.invitationConfirmPassword, { exact: true })
      .fill('phrase-que-seul-le-moderateur-connait')
    await page.getByRole('button', { name: fr.auth.invitationSubmit }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/events/${event.slug}/moderation(/mobile)?$`))

    await page.goto(app.url(`/admin/events/${event.slug}/invitations`))

    await expect(page.getByText(text.ownerOnly)).toBeVisible()
    await expect(page.getByRole('form', { name: text.formTitle })).toHaveCount(0)
    await expect(page.getByRole('button', { name: text.activate })).toHaveCount(0)
    // And the event page does not lead there.
    await page.goto(app.url(`/admin/events/${event.slug}`))
    await expect(page.getByRole('link', { name: text.title })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
