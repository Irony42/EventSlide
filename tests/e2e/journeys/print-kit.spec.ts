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
 * **No QR decoder yet.** The repository carries no decoder (a devDependency needs `npm install`,
 * which a worktree must not run). The QR is instead compared with the one the projected wall
 * draws for the same event, from its own response: two surfaces, two reads of the join link,
 * one drawing. That proves "the sheet carries the server's link", not "a phone reads it":
 * decoding stays a to-do (spec 02, question 7) and the real print-out the judge.
 */

/** An A4 page is 297 mm high; 1 mm is 96 / 25.4 CSS pixels. */
const A4_HEIGHT_PX = (297 * 96) / 25.4

const FORMATS = [
  { name: 'Cartes de table A6 (4 par feuille)', copies: 4 },
  { name: 'Affiche A5 (2 par feuille)', copies: 2 },
  { name: 'Affiche A4 (1 par feuille)', copies: 1 },
] as const

const pathOf = (qr: Locator): Promise<string> =>
  qr
    .locator('path')
    .last()
    .getAttribute('d')
    .then((d) => d ?? '')

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
  }
})
