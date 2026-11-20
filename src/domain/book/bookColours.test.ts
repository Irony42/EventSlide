import { describe, expect, it } from 'vitest'
import { CURATED_ACCENT_HUES } from '../events/eventTheme'
import {
  MIN_TEXT_CONTRAST,
  contrastOfHex,
  legibleAccent,
  luminanceOfHex,
  oklchToHex,
  oklchToSrgb,
  srgbToHex,
} from './bookColours'
import { BOOK_STYLES } from './bookOptionsV2'
import { BOOK_STYLE_DEFS, polaroidRotation, resolveBookColours } from './bookStyles'

const near = (actual: number, expected: number, tolerance = 1): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

describe('oklchToSrgb', () => {
  it('maps white and black', () => {
    expect(oklchToSrgb({ l: 1, c: 0, h: 0 })).toEqual({ r: 255, g: 255, b: 255 })
    expect(oklchToSrgb({ l: 0, c: 0, h: 0 })).toEqual({ r: 0, g: 0, b: 0 })
  })
  it('maps the CSS sRGB primaries back to themselves', () => {
    const red = oklchToSrgb({ l: 0.62796, c: 0.25768, h: 29.234 })
    near(red.r, 255)
    near(red.g, 0)
    near(red.b, 0)
    const blue = oklchToSrgb({ l: 0.452, c: 0.313, h: 264.052 })
    near(blue.b, 255)
    near(blue.r, 0)
  })
  it('uses the linear segment of the transfer curve for a very dark colour', () => {
    const dark = oklchToSrgb({ l: 0.05, c: 0, h: 0 })
    expect(dark.r).toBeLessThan(10)
    expect(dark.r).toBe(dark.g)
  })
  it('clamps a colour outside the gamut instead of overflowing', () => {
    const wild = oklchToSrgb({ l: 0.7, c: 0.4, h: 140 })
    for (const channel of Object.values(wild)) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(255)
    }
  })
  it('writes hex with two digits a channel', () => {
    expect(srgbToHex({ r: 0, g: 10, b: 255 })).toBe('#000aff')
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff')
  })
})

describe('resolveBookColours', () => {
  it('gives a hex accent for every curated hue, distinct from the paper', () => {
    for (const hue of Object.values(CURATED_ACCENT_HUES)) {
      for (const style of BOOK_STYLES) {
        const colours = resolveBookColours(style, hue)
        for (const value of [colours.accent, colours.accentStrong, colours.accentInk]) {
          expect(value).toMatch(/^#[0-9a-f]{6}$/)
        }
        expect(colours.accent).not.toBe(colours.paper)
        expect(colours.paper).toBe(BOOK_STYLE_DEFS[style].paper)
      }
    }
  })
  it('moves with the hue', () => {
    expect(resolveBookColours('magazine', 345).accent).not.toBe(
      resolveBookColours('magazine', 195).accent,
    )
  })
})

describe('styles as data', () => {
  it('allow full bleed only in Magazine and polaroids only in Souvenir', () => {
    expect(BOOK_STYLES.filter((s) => BOOK_STYLE_DEFS[s].fullBleed)).toEqual(['magazine'])
    expect(BOOK_STYLES.filter((s) => BOOK_STYLE_DEFS[s].polaroid)).toEqual(['souvenir'])
    expect(BOOK_STYLES.filter((s) => BOOK_STYLE_DEFS[s].wide)).toEqual(['magazine', 'souvenir'])
  })
})

describe('polaroidRotation', () => {
  it('is the same for the same photograph and within -4 and +4 degrees', () => {
    const angles = Array.from({ length: 500 }, (_, i) => polaroidRotation(`photo-${i}`))
    expect(polaroidRotation('photo-7')).toBe(polaroidRotation('photo-7'))
    for (const angle of angles) {
      expect(angle).toBeGreaterThanOrEqual(-4)
      expect(angle).toBeLessThanOrEqual(4)
    }
    expect(Math.min(...angles)).toBeLessThan(-3)
    expect(Math.max(...angles)).toBeGreaterThan(3)
    expect(new Set(angles).size).toBeGreaterThan(100)
  })
})

describe('contrast of the text accent', () => {
  it('measures white against black as 21 and a colour against itself as 1', () => {
    expect(luminanceOfHex('#ffffff')).toBeCloseTo(1, 6)
    expect(luminanceOfHex('#000000')).toBe(0)
    expect(contrastOfHex('#ffffff', '#000000')).toBeCloseTo(21, 6)
    expect(contrastOfHex('#000000', '#ffffff')).toBeCloseTo(21, 6)
    expect(contrastOfHex('#336699', '#336699')).toBe(1)
  })

  it('is at least 4.5 to 1 against the paper of each style, for every curated hue and the whole wheel', () => {
    const hues = [
      ...Object.values(CURATED_ACCENT_HUES),
      ...Array.from({ length: 36 }, (_, i) => i * 10),
    ]
    for (const style of BOOK_STYLES) {
      for (const hue of hues) {
        const colours = resolveBookColours(style, hue)
        expect(
          contrastOfHex(colours.accentText, colours.paper),
          style + ' ' + hue,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('asks for AA contrast, 4.5 to 1', () => {
    expect(MIN_TEXT_CONTRAST).toBe(4.5)
  })

  it('keeps the light tone of the accent for rules and tape: it is the one that fails on kraft', () => {
    const colours = resolveBookColours('souvenir', 345)
    expect(contrastOfHex(colours.accent, colours.paper)).toBeLessThan(MIN_TEXT_CONTRAST)
    expect(colours.accentText).not.toBe(colours.accent)
  })

  it('does not darken a tone that already reads', () => {
    expect(legibleAccent(250, '#ffffff', 0.17)).toBe(oklchToHex({ l: 0.55, c: 0.17, h: 250 }))
  })
})
