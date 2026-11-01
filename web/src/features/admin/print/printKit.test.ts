import { describe, expect, it } from 'vitest'
import {
  MIN_MODULE_MM,
  PRINT_FORMATS,
  PRINT_FORMAT_SPECS,
  availabilityOf,
  isQrTooSmall,
  moduleMm,
  totalModulesOf,
} from './printKit'

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

  it('draws the QR 4, 7 and 12 cm wide, quiet zone included', () => {
    expect(PRINT_FORMAT_SPECS.card.qrMm).toBe(40)
    expect(PRINT_FORMAT_SPECS.a5.qrMm).toBe(70)
    expect(PRINT_FORMAT_SPECS.a4.qrMm).toBe(120)
  })
})

describe('module size', () => {
  it('divides the side by the modules of the rendered SVG', () => {
    expect(moduleMm(40, 65)).toBeCloseTo(0.615, 3)
  })

  it('keeps a version 4 and a version 10 link on the 4 cm card', () => {
    expect(isQrTooSmall('card', V4)).toBe(false)
    expect(isQrTooSmall('card', V10)).toBe(false)
  })

  it('warns from version 11 on the 4 cm card', () => {
    expect(isQrTooSmall('card', V11)).toBe(true)
  })

  it('sits exactly on the threshold at 66 modules and below it at 67', () => {
    // 40 / 66 = 0.606 mm; 40 / 67 = 0.597 mm.
    expect(isQrTooSmall('card', 66)).toBe(false)
    expect(isQrTooSmall('card', 67)).toBe(true)
    expect(MIN_MODULE_MM).toBe(0.6)
  })

  it('never warns on the poster for the longest link the card accepts', () => {
    expect(isQrTooSmall('a5', V11)).toBe(false)
    expect(isQrTooSmall('a4', V11)).toBe(false)
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
