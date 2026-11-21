import { csrfHeaders, expect, test } from '../fixtures/app'
import { decodeQr } from '../fixtures/qrDecode'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The invitation card on paper, from the host's tab to what a phone reads (spec 29, PR 4).
 *
 * What no cheaper ring can answer: **does the QR on the printed card lead to the invitation's link,
 * and does the console stay off the paper?** The card is decoded from a screenshot of the printed
 * element, the way `print-kit.spec.ts` reads the table cards, and must read back exactly the link
 * the host sees. The address is on the card, the format counts are four and two, and in print media
 * the console's own chrome and the form are gone.
 *
 * Chromium desktop only: print rendering is a Chromium behaviour the other engines would repeat.
 */

const text = fr.guestInvite.host

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'print rendering is a Chromium behaviour; the other engines would assert the same',
  )
})

test('the printed card carries the invitation link as a QR, the address, and nothing of the console', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'carte-invitation', name: 'Léa fête ses 40 ans' })
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
    headers,
    data: {
      title: 'Léa fête ses 40 ans',
      startsAt: '2027-12-11T18:00:00Z',
      endsAt: '2027-12-12T01:00:00Z',
      timeZone: 'Europe/Paris',
      venueName: 'La Guinguette du Port',
      address: '12 quai de la Loire\n44000 Nantes',
      message: 'Apéro à 19 h, venez comme vous êtes.',
      language: 'fr',
    },
  })
  expect(saved.status()).toBe(200)
  const enabled = await host.request.post(
    app.url(`/api/events/${event.slug}/guest-invite/enable`),
    { headers, data: {} },
  )
  expect(enabled.status()).toBe(200)
  const { guestInvite } = (await enabled.json()) as { guestInvite: { url: string } }

  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  const sheet = host.locator('[data-format]')
  await expect(sheet).toBeVisible()

  for (const format of [
    { name: text.printFormatCard, value: 'card', copies: 4 },
    { name: text.printFormatA5, value: 'a5', copies: 2 },
  ] as const) {
    await host.emulateMedia({ media: 'screen' })
    await host.getByRole('radio', { name: format.name }).check()
    await expect(sheet).toHaveAttribute('data-format', format.value)
    await expect(sheet.getByRole('img', { name: /QR/ })).toHaveCount(format.copies)

    await host.emulateMedia({ media: 'print' })
    // The console's header, footer, form and tabs do not print; the card does.
    await expect(host.locator('header')).toBeHidden()
    await expect(host.locator('footer')).toBeHidden()
    await expect(host.getByRole('button', { name: 'Compte' })).toBeHidden()
    await expect(host.getByRole('button', { name: text.printButton })).toBeHidden()
    await expect(host.getByRole('tablist')).toBeHidden()
    await expect(host.getByRole('form', { name: text.formTitle })).toBeHidden()
    await expect(sheet).toBeVisible()

    // The address is printed, in the zone of the party.
    await expect(sheet.first()).toContainText('12 quai de la Loire')
    await expect(sheet.first()).toContainText('samedi 11 décembre 2027')
    await expect(sheet.first()).toContainText('19 h – 2 h')

    // A reader finds the invitation's link in what the paper shows.
    expect(await decodeQr(sheet.getByRole('img', { name: /QR/ }).first())).toBe(guestInvite.url)
  }
})
