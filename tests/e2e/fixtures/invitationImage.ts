import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { fr } from '../../../web/src/lib/i18n/fr'

const text = fr.guestInvite.image

/** The PNG the "Télécharger l'image" button hands over, once the page says it is ready. */
export const downloadedInvitationImage = async (page: Page): Promise<Buffer> => {
  const button = page.getByRole('button', { name: text.download })
  await expect(button).toBeEnabled({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  return readFile(await download.path())
}

/** How many pixels two pictures of the same size draw differently (a channel off by more than 60). */
export const differingPixels = async (a: Buffer, b: Buffer): Promise<number> => {
  const raw = (png: Buffer) => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const [left, right] = await Promise.all([raw(a), raw(b)])
  expect([left.info.width, left.info.height]).toEqual([right.info.width, right.info.height])
  const channels = left.info.channels
  let differing = 0
  for (let pixel = 0; pixel < left.data.length; pixel += channels) {
    for (let channel = 0; channel < channels; channel += 1) {
      if (Math.abs((left.data[pixel + channel] ?? 0) - (right.data[pixel + channel] ?? 0)) > 60) {
        differing += 1
        break
      }
    }
  }
  return differing
}

/**
 * Takes a font away from the page, the way a font that failed to load is gone: its `@font-face`
 * rules are deleted, so the text falls back and `html-to-image` finds nothing to embed for it. (A
 * network refusal would not do: the service worker answers the font requests itself.)
 */
export const forgetFont = (page: Page, family: string): Promise<number> =>
  page.evaluate((name) => {
    let removed = 0
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (let index = rules.length - 1; index >= 0; index -= 1) {
        const rule = rules[index]
        if (rule instanceof CSSFontFaceRule && rule.style.fontFamily.includes(name)) {
          sheet.deleteRule(index)
          removed += 1
        }
      }
    }
    return removed
  }, family)

/**
 * Proves the card's own typeface is in a downloaded picture, not a stand-in: the same card is made
 * again with the Anton font taken away, and the two pictures must differ where the title is
 * written (a QR that decodes and a picture that is not one flat colour are true of a picture drawn
 * in the fallback face as well). `reopen` loads the page on the print tab with the design chosen;
 * `imageTab` opens the Image tab.
 */
export const imageDependsOnItsFonts = async (
  page: Page,
  withFonts: Buffer,
  reopen: () => Promise<void>,
  imageTab: () => Promise<void>,
): Promise<void> => {
  await reopen()
  expect(
    await forgetFont(page, 'Anton'),
    'the page declares the font that is taken away',
  ).toBeGreaterThan(0)
  await imageTab()
  const withoutFont = await downloadedInvitationImage(page)
  // A title of a few hundred by a hundred pixels: well over 2 000 pixels change, none by chance.
  expect(await differingPixels(withFonts, withoutFont)).toBeGreaterThan(2_000)
}

/**
 * How far a downloaded picture is from what the page shows of it: both are brought down to 48 by
 * 48 and the mean difference of the channels is returned (0 to 255). A shape that is drawn black,
 * a photograph that is missing or a ground that is not there is a large number; two renderings of
 * the same card differ by a few.
 */
export const distanceFromPreview = async (page: Page, png: Buffer): Promise<number> => {
  const preview = await page.locator('[data-invite-shot]').screenshot()
  const small = (image: Buffer) =>
    sharp(image).removeAlpha().resize(48, 48, { fit: 'fill' }).raw().toBuffer()
  const [left, right] = await Promise.all([small(png), small(preview)])
  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
  }
  return total / left.length
}

/** A flat orange photograph: anything drawn black or blank in its place is far from it. */
export const orangePhoto = (): Promise<Buffer> =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 230, g: 120, b: 60 } } })
    .jpeg()
    .toBuffer()

export const DESIGN_NAMES = [
  'Essentiel',
  'Ticket de caisse',
  'Souvenir',
  'Billet',
  'Carte d’embarquement',
  'Guirlande',
] as const
