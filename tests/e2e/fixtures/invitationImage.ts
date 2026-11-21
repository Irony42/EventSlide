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

/** The mean colour of a square block of an image, as [r, g, b]. */
const meanColour = async (
  image: Buffer,
  centre: { x: number; y: number },
  half: number,
): Promise<readonly [number, number, number]> => {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (
    let y = Math.max(0, Math.round(centre.y - half));
    y < Math.min(info.height, centre.y + half);
    y += 1
  ) {
    for (
      let x = Math.max(0, Math.round(centre.x - half));
      x < Math.min(info.width, centre.x + half);
      x += 1
    ) {
      const at = (y * info.width + x) * info.channels
      red += data[at] ?? 0
      green += data[at + 1] ?? 0
      blue += data[at + 2] ?? 0
      count += 1
    }
  }
  return [red / count, green / count, blue / count]
}

const apart = (a: readonly number[], b: readonly number[]): number =>
  Math.max(...a.map((value, index) => Math.abs(value - (b[index] ?? 0))))

/** How far the garland's own parts are from what the page shows of them, in channels (0 to 255). */
export interface GarlandReport {
  readonly parts: Record<string, number>
  /** The share of near-black pixels in the banner of the picture. */
  readonly blackShare: number
  /** How far the photograph's area is from the photograph's colour. */
  readonly photoFromOrange: number
}

/**
 * Looks at the garland of a downloaded picture where it can break: each pennant (yellow, blue,
 * pink, green) and the polaroid's photograph are compared, block by block, with the preview the
 * page draws, and the banner is searched for black. A garland drawn black (the paint of an SVG
 * shape lost in the capture) fails the first; a photograph missing, black or white the second; the
 * third says it plainly. The whole-picture distance alone sits too near its own noise to see it.
 */
export const garlandReport = async (page: Page, png: Buffer): Promise<GarlandReport> => {
  const where = await page.evaluate(() => {
    const node = document.querySelector('[data-invite-shot]') as HTMLElement
    const frame = node.getBoundingClientRect()
    const centre = (element: Element) => {
      const box = element.getBoundingClientRect()
      return {
        x: box.left + box.width / 2 - frame.left,
        y: box.top + box.height / 2 - frame.top,
        size: Math.min(box.width, box.height),
        bottom: box.bottom - frame.top,
      }
    }
    const first = (name: string) => node.querySelector('svg rect[class*="' + name + '"]')
    const card = node.querySelector('[data-print-card]')?.getBoundingClientRect()
    return {
      width: frame.width,
      parts: Object.fromEntries(
        ['glSun', 'glSky', 'glPink', 'glMint', 'glPhotoBack'].map((name) => {
          const element = first(name)
          return [name, element === null ? null : centre(element)]
        }),
      ),
      cardTop: card === undefined ? 0 : card.top - frame.top,
      cardLeft: card === undefined ? 0 : card.left - frame.left,
      cardWidth: card?.width ?? 0,
    }
  })
  const preview = await page.locator('[data-invite-shot]').screenshot()
  const pngScale = ((await sharp(png).metadata()).width ?? 1) / where.width
  const previewScale = ((await sharp(preview).metadata()).width ?? 1) / where.width

  const parts: Record<string, number> = {}
  for (const [name, spot] of Object.entries(where.parts)) {
    if (spot === null) continue
    const half = Math.max(1, spot.size / 5)
    parts[name] = apart(
      await meanColour(png, { x: spot.x * pngScale, y: spot.y * pngScale }, half * pngScale),
      await meanColour(
        preview,
        { x: spot.x * previewScale, y: spot.y * previewScale },
        half * previewScale,
      ),
    )
  }

  const photo = where.parts['glPhotoBack']
  const photoFromOrange =
    photo === null || photo === undefined
      ? 255
      : apart(
          await meanColour(
            png,
            { x: photo.x * pngScale, y: photo.y * pngScale },
            (photo.size / 4) * pngScale,
          ),
          [230, 120, 60],
        )

  // The banner: from the top of the card to the bottom of the polaroid.
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const top = Math.round(where.cardTop * pngScale)
  const bottom = Math.round(((photo?.bottom ?? where.cardTop) as number) * pngScale)
  const left = Math.round(where.cardLeft * pngScale)
  const right = Math.round((where.cardLeft + where.cardWidth) * pngScale)
  let black = 0
  let seen = 0
  for (let y = top; y < Math.min(bottom, info.height); y += 1) {
    for (let x = left; x < Math.min(right, info.width); x += 1) {
      const at = (y * info.width + x) * info.channels
      if (Math.max(data[at] ?? 255, data[at + 1] ?? 255, data[at + 2] ?? 255) < 25) black += 1
      seen += 1
    }
  }
  return { parts, blackShare: seen === 0 ? 0 : black / seen, photoFromOrange }
}

/** The most a picture may be from its preview, per design: the noise of each, and not much more. */
export const DISTANCE_LIMITS: Readonly<
  Record<string, { readonly chromium: number; readonly webkit: number }>
> = {
  Essentiel: { chromium: 4.5, webkit: 5 },
  'Ticket de caisse': { chromium: 5, webkit: 5.5 },
  Souvenir: { chromium: 4.5, webkit: 5.5 },
  Billet: { chromium: 4.5, webkit: 5 },
  'Carte d’embarquement': { chromium: 5, webkit: 6.5 },
  Guirlande: { chromium: 4.5, webkit: 5 },
}
