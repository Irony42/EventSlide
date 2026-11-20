import { describe, expect, it } from 'vitest'
import TOKENS from '../../../design-system/tokens.css?raw'
import CARD_CSS from './PrintCard.module.css?raw'
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
  it('cuts the sheet into the card widths printKit measures the QR on', () => {
    expect(token('--print-card-w')).toBe(PRINT_FORMAT_SPECS.card.cardMm)
    expect(token('--print-card-h')).toBe(PRINT_FORMAT_SPECS.a5.cardMm)
    expect(token('--print-a4-w')).toBe(PRINT_FORMAT_SPECS.a4.cardMm)
  })

  it('fits the copies of each format inside an A4 sheet', () => {
    const w = token('--print-a4-w')
    const h = token('--print-a4-h')
    expect(2 * token('--print-card-w')).toBe(w)
    expect(2 * token('--print-card-h')).toBe(h)
    // Two A5 portraits side by side fill the A4 turned landscape.
    expect(2 * PRINT_FORMAT_SPECS.a5.cardMm).toBe(h)
  })

  it('sizes every printed QR from --qr-share, the number printDesigns declares, and from nothing else', () => {
    const css = CARD_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    const qrRule = rules.find(([, selector]) => selector?.trim() === '.qr')
    expect(qrRule?.[2]).toMatch(/inline-size:\s*calc\(var\(--qr-share\) \* 100cqw\)/)
    const resized = rules.filter(
      ([, selector, body]) =>
        (selector ?? '').split(',').some((part) => /\.qr\s*$/.test(part)) &&
        selector?.trim() !== '.qr' &&
        /(inline-size|width)\s*:/.test(body ?? ''),
    )
    expect(resized.map(([, selector]) => selector?.trim())).toEqual([])
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
