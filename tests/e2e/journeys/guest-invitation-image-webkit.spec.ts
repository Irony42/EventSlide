import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { decodeQrInImage } from '../fixtures/qrDecode'
import { fr } from '../../../web/src/lib/i18n/fr'
import type { Page } from '@playwright/test'

/**
 * The invitation image on a phone engine (spec 29, PR 6): WebKit draws the card into the PNG with
 * its fonts, and the native share is offered, or not, according to what the phone can share.
 *
 * Playwright's WebKit does not open iOS's share sheet, so the sheet is a double installed before
 * the page loads (`navigator.share` and `canShare`, recording what they are handed), and the
 * clipboard too. What is real is the picture: made by `html-to-image` in WebKit, where a capture
 * drawn without the card's fonts or its images is the known failure, and read back from the file.
 *
 * Only `webkit-mobile` runs it.
 */

const text = fr.guestInvite.image

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'webkit-mobile', 'the phone engine run')
})

interface Doubles {
  shared: { name: string; type: string; size: number; text: string }[]
  copied: string[]
}

/** A phone's share sheet and clipboard, as far as the page can tell, before the page loads. */
const installPhone = async (page: Page, canShareFiles: boolean): Promise<void> => {
  await page.addInitScript((canShare: boolean) => {
    const doubles: Doubles = { shared: [], copied: [] }
    ;(window as unknown as { __phone: Doubles }).__phone = doubles
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          doubles.copied.push(value)
        },
      },
    })
    if (!canShare) {
      Reflect.deleteProperty(Navigator.prototype, 'share')
      Reflect.deleteProperty(Navigator.prototype, 'canShare')
      return
    }
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: ShareData) => (data.files ?? []).length > 0,
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const [file] = data.files ?? []
        doubles.shared.push({
          name: file?.name ?? '',
          type: file?.type ?? '',
          size: file?.size ?? 0,
          text: data.text ?? '',
        })
      },
    })
  }, canShareFiles)
}

const phone = (page: Page): Promise<Doubles> =>
  page.evaluate(() => (window as unknown as { __phone: Doubles }).__phone)

test('on a phone, the share sheet is handed the PNG and the words, and the words are copied first', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'image-telephone')
  await installPhone(host, true)
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  // A design with a face of its own, chosen on the card: its font has to be in the picture.
  await host.getByRole('radio', { name: 'Billet' }).check({ force: true })
  await host.getByRole('tab', { name: fr.guestInvite.host.tabImage }).click()

  const share = host.getByRole('button', { name: text.share })
  await expect(share).toBeVisible({ timeout: 30_000 })
  await share.click()

  await expect.poll(async () => (await phone(host)).shared.length).toBe(1)
  const { shared, copied } = await phone(host)
  expect(shared[0]?.type).toBe('image/png')
  expect(shared[0]?.name).toBe('invitation-square.png')
  expect(shared[0]?.size ?? 0).toBeGreaterThan(5_000)
  expect(shared[0]?.text).toContain(url)
  expect(copied).toEqual([shared[0]?.text])
  await expect(host.getByText(/collez-le sous l’image/)).toBeVisible()
  // The card's face was asked for and arrived before the picture was drawn.
  expect(await host.evaluate(() => document.fonts.check('32px Anton'))).toBe(true)
})

test('on a phone that cannot share files, the image is offered as a download that WebKit draws and a reader can scan', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const { event, url } = await invitedHost(host, app, 'image-sans-partage')
  await installPhone(host, false)
  await host.goto(app.url(`/admin/events/${event.slug}/invitations`))
  await host.getByRole('radio', { name: 'Billet' }).check({ force: true })
  await host.getByRole('tab', { name: fr.guestInvite.host.tabImage }).click()

  const download = host.getByRole('button', { name: text.download })
  await expect(download).toBeEnabled({ timeout: 30_000 })
  await expect(host.getByRole('button', { name: text.share })).toHaveCount(0)
  const [saved] = await Promise.all([host.waitForEvent('download'), download.click()])
  const png = await readFile(await saved.path())

  const meta = await sharp(png).metadata()
  expect([meta.width, meta.height]).toEqual([1080, 1080])
  const stats = await sharp(png).stats()
  expect(Math.max(...stats.channels.map((channel) => channel.stdev))).toBeGreaterThan(20)
  expect(await decodeQrInImage(png)).toBe(url)

  await host.getByRole('button', { name: text.copy }).click()
  await expect(host.getByText(text.copied)).toBeVisible()
  expect((await phone(host)).copied).toHaveLength(1)
})
