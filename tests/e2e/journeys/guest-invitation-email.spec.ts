import sharp from 'sharp'
import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { downloadedInvitationImage } from '../fixtures/invitationImage'
import { decodeQrInImage } from '../fixtures/qrDecode'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'

/**
 * The invitation e-mail, from the host's tab to the link that opens a mail program (spec 29, PR 7).
 *
 * What no cheaper ring can answer: **is the `mailto:` link a real browser is given the one the
 * draft says, to nobody, under the size mail programs accept, with the invitation's link in it?**
 * The link is read off the page as the browser holds it and decoded; a long word is cut and the
 * link survives; the picture to attach is the card, with a QR a reader finds in the file.
 *
 * Chromium desktop only: the tab is the same on the phone projects and the mail program is not
 * something a test can open.
 */

const text = fr.guestInvite.email

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

const openEmailTab = async (page: Page, appUrl: string, slug: string) => {
  await page.goto(`${appUrl}/admin/events/${slug}/invitations?panel=partage`)
  await page.getByRole('tab', { name: fr.guestInvite.host.tabEmail }).click()
}

const carried = async (page: Page) => {
  const href = (await page.getByRole('link', { name: text.open }).getAttribute('href')) ?? ''
  const [head = '', body = ''] = href.slice('mailto:?'.length).split('&body=')
  return {
    href,
    subject: decodeURIComponent(head.replace('subject=', '')),
    body: decodeURIComponent(body),
  }
}

test('the link opens a draft to nobody with the moment, the place, the word and the link', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'courriel-invitation')
  await openEmailTab(host, app.baseUrl, event.slug)

  const link = await carried(host)

  expect(link.href.startsWith('mailto:?subject=')).toBe(true)
  expect(link.href.length).toBeLessThanOrEqual(1800)
  expect(link.subject).toBe('Invitation : Léa fête ses 40 ans, samedi 11 décembre')
  expect(link.body).toContain('Léa fête ses 40 ans, et vous êtes invité·e.')
  expect(link.body).toContain('Quand : Samedi 11 décembre 2027, 19 h – 2 h')
  expect(link.body).toContain('Où : La Guinguette du Port, 12 quai de la Loire, 44000 Nantes')
  expect(link.body).toContain('Apéro à 19 h, venez comme vous êtes.')
  expect(link.body.endsWith(url)).toBe(true)
  await expect(host.getByText(text.bccAdvice)).toBeVisible()
  await expect(
    host.getByText(new RegExp(`${link.href.length} / 1800 caractères encodés`)),
  ).toBeVisible()
})

test('a long word is cut to fit a mail program, and the link is kept', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'courriel-long')
  const headers = await csrfHeaders(host.request, app)
  // 480 accented letters: 2 880 characters once encoded, far over what a mail link may weigh.
  const saved = await host.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
    headers,
    data: { message: 'é'.repeat(480) },
  })
  expect(saved.status()).toBe(200)
  await openEmailTab(host, app.baseUrl, event.slug)

  const link = await carried(host)

  expect(link.href.length).toBeLessThanOrEqual(1800)
  expect(link.body.endsWith(`… (suite sur la page de l’invitation)\n\n${url}`)).toBe(true)
  expect(link.body).toContain('12 quai de la Loire')
  await expect(host.getByText(/mot coupé, la fin renvoie à la page/)).toBeVisible()
  // The field keeps everything: only the link that opens the mail program is cut.
  await expect(host.getByRole('textbox', { name: /Message/ })).toHaveValue(/é{480}/)
})

test('the picture to attach is the card on a square, with a QR that leads to the invitation', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'courriel-image')
  await openEmailTab(host, app.baseUrl, event.slug)

  const png = await downloadedInvitationImage(host)

  const meta = await sharp(png).metadata()
  expect([meta.width, meta.height]).toEqual([1080, 1080])
  expect(await decodeQrInImage(png)).toBe(url)
})
