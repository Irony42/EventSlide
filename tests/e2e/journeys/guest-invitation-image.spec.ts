import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import {
  DESIGN_NAMES,
  DISTANCE_LIMITS,
  distanceFromPreview,
  garlandReport,
  imageDependsOnItsFonts,
  orangePhoto,
} from '../fixtures/invitationImage'
import { decodeQrInImage } from '../fixtures/qrDecode'
import { backToCard, openShare } from '../fixtures/invitationPanels'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'

/**
 * The invitation image, made by the browser itself (spec 29, PR 6): what the host downloads is a
 * PNG of the size a phone posts, with the card on it, and a QR on it that leads to the invitation.
 *
 * What no cheaper ring can answer: **does `html-to-image` really draw the card, its fonts, its
 * photograph and its QR into a PNG, under the strict CSP the server sends?** The picture is read
 * back: its size, that it is not one flat colour, and the QR decoded from the file itself.
 *
 * Chromium desktop here; the same on a phone engine, and the native share, are
 * `guest-invitation-image-webkit.spec.ts`.
 */

const text = fr.guestInvite.image

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'the desktop run; the phone is its own spec',
  )
})

/** The PNG the "Télécharger l'image" button hands over, once the page says it is ready. */
const downloadedImage = async (page: Page): Promise<Buffer> => {
  const button = page.getByRole('button', { name: text.download })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  const path = await download.path()
  return readFile(path)
}

test('the host downloads a square image, then a story: the right size, drawn, with a QR to the invitation', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'image-invitation')
  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=partage`))
  await host.getByRole('tab', { name: fr.guestInvite.host.tabImage }).click()

  const square = await downloadedImage(host)
  const squareMeta = await sharp(square).metadata()
  expect([squareMeta.width, squareMeta.height]).toEqual([1080, 1080])
  expect(squareMeta.format).toBe('png')
  // Not one flat colour: the card, its words and its code are drawn.
  const stats = await sharp(square).stats()
  expect(Math.max(...stats.channels.map((channel) => channel.stdev))).toBeGreaterThan(20)
  expect(await decodeQrInImage(square)).toBe(url)

  await host.getByRole('radio', { name: text.formatStory }).check()
  const story = await downloadedImage(host)
  const storyMeta = await sharp(story).metadata()
  expect([storyMeta.width, storyMeta.height]).toEqual([1080, 1920])
  expect(await decodeQrInImage(story)).toBe(url)
})

test('the words that go with the image say the moment and the link, and the address only when asked', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'image-texte')
  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=partage`))
  await host.getByRole('tab', { name: fr.guestInvite.host.tabImage }).click()
  const words = host.getByRole('textbox', { name: new RegExp(text.textLabel) })

  await expect(words).toHaveValue(
    /vous êtes invité·e\.\nSamedi 11 décembre 2027, 19 h – 2 h · La Guinguette du Port\n\n/,
  )
  await expect(words).toHaveValue(new RegExp(`${url}$`))
  await expect(words).not.toHaveValue(/quai de la Loire/)

  await host.getByRole('checkbox', { name: text.addressLabel }).check()

  await expect(words).toHaveValue(/La Guinguette du Port · 12 quai de la Loire, 44000 Nantes/)
})

test('the card’s own typeface is in the picture: refuse its font files and the title is drawn differently', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'image-police')
  const open = async () => {
    await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
    await host.getByRole('radio', { name: 'Billet' }).check({ force: true })
  }
  const imageTab = async () => {
    await openShare(host)
    await host.getByRole('tab', { name: fr.guestInvite.host.tabImage }).click()
  }
  await open()
  await imageTab()
  const withFonts = await downloadedImage(host)

  await imageDependsOnItsFonts(host, withFonts, open, imageTab)
})

test('every design is drawn in the picture as it is in the preview, square and story: no black shape, no missing photograph', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'image-fidelite')
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await host.getByRole('radio', { name: 'Billet' }).check({ force: true })
  await host
    .getByTestId('print-photo-input')
    .setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await orangePhoto() })
  await expect(host.locator('[data-format] [data-print-card] img').first()).toBeVisible()

  for (const shape of [fr.guestInvite.image.formatSquare, fr.guestInvite.image.formatStory]) {
    for (const name of DESIGN_NAMES) {
      await backToCard(host)
      await host.getByRole('radio', { name }).check({ force: true })
      await openShare(host)
      await host.getByRole('tab', { name: fr.guestInvite.host.tabImage }).click()
      await host.getByRole('radio', { name: shape }).check()
      const png = await downloadedImage(host)
      const label = name + ' ' + shape

      expect(await distanceFromPreview(host, png), label).toBeLessThan(
        DISTANCE_LIMITS[name]?.chromium ?? 0,
      )

      if (name === 'Guirlande') {
        // Where it broke: the pennants, the polaroid's photograph, the black of the banner.
        const report = await garlandReport(host, png)
        for (const [part, distance] of Object.entries(report.parts)) {
          expect(distance, label + ' ' + part).toBeLessThan(30)
        }
        expect(Object.keys(report.parts), label).toContain('glSun')
        expect(report.photoFromOrange, label + ' photograph').toBeLessThan(40)
        expect(report.blackShare, label + ' black in the banner').toBeLessThan(0.005)
      }
    }
  }
})

test('the words field shows all of the text, the link included, without a scroll', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event } = await invitedHost(host, app, 'image-champ')
  await host.goto(app.url(`/admin/events/${event.slug}/invitations?panel=partage`))
  await host.getByRole('tab', { name: fr.guestInvite.host.tabImage }).click()
  await host.getByRole('checkbox', { name: text.addressLabel }).check()

  const words = host.getByRole('textbox', { name: new RegExp(text.textLabel) })

  const overflow = await words.evaluate((field) => field.scrollHeight - field.clientHeight)
  expect(overflow).toBeLessThanOrEqual(1)
})
