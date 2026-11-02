import { describe, expect, it } from 'vitest'
import TOKENS from '../../../design-system/tokens.css?raw'
import {
  INK_CHROMA,
  INK_LIGHTNESS,
  MIN_MODULE_MM,
  PRINT_FORMAT_SPECS,
  QUIET_ZONE_MODULES,
} from './printKit'

/**
 * `printKit.ts` judges the printed module against the QR sides the stylesheet draws. The two
 * are written twice (the web cannot read a custom property in a pure module), so this test
 * reads `tokens.css` and fails when they diverge, in either direction: a side changed in
 * the stylesheet only would print a QR the 0.6 mm rule never measured.
 *
 * The availability by status is held against the domain by a server-side test,
 * `src/interface/http/presenters/printKitContract.test.ts`.
 */
const token = (name: string): number => {
  const found = new RegExp(`${name}:\\s*([0-9.]+);`).exec(TOKENS)
  if (found?.[1] === undefined) throw new Error(`${name} is not a plain number in tokens.css`)
  return Number(found[1])
}

describe('printKit against tokens.css', () => {
  it('draws each QR at the side printKit measures it at', () => {
    expect(token('--print-qr-card')).toBe(PRINT_FORMAT_SPECS.card.qrMm)
    expect(token('--print-qr-a5')).toBe(PRINT_FORMAT_SPECS.a5.qrMm)
    expect(token('--print-qr-a4')).toBe(PRINT_FORMAT_SPECS.a4.qrMm)
  })

  it('fits the copies of each format inside an A4 sheet', () => {
    const w = token('--print-a4-w')
    const h = token('--print-a4-h')
    expect(2 * token('--print-card-w')).toBe(w)
    expect(2 * token('--print-card-h')).toBe(h)
    // The side of the QR plus the safety margins must fit the narrowest cell.
    expect(PRINT_FORMAT_SPECS.card.qrMm + 2 * token('--print-safe')).toBeLessThanOrEqual(
      token('--print-card-w'),
    )
  })

  it('inks the event colour at the lightness and chroma printKit measures', () => {
    const found = /--print-ink-accent:\s*oklch\(([\d.]+)%\s+([\d.]+)\s+var\(--accent-hue\)\)/.exec(
      TOKENS,
    )
    if (found?.[1] === undefined || found[2] === undefined) {
      throw new Error('--print-ink-accent is not an oklch of the accent hue in tokens.css')
    }

    expect(Number(found[1]) / 100).toBe(INK_LIGHTNESS)
    expect(Number(found[2])).toBe(INK_CHROMA)
  })

  it('has constants worth contracting', () => {
    expect(QUIET_ZONE_MODULES).toBe(4)
    expect(MIN_MODULE_MM).toBe(0.6)
  })
})
