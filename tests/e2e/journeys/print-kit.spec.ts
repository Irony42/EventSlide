import { jpegWithLocation } from '../fixtures/media'
import { expect, test } from '../fixtures/app'
import { decodeQr } from '../fixtures/qrDecode'
import { openAppearance } from '../fixtures/settingsPage'
import type { Locator, Page } from '@playwright/test'

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
  { name: 'Cartes A6 ×4', copies: 4 },
  { name: 'A5 ×2', copies: 2 },
  { name: 'Affiche A4', copies: 1 },
] as const

/** The formats are a segmented control: its radios are drawn as the labels around them. */
const chooseFormat = (page: Page, name: string): Promise<void> =>
  page.getByRole('radiogroup', { name: 'Format' }).getByText(name, { exact: true }).click()

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
  // The Impression entry shows the whole sheet, the thing that is printed.
  await host.getByRole('tab', { name: 'Impression' }).click()
  const sheet = host.locator('[data-format]')

  for (const format of FORMATS) {
    await host.emulateMedia({ media: 'screen' })
    await chooseFormat(host, format.name)
    await expect(sheet.getByRole('img', { name: /QR/ })).toHaveCount(format.copies)
    expect(await pathOf(sheet.getByRole('img', { name: /QR/ }).first())).toBe(wallPath)

    await host.emulateMedia({ media: 'print' })
    // One sheet is one page.
    const box = await sheet.boundingBox()
    expect(box?.height ?? Infinity).toBeLessThanOrEqual(A4_HEIGHT_PX + 1)
    // The console's header, footer and settings do not print.
    await expect(host.locator('header')).toBeHidden()
    await expect(host.locator('footer')).toBeHidden()
    // The host bar is no <header>: named by what it holds, so the check cannot pass on nothing.
    await expect(host.getByRole('button', { name: 'Compte' })).toBeHidden()
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
  await chooseFormat(host, 'Affiche A4')
  const qr = host.locator('[data-format]').getByRole('img', { name: /QR/ }).first()
  const inkOf = () => qr.evaluate((element) => getComputedStyle(element).color)
  const black = await inkOf()

  await host.getByRole('tab', { name: 'Couleurs' }).click()
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
  await openAppearance(host, app.url(`/admin/events/${event.slug}/appearance`))
  await host.getByTestId('logo-input').setInputFiles(await jpegWithLocation('logo'))
  await expect(host.getByRole('img', { name: 'Aperçu du logo de l’évènement' })).toBeVisible()

  await host.goto(app.url(`/admin/events/${event.slug}/print`))
  await chooseFormat(host, 'Affiche A4')
  const qr = host.locator('[data-format]').getByRole('img', { name: /QR/ }).first()
  const plain = await pathOf(qr)
  await host.getByRole('tab', { name: 'Couleurs' }).click()
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

test('printing while the preview shows one card still prints the whole sheet and nothing else', async ({
  app,
  surfaces,
}) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'impression-carte', name: 'Camille & Sacha' })
  await host.goto(app.url(`/admin/events/${event.slug}/print`))
  // The design entry is open: the screen shows one big card.
  await expect(host.getByRole('tab', { name: 'Modèle', selected: true })).toBeVisible()
  await expect(host.locator('[data-format]:visible')).toHaveCount(1)
  await expect(host.locator('[data-format]:visible [data-print-card]')).toHaveCount(1)

  await host.emulateMedia({ media: 'print' })

  // The paper carries the four cards of the sheet, on one page, with none of the workshop around it.
  const sheet = host.locator('[data-format]:visible')
  await expect(sheet).toHaveCount(1)
  await expect(sheet.locator('[data-print-card]')).toHaveCount(4)
  const box = await sheet.boundingBox()
  expect(box?.height ?? Infinity).toBeLessThanOrEqual(A4_HEIGHT_PX + 1)
  await expect(host.getByRole('tablist')).toBeHidden()
  await expect(host.getByRole('tabpanel')).toBeHidden()
  await expect(host.getByRole('button', { name: 'Imprimer' })).toBeHidden()
})
