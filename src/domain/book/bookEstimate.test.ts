import { describe, expect, it } from 'vitest'
import { asPhotoId } from '../shared/ids'
import { BOOK_PRINT_MAX_BYTES } from './bookCaps'
import {
  BOOK_BYTES_PER_PIXEL,
  BOOK_PRINT_DPI,
  BOOK_SCREEN_DPI,
  estimatePlanBytes,
  estimatePlanPixels,
} from './bookEstimate'

const slot = (n: number) => Array.from({ length: n }, (_, i) => ({ photoId: asPhotoId(`p${i}`) }))

describe('estimatePlanPixels', () => {
  it('counts the cover alone for a plan with no photograph page', () => {
    // 210 mm at 150 dpi is 1240 px
    expect(estimatePlanPixels([{ template: 'title', slots: [] }], BOOK_SCREEN_DPI)).toBeCloseTo(
      (210 / 25.4) * 150 * ((210 / 25.4) * 150),
      0,
    )
  })

  it('adds each filled slot at its own size: a full page is the cover again', () => {
    const cover = estimatePlanPixels([], BOOK_SCREEN_DPI)
    expect(estimatePlanPixels([{ template: 'full', slots: slot(1) }], BOOK_SCREEN_DPI)).toBeCloseTo(
      2 * cover,
      0,
    )
  })

  it('counts only the slots a page really fills (a favourites page of three)', () => {
    const cover = estimatePlanPixels([], BOOK_SCREEN_DPI)
    const three = estimatePlanPixels([{ template: 'favourites', slots: slot(3) }], BOOK_SCREEN_DPI)
    const five = estimatePlanPixels([{ template: 'favourites', slots: slot(5) }], BOOK_SCREEN_DPI)
    expect(three).toBeGreaterThan(cover)
    expect(five).toBeGreaterThan(three)
  })

  it('counts a double-page photograph for twice a page', () => {
    const cover = estimatePlanPixels([], BOOK_SCREEN_DPI)
    expect(estimatePlanPixels([{ template: 'wide', slots: slot(1) }], BOOK_SCREEN_DPI)).toBeCloseTo(
      3 * cover,
      0,
    )
  })

  it('grows with the square of the resolution', () => {
    const pages = [{ template: 'single' as const, slots: slot(1) }]
    expect(
      estimatePlanPixels(pages, BOOK_PRINT_DPI) / estimatePlanPixels(pages, BOOK_SCREEN_DPI),
    ).toBeCloseTo(4, 6)
  })
})

describe('estimatePlanBytes', () => {
  it('is the pixels times the measured bytes a pixel, rounded up', () => {
    const pages = [{ template: 'heroTwo' as const, slots: slot(3) }]
    expect(estimatePlanBytes(pages, BOOK_SCREEN_DPI)).toBe(
      Math.ceil(estimatePlanPixels(pages, BOOK_SCREEN_DPI) * BOOK_BYTES_PER_PIXEL),
    )
  })

  it('puts a 100-page printer interior well under the 700 MB ceiling, and a 200-page one near it', () => {
    const page = { template: 'heroTwo' as const, slots: slot(3) }
    const hundred = estimatePlanBytes(
      Array.from({ length: 100 }, () => page),
      BOOK_PRINT_DPI,
    )
    const twoHundred = estimatePlanBytes(
      Array.from({ length: 200 }, () => page),
      BOOK_PRINT_DPI,
    )
    expect(hundred).toBeLessThan(BOOK_PRINT_MAX_BYTES)
    expect(twoHundred).toBeGreaterThan(hundred)
  })
})
