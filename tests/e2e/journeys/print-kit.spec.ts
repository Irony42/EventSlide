import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import sharp from 'sharp'
import { expect, test } from '../fixtures/app'
import type { Locator } from '@playwright/test'

/**
 * Spec 02, end to end: what the host prints is what a guest can scan, and nothing else prints.
 *
 * Chromium desktop only: the print rendering (`emulateMedia`) is what is being proved, and the
 * other engines would repeat it for the same answer. The two things only a real browser can
 * break are asserted here: the console's own chrome vanishing in print media, and the sheet
 * staying inside one A4 page whatever the format.
 *
 * The QR is decoded with `@zxing/library` from a screenshot of the printed element and must read
 * back exactly the `joinUrl` the API gives, and it is compared with the QR the projected wall draws.
 * "Readable by zxing" is not "readable by every phone": the real print-out stays the last judge.
 */

/** An A4 page is 297 mm high; 1 mm is 96 / 25.4 CSS pixels. */
const A4_HEIGHT_PX = (297 * 96) / 25.4

const FORMATS = [
  { name: 'Cartes de table A6 (4 par feuille)', copies: 4 },
  { name: 'Affiche A5 (2 par feuille)', copies: 2 },
  { name: 'Affiche A4 (1 par feuille)', copies: 1 },
] as const

/** What a QR reader finds in a screenshot of the element, flattened on white paper. */
const decodeQr = async (qr: Locator): Promise<string> => {
  // Paper is white, and a browser prints no background: the console's dark one would swallow the
  // modules in a screenshot, so the element is put on white the way the sheet of paper is.
  await qr.evaluate((element) => {
    element.style.background = 'white'
  })
  const png = await qr.screenshot({ omitBackground: true })
  const { data, info } = await sharp(png)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText()
}

const pathOf = (qr: Locator): Promise<string> =>
  qr
    .locator('path')
    .last()
    .getAttribute('d')
    .then((d) => d ?? '')

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'print rendering is a Chromium behaviour; the other engines would assert the same',
  )
})

test('the sheet carries the wall’s QR, fits one page, and the console stays off paper', async ({
  app,
  surfaces,
}) => {
  const { host, projector } = surfaces
  const event = await app.seedEvent({ slug: 'impression', name: 'Camille & Sacha' })

  // The wall's own drawing of the join link, with the same quiet zone and level.
  await projector.goto(app.url(`/e/${event.slug}/display`))
  const wallQr = projector.getByTestId('wall-empty').locator('svg')
  await expect(wallQr).toBeVisible()
  const wallPath = await pathOf(wallQr)
  // The link the API gives, read back rather than assumed.
  const read = await host.request.get(app.url(`/api/events/${event.slug}`))
  const { joinUrl } = (await read.json()) as { joinUrl: string }

  await host.goto(app.url(`/admin/events/${event.slug}/print`))
  await expect(host.getByRole('heading', { name: 'Cartes de table et affiche' })).toBeVisible()
  const sheet = host.locator('[data-format]')

  for (const format of FORMATS) {
    await host.emulateMedia({ media: 'screen' })
    await host.getByRole('radio', { name: format.name }).check()
    await expect(sheet.getByRole('img', { name: /QR/ })).toHaveCount(format.copies)
    expect(await pathOf(sheet.getByRole('img', { name: /QR/ }).first())).toBe(wallPath)

    await host.emulateMedia({ media: 'print' })
    // One sheet is one page.
    const box = await sheet.boundingBox()
    expect(box?.height ?? Infinity).toBeLessThanOrEqual(A4_HEIGHT_PX + 1)
    // The console's header, footer and settings do not print.
    await expect(host.locator('header')).toBeHidden()
    await expect(host.locator('footer')).toBeHidden()
    await expect(host.getByRole('button', { name: 'Imprimer' })).toBeHidden()
    await expect(sheet).toBeVisible()
    // A reader finds the server's link in what the paper shows.
    expect(await decodeQr(sheet.getByRole('img', { name: /QR/ }).first())).toBe(joinUrl)
  }
})
