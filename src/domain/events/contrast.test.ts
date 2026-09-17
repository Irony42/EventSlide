import { describe, expect, it } from 'vitest'
import { contrastRatio, hueDistance } from './contrast'

/**
 * The arithmetic behind the theming rule, checked against values that can be verified by
 * hand rather than against the palette it is used on.
 *
 * `eventTheme.test.ts` is where the product's own colours are judged; this file only has
 * to prove that the function reports what WCAG says it should, because every judgement
 * made anywhere else rests on it.
 */

const BLACK = { l: 0, c: 0, h: 0 }
const WHITE = { l: 1, c: 0, h: 0 }

describe('contrastRatio', () => {
  it('reports 21:1 for black on white, WCAG’s maximum', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 1)
  })

  it('reports 1:1 for a colour against itself', () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5)
  })

  it('does not care which colour is named first', () => {
    const accent = { l: 0.72, c: 0.17, h: 305 }
    const ink = { l: 0.18, c: 0.02, h: 305 }

    expect(contrastRatio(accent, ink)).toBeCloseTo(contrastRatio(ink, accent), 10)
  })

  it('clamps a wide-gamut colour into sRGB rather than flattering the ratio', () => {
    // An oklch chroma this high at this lightness is outside sRGB, so at least one
    // linear channel comes out negative. Unclamped it would drag the luminance below
    // zero and report a ratio better than the display can actually show.
    const outOfGamut = { l: 0.7, c: 0.4, h: 140 }

    expect(contrastRatio(outOfGamut, BLACK)).toBeLessThanOrEqual(21)
    expect(contrastRatio(outOfGamut, BLACK)).toBeGreaterThanOrEqual(1)
  })

  it('agrees with the value docs/DESIGN-SYSTEM.md section 8 records for the accent pair', () => {
    // 7.12:1 for --accent-contrast on --accent. A number the design system published
    // before this module existed, so it is an independent check on the conversion.
    const measured = contrastRatio({ l: 0.18, c: 0.02, h: 305 }, { l: 0.72, c: 0.17, h: 305 })

    expect(measured).toBeCloseTo(7.12, 1)
  })
})

describe('hueDistance', () => {
  it('measures the short way round, not the arithmetic difference', () => {
    // The whole reason this function exists: 350 and 10 are twenty degrees apart to an
    // eye and three hundred and forty apart to a subtraction.
    expect(hueDistance(350, 10)).toBe(20)
  })

  it('is the plain difference when the two are on the same side of the wheel', () => {
    expect(hueDistance(305, 155)).toBe(150)
  })

  it('does not care which hue is named first', () => {
    expect(hueDistance(10, 350)).toBe(hueDistance(350, 10))
  })

  it('is zero for a hue against itself', () => {
    expect(hueDistance(85, 85)).toBe(0)
  })

  it('caps at 180, the far side of the wheel', () => {
    expect(hueDistance(0, 180)).toBe(180)
  })
})
