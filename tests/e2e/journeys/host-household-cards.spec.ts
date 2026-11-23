import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { decodeQr } from '../fixtures/qrDecode'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'

/**
 * One printed card per household (spec 30, lot 3, PR 12), from the host's tab to what a phone reads.
 *
 * What no cheaper ring can answer: **does the QR of each card, read from what the paper shows, lead to
 * its household's own link (`<invitation>#f=<token>`), and do five households make two pages?** The
 * host lists five households, ticks « Une carte par foyer », and in print media the cards are laid out
 * four to a sheet, each with its household's name; a reader finds the personal link in the first card
 * of each page; the secret is written nowhere in clear on the sheet; unticking the option restores the
 * same card repeated. Chromium desktop only: print rendering is a Chromium behaviour.
 */

const text = fr.guestInvite.host

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'print rendering is a Chromium behaviour')
})

/** The size in PDF points of each page the browser would print, with the page's own @page rules. */
const pagesOf = async (page: Page): Promise<number> => {
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
  return [...pdf.matchAll(/\/Type\s*\/Page\b(?!s)/g)].length
}

test('each household’s card carries its own link as a QR, four to a sheet, the secret only inside the code', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'cartes-foyers')
  const headers = await csrfHeaders(host.request, app)
  const tokens: Record<string, string> = {}
  for (const name of ['Famille Martin', 'Les Durand', 'Hugo Roux', 'Léa Petit', 'Famille Lopez']) {
    const created = await host.request.post(app.url(`/api/events/${event.slug}/households`), {
      headers,
      data: { name, places: 3 },
    })
    expect(created.status()).toBe(201)
    tokens[name] = ((await created.json()) as { household: { token: string } }).household.token
  }

  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  const sheets = host.locator('[data-household-sheet]')
  const common = host.locator('[data-format]:not([data-household-sheet])')
  await expect(common.getByRole('img', { name: /QR/ })).toHaveCount(4)

  // --- Ticking the option lays one card per household: five cards, two sheets.
  await host.getByLabel(text.printPerHousehold).check()
  await expect(sheets).toHaveCount(2)
  await expect(host.getByText(text.printPerHouseholdHint(5, 2))).toBeVisible()
  // On the screen only the first sheet is shown: the preview stays one sheet, the paper has them all.
  await expect(sheets.first()).toBeVisible()
  await expect(sheets.nth(1)).toBeHidden()
  await host.emulateMedia({ media: 'print' })
  await expect(sheets.first().getByRole('img', { name: /QR/ })).toHaveCount(4)
  await expect(sheets.nth(1).getByRole('img', { name: /QR/ })).toHaveCount(1)
  expect(await pagesOf(host)).toBe(2)

  // --- A reader finds each household's own link in what the paper shows, and the name is on the card.
  await expect(sheets.first()).toContainText('Famille Martin')
  expect(await decodeQr(sheets.first().getByRole('img', { name: /QR/ }).first())).toBe(
    `${url}#f=${tokens['Famille Martin']}`,
  )
  await expect(sheets.nth(1)).toContainText('Famille Lopez')
  expect(await decodeQr(sheets.nth(1).getByRole('img', { name: /QR/ }).first())).toBe(
    `${url}#f=${tokens['Famille Lopez']}`,
  )

  // --- The secret is written nowhere in clear on the paper, nor is the fragment.
  for (const secret of Object.values(tokens)) {
    await expect(sheets.first()).not.toContainText(secret)
    await expect(sheets.nth(1)).not.toContainText(secret)
  }
  await expect(sheets.first()).not.toContainText('#f=')

  // --- Unticking restores the same card, four times, on one page.
  await host.emulateMedia({ media: 'screen' })
  await host.getByLabel(text.printPerHousehold).uncheck()
  await expect(sheets).toHaveCount(0)
  await expect(common.getByRole('img', { name: /QR/ })).toHaveCount(4)
  await host.emulateMedia({ media: 'print' })
  expect(await pagesOf(host)).toBe(1)
})
