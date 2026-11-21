import { csrfHeaders, expect, test } from '../fixtures/app'
import type { Page } from '@playwright/test'
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
      // Far from Paris and from UTC: the hours on the card are those of THIS zone, or of nobody's.
      timeZone: 'Asia/Tokyo',
      venueName: 'La Guinguette du Port',
      address: '12 quai de la Loire\n44000 Nantes',
      message: 'Venez comme vous êtes.',
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
  const form = host.getByRole('form', { name: text.formTitle })
  const tablist = host.getByRole('tablist')
  const word = host.getByRole('textbox', { name: text.shortLabel })
  const printButton = host.getByRole('button', { name: text.printButton })

  for (const format of [
    { name: text.printFormatCard, value: 'card', copies: 4, landscape: false },
    { name: text.printFormatA5, value: 'a5', copies: 2, landscape: true },
  ] as const) {
    await host.emulateMedia({ media: 'screen' })
    await host.getByRole('radio', { name: format.name }).check()
    await expect(sheet).toHaveAttribute('data-format', format.value)
    await expect(sheet.getByRole('img', { name: /QR/ })).toHaveCount(format.copies)
    // All of this is on the screen first, so that "hidden on paper" below cannot pass on nothing.
    for (const onScreen of [form, tablist, word, printButton]) await expect(onScreen).toBeVisible()

    await host.emulateMedia({ media: 'print' })
    // The console's header, footer, form, tabs and controls do not print; the card does.
    await expect(host.locator('header')).toBeHidden()
    await expect(host.locator('footer')).toBeHidden()
    await expect(host.getByRole('button', { name: 'Compte' })).toBeHidden()
    for (const offPaper of [printButton, tablist, form, word]) await expect(offPaper).toBeHidden()
    await expect(sheet).toBeVisible()

    // The card says the hours of the zone of the party (Tokyo), not the browser's and not Paris's.
    await expect(sheet.first()).toContainText('12 quai de la Loire')
    await expect(sheet.first()).toContainText('dimanche 12 décembre 2027')
    await expect(sheet.first()).toContainText('3 h – 10 h')
    await expect(sheet.first()).not.toContainText('19 h')

    // One sheet, one page: A4 portrait for the A6 cards, A4 landscape for the A5.
    const pages = await pagesOf(host)
    expect(pages).toHaveLength(1)
    const [width, height] = pages[0] ?? [0, 0]
    expect(Math.round(Math.min(width, height))).toBe(595)
    expect(Math.round(Math.max(width, height))).toBe(842)
    expect(width > height).toBe(format.landscape)

    // A reader finds the invitation's link in what the paper shows.
    expect(await decodeQr(sheet.getByRole('img', { name: /QR/ }).first())).toBe(guestInvite.url)
  }
})

test('on another tab, or while locked, Ctrl+P prints the page as it is, not a headless remainder', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'carte-verrouillee', name: 'Léa fête ses 40 ans' })
  const form = host.getByRole('form', { name: text.formTitle })

  // Locked: nothing is saved, so the formats are empty and say why.
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await expect(host.getByText(text.locked)).toBeVisible()
  await host.emulateMedia({ media: 'print' })
  await expect(form).toBeVisible()
  await expect(host.getByRole('tablist')).toBeVisible()
  await expect(host.getByText(text.locked)).toBeVisible()

  // The image tab of a switched-on invitation.
  await host.emulateMedia({ media: 'screen' })
  const headers = await csrfHeaders(host.request, app)
  const saved = await host.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
    headers,
    data: { startsAt: '2027-12-11T18:00:00Z', timeZone: 'Europe/Paris', language: 'fr' },
  })
  expect(saved.status()).toBe(200)
  const enabled = await host.request.post(
    app.url(`/api/events/${event.slug}/guest-invite/enable`),
    { headers, data: {} },
  )
  expect(enabled.status()).toBe(200)
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await host.getByRole('tab', { name: text.tabImage }).click()
  await expect(host.locator('[data-format]')).toHaveCount(0)
  await host.emulateMedia({ media: 'print' })
  await expect(form).toBeVisible()
  await expect(host.getByRole('tablist')).toBeVisible()
})

/** The size in PDF points of each page the browser would print, with the page's own @page rules. */
const pagesOf = async (page: Page): Promise<readonly (readonly [number, number])[]> => {
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
  const boxes = [...pdf.matchAll(/\/Type\s*\/Page\b(?!s)[\s\S]*?\/MediaBox\s*\[([^\]]+)\]/g)]
  return boxes.map((box) => {
    const [, , width, height] = (box[1] ?? '').trim().split(/\s+/).map(Number)
    return [width ?? 0, height ?? 0] as const
  })
}
