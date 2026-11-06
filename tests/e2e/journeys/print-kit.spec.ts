import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import sharp from 'sharp'
import { jpegWithLocation } from '../fixtures/media'
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
  // zxing's binariser works on 8-pixel blocks and wants a module a few pixels wide. At 1x the code
  // is about three and a half pixels per module with a fractional origin, so each link (the port
  // and the join code change from one server to the next) was anti-aliased differently and about
  // one in ten was lost; drawn large it is the opposite, a module wider than a block. So the
  // element is painted at four times the size and brought down to a few pixels a module,
  // which is the same image for every link. What is read is still only what the browser paints.
  const modules = await qr.evaluate((element) => {
    const svg = element instanceof SVGSVGElement ? element : element.querySelector('svg')
    return svg?.viewBox.baseVal.width ?? 0
  })
  expect(modules, 'the QR is an SVG with a viewBox in modules').toBeGreaterThan(0)
  const page = qr.page()
  await page.evaluate(() => {
    document.documentElement.style.zoom = '4'
  })
  let png: Buffer
  try {
    png = await qr.screenshot({ omitBackground: true })
  } finally {
    await page.evaluate(() => {
      document.documentElement.style.zoom = ''
    })
  }
  // The binariser still has opinions about the module size, and not the same ones for every
  // link, so the capture is read at a few sizes, the way a phone's camera finds a code by
  // moving: the first size that decodes wins, and what it decodes must still equal the link.
  let failure: unknown = new Error('the QR was not read at any size')
  for (const pixelsPerModule of [4, 2, 3, 5, 6]) {
    const side = Math.ceil(modules) * pixelsPerModule
    const { data, info } = await sharp(png)
      .flatten({ background: '#ffffff' })
      .resize(side, side, { fit: 'fill', kernel: 'lanczos3' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)
    try {
      return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText()
    } catch (error) {
      failure = error
    }
  }
  throw failure
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

test('the event colour reaches the QR ink as a dark colour, the black ink stays the paper’s', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'impression-couleur', name: 'Camille & Sacha' })
  await host.goto(app.url(`/admin/events/${event.slug}/print`))
  await host.getByRole('radio', { name: 'Affiche A4 (1 par feuille)' }).check()
  const qr = host.locator('[data-format]').getByRole('img', { name: /QR/ }).first()
  const inkOf = () => qr.evaluate((element) => getComputedStyle(element).color)
  const black = await inkOf()

  await host.getByRole('radio', { name: 'Couleur de l’évènement' }).check()
  const coloured = await inkOf()

  expect(coloured).not.toBe(black)
  // The colour does not cost the scan: the reader still finds the server's link.
  const read = await host.request.get(app.url(`/api/events/${event.slug}`))
  const { joinUrl } = (await read.json()) as { joinUrl: string }
  expect(await decodeQr(qr)).toBe(joinUrl)
  // Chromium keeps an oklch() colour as written: lightness 0.3, the event's own hue.
  expect(coloured).toMatch(/^oklch\(0\.3 0\.1 305(deg)?\)$/)
})

test('the event logo sits at the centre of the QR at level H, and the reader still finds the link', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'impression-logo', name: 'Camille & Sacha' })
  const read = await host.request.get(app.url(`/api/events/${event.slug}`))
  const { joinUrl } = (await read.json()) as { joinUrl: string }

  // The host's logo, sent on the settings page as in spec 03.
  await host.goto(app.url(`/admin/events/${event.slug}/settings`))
  await host.getByTestId('logo-input').setInputFiles(await jpegWithLocation('logo'))
  await expect(host.getByRole('img', { name: 'Aperçu du logo de l’évènement' })).toBeVisible()

  await host.goto(app.url(`/admin/events/${event.slug}/print`))
  await host.getByRole('radio', { name: 'Affiche A4 (1 par feuille)' }).check()
  const qr = host.locator('[data-format]').getByRole('img', { name: /QR/ }).first()
  const plain = await pathOf(qr)
  await host.getByRole('checkbox', { name: 'Logo de l’évènement au centre du QR' }).check()
  const logo = qr.locator('image')
  await expect(logo).toHaveCount(1)
  // The logo takes at most a fifth of the QR's side, and sits at its centre.
  const box = await qr.boundingBox()
  const logoBox = await logo.boundingBox()
  expect(logoBox?.width ?? Infinity).toBeLessThanOrEqual((box?.width ?? 0) * 0.2 + 1)
  const centreOf = (b: { x: number; width: number } | null) => (b?.x ?? 0) + (b?.width ?? 0) / 2
  expect(Math.abs(centreOf(logoBox) - centreOf(box))).toBeLessThan(2)
  expect(await pathOf(qr)).not.toBe(plain)
  // The picture is really drawn before the screenshot: a blank centre would still decode.
  await host.waitForFunction(
    (src) => {
      const image = document.querySelector<SVGImageElement>(`image[href="${src}"]`)
      return image !== null && image.getBoundingClientRect().width > 0
    },
    await logo.getAttribute('href'),
  )

  await host.emulateMedia({ media: 'print' })
  // Whatever the logo hides, the correction level gives the link back.
  expect(await decodeQr(qr)).toBe(joinUrl)
})
