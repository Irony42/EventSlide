import { describe, expect, it } from 'vitest'
import TOKENS from '../../../design-system/tokens.css?raw'
import { parseOklchTokens, ratioOf, srgb, WHITE } from '../../../design-system/testing/srgb'
import {
  INK_CHROMA,
  INK_LIGHTNESS,
  MIN_INK_CONTRAST,
  MIN_MODULE_MM,
  PRINT_FORMATS,
  PRINT_FORMAT_SPECS,
  availabilityOf,
  LOGO_MAX_SHARE,
  hueOfHex,
  isHexColour,
  isQrTooSmall,
  moduleMm,
  qrMmOf,
  qrLevelOf,
  totalModulesOf,
} from './printKit'
import { PRINT_DESIGNS, qrShareOf } from '../../../lib/print/printDesigns'

/** Module counts of the rendered SVG, quiet zone (4 + 4) included: versions 4, 10 and 11. */
const V4 = 33 + 8
const V10 = 57 + 8
const V11 = 61 + 8

describe('print formats', () => {
  it('puts 4, 2 and 1 copies on a sheet for the card, the A5 and the A4', () => {
    expect(PRINT_FORMAT_SPECS.card.perSheet).toBe(4)
    expect(PRINT_FORMAT_SPECS.a5.perSheet).toBe(2)
    expect(PRINT_FORMAT_SPECS.a4.perSheet).toBe(1)
    expect(PRINT_FORMATS).toEqual(['card', 'a5', 'a4'])
  })

  it('prints portrait cards 105, 148.5 and 210 mm wide, the two A5 on a landscape sheet', () => {
    expect(PRINT_FORMAT_SPECS.card).toMatchObject({ cardMm: 105, landscape: false })
    expect(PRINT_FORMAT_SPECS.a5).toMatchObject({ cardMm: 148.5, landscape: true })
    expect(PRINT_FORMAT_SPECS.a4).toMatchObject({ cardMm: 210, landscape: false })
  })

  it('sizes the QR as the share of the card width the design declares, quiet zone included', () => {
    expect(qrMmOf('card', 0.4)).toBeCloseTo(42, 9)
    expect(qrMmOf('a5', 0.4)).toBeCloseTo(59.4, 9)
    expect(qrMmOf('a4', 0.4)).toBeCloseTo(84, 9)
  })
})

/** The smallest code any design draws: the one the readability rule must hold for. */
const SMALLEST = Math.min(...PRINT_DESIGNS.map(qrShareOf))

describe('module size', () => {
  it('divides the side by the modules of the rendered SVG', () => {
    expect(moduleMm(40, 65)).toBeCloseTo(0.615, 3)
  })

  it('keeps a version 4 and a version 10 link on the smallest code of any card', () => {
    expect(SMALLEST).toBe(0.39)
    expect(isQrTooSmall('card', SMALLEST, V4)).toBe(false)
    expect(isQrTooSmall('card', SMALLEST, V10)).toBe(false)
  })

  it('warns from version 11 on that card', () => {
    expect(isQrTooSmall('card', SMALLEST, V11)).toBe(true)
  })

  it('sits on the threshold at 68 modules and below it at 69', () => {
    // 40.95 / 68 = 0.602 mm; 40.95 / 69 = 0.593 mm.
    expect(isQrTooSmall('card', SMALLEST, 68)).toBe(false)
    expect(isQrTooSmall('card', SMALLEST, 69)).toBe(true)
    expect(MIN_MODULE_MM).toBe(0.6)
  })

  it('never warns on the posters for the longest link the card accepts', () => {
    expect(isQrTooSmall('a5', SMALLEST, V11)).toBe(false)
    expect(isQrTooSmall('a4', SMALLEST, V11)).toBe(false)
  })
})

describe('totalModulesOf', () => {
  const svg = (viewBox: string | null): Element => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    if (viewBox !== null) element.setAttribute('viewBox', viewBox)
    return element
  }

  it('reads the square viewBox of the library', () => {
    expect(totalModulesOf(svg('0 0 41 41'))).toBe(41)
  })

  it('answers null for anything else, so a changed library fails loudly', () => {
    expect(totalModulesOf(null)).toBeNull()
    expect(totalModulesOf(svg(null))).toBeNull()
    expect(totalModulesOf(svg('0 0 41'))).toBeNull()
    expect(totalModulesOf(svg('0 0 41 40'))).toBeNull()
    expect(totalModulesOf(svg('1 0 41 41'))).toBeNull()
    expect(totalModulesOf(svg('0 0 41.5 41.5'))).toBeNull()
  })
})

describe('availability by status', () => {
  it('prints a live event without a notice', () => {
    expect(availabilityOf('live')).toBe('ready')
  })

  it('prints a draft and a closed event, each with its own notice', () => {
    expect(availabilityOf('draft')).toBe('draft')
    expect(availabilityOf('closed')).toBe('closed')
  })

  it('prints nothing for an archived event', () => {
    expect(availabilityOf('archived')).toBe('unavailable')
  })
})

describe('the ink of the QR on white paper', () => {
  it('keeps the event colour at a contrast of 7 or more for each of the 360 hues', () => {
    // The colour is clipped channel by channel, as the design system's own contrast sweeps do.
    const ratios = Array.from({ length: 360 }, (_unused, h) =>
      ratioOf(srgb({ l: INK_LIGHTNESS, c: INK_CHROMA, h, alpha: 1 }), WHITE),
    )

    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST)
  })

  it('keeps the black ink (--text-print) at a contrast of 7 or more', () => {
    const ink = parseOklchTokens(TOKENS).get('--text-print')
    if (ink === undefined) throw new Error('--text-print is not an oklch token')

    expect(ratioOf(srgb(ink), WHITE)).toBeGreaterThanOrEqual(MIN_INK_CONTRAST)
  })
})

describe('the logo at the centre of the QR', () => {
  it('asks for the highest error correction when a logo covers the centre, and only then', () => {
    expect(qrLevelOf(true)).toBe('H')
    expect(qrLevelOf(false)).toBe('M')
  })

  it('takes at most a fifth of the side, which is 4 % of the area', () => {
    expect(LOGO_MAX_SHARE).toBe(0.2)
  })
})

describe('the hue of a colour the host picks', () => {
  it('reads #rrggbb as an oklch hue, the way the design system draws its accents', () => {
    expect(hueOfHex('#ff0000')).toBe(29)
    expect(hueOfHex('#00ff00')).toBe(142)
    expect(hueOfHex('#0000ff')).toBe(264)
  })

  it('refuses anything that is not six hex digits', () => {
    expect(hueOfHex('red')).toBeNull()
    expect(hueOfHex('#fff')).toBeNull()
    expect(isHexColour('#A1b2C3')).toBe(true)
    expect(isHexColour('#a1b2c')).toBe(false)
    expect(isHexColour('url(x)')).toBe(false)
  })
})
