import { describe, expect, it } from 'vitest'
import TOKENS from './tokens.css?raw'
import MATERIAL from './glass.module.css?raw'
import { ambianceBlock, parseOklchTokens, ratioOf, srgb, withoutAmbiances } from './testing/srgb'

/**
 * Clear glass, PROTOTYPE (ADR 0010, "Proposed amendment, not merged").
 *
 * The old rule measured legibility where the pane is: text sat on the tint, so the tint had to be
 * 80-96% opaque and the glass was invisible. The amendment measures it where the text is: every
 * word on a clear pane stands on a chip, so the pane may be anything. This file holds the two halves
 * of that claim that a stylesheet can prove (the browser half, "every text node of the composer has
 * an opaque painted ancestor", is `tests/e2e/journeys/glass-chips.spec.ts`, because jsdom paints
 * nothing):
 *
 * 1. the chip is opaque, whatever the backdrop, and is the surface the three inks are already
 *    measured on in `tokens.contrast.test.ts`;
 * 2. the pane's own transparency is a token pair that every opaque tier switches off.
 */

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const RULES = withoutComments(TOKENS)
const MATERIAL_RULES = withoutComments(MATERIAL)

const ruleBody = (css: string, selector: string): string => {
  const from = css.indexOf(`${selector} {`)
  expect(from, `${selector} is missing`).toBeGreaterThanOrEqual(0)
  return css.slice(css.indexOf('{', from) + 1, css.indexOf('}', from))
}

describe('a chip is opaque, so the bar is measured on the chip and never on the backdrop', () => {
  const chip = ruleBody(MATERIAL_RULES, '.chip')

  it('is painted with --surface-raised and nothing translucent', () => {
    expect(chip).toMatch(/background:\s*var\(--surface-raised\)\s*;/)
    expect(chip).not.toMatch(/color-mix|rgba|oklch|opacity|\/\s*0?\./)
  })

  // The six dark ambiances plus the one light one, at the bars of DESIGN-SYSTEM.md section 8.
  const BARS = [
    ['--text-primary', 12],
    ['--text-secondary', 7],
    ['--text-muted', 4.5],
  ] as const

  describe.each(['eventslide', 'guinguette', 'riviera', 'champs', 'bivouac', 'cabaret', 'noces'])(
    'in the %s ambiance',
    (name) => {
      const body = name === 'eventslide' ? withoutAmbiances(TOKENS) : ambianceBlock(TOKENS, name)
      const own = parseOklchTokens(`:root {${body.replaceAll('var(--accent-hue)', '305')}}`)

      it.each(BARS)('keeps %s above its bar on a chip, whatever is behind it', (ink, bar) => {
        const ink_ = own.get(ink)
        const chip_ = own.get('--surface-raised')
        if (ink_ === undefined || chip_ === undefined) throw new Error(`${name} lacks ${ink}`)
        // Opaque: the backdrop does not enter the sum, so over white and over black it is one number.
        expect(ratioOf(srgb(ink_), srgb(chip_))).toBeGreaterThanOrEqual(bar)
      })
    },
  )
})

describe('the clear pane is transparent by token, and every opaque tier takes it back', () => {
  it('declares a pane that really is transparent: a light tint, a strong blur', () => {
    const alpha = Number(/--glass-clear-alpha:\s*(\d+)%/.exec(RULES)?.[1])
    const blur = Number(/--glass-clear-blur:\s*(\d+)px/.exec(RULES)?.[1])
    const saturate = Number(/--glass-clear-saturate:\s*(\d+)%/.exec(RULES)?.[1])
    expect(alpha).toBeGreaterThanOrEqual(15)
    expect(alpha).toBeLessThanOrEqual(45)
    expect(blur).toBeGreaterThanOrEqual(24)
    expect(saturate).toBeGreaterThanOrEqual(160)
  })

  it.each([
    ['no backdrop-filter', /@supports not \(\(backdrop-filter:[^{]*\{/],
    [
      'reduced transparency or more contrast',
      /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{/,
    ],
  ] as const)('is opaque, unfiltered and unveiled under %s', (_reason, pattern) => {
    const from = RULES.search(pattern)
    expect(from).toBeGreaterThanOrEqual(0)
    const block = RULES.slice(from, RULES.indexOf('}', RULES.indexOf('{', from + 40) + 1))
    expect(block).toMatch(/--glass-clear-filter:\s*none;/)
    expect(block).toMatch(/--glass-clear-alpha:\s*100%;/)
    expect(block).toMatch(/--glass-clear-sheen:\s*0%;/)
  })

  it("is opaque, unfiltered and unveiled in the room's and the host's `plain` tier", () => {
    const tier = ruleBody(RULES, "[data-glass='opaque']")
    expect(tier).toMatch(/--glass-clear-filter:\s*none;/)
    expect(tier).toMatch(/--glass-clear-alpha:\s*100%;/)
    expect(tier).toMatch(/--glass-clear-sheen:\s*0%;/)
  })

  it('is composed in the material from the element’s own surface, with an opaque first paint', () => {
    const clear = ruleBody(MATERIAL_RULES, '.clear')
    // The first declaration is what a browser without `color-mix` keeps.
    expect(clear).toMatch(/background:\s*var\(--surface-raised\);[\s\S]*color-mix/)
    expect(clear).toMatch(/-webkit-backdrop-filter:\s*var\(--glass-clear-filter\)/)
    expect(clear).toMatch(/\n\s*backdrop-filter:\s*var\(--glass-clear-filter\)/)
  })
})
