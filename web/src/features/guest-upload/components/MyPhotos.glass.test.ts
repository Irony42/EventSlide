import { describe, expect, it } from 'vitest'
import MINE from './MyPhotos.module.css?raw'

/**
 * Clear glass, variant W1 (ADR 0010, "Proposed amendment"): "Vos envois" gives up its card so the
 * photographs themselves scroll under the clear pane. What a stylesheet can promise: the card is
 * gone, the photographs are a grid of big tiles, and every word left in the list stands on an
 * opaque `--surface-raised` chip (the surface the three inks are measured on). The browser half is
 * `tests/e2e/journeys/glass-chips.spec.ts`.
 */
const css = MINE.replace(/\/\*[\s\S]*?\*\//g, '')
const body = (selector: string): string => {
  const from = css.indexOf(`${selector} {`)
  expect(from, `${selector} is missing`).toBeGreaterThanOrEqual(0)
  return css.slice(css.indexOf('{', from) + 1, css.indexOf('}', from))
}

describe('the list stands on no card of its own', () => {
  it('paints no fill, no edge and no padding on the card', () => {
    const card = body('.mine.mine')
    expect(card).toMatch(/background:\s*none/)
    expect(card).toMatch(/border:\s*0/)
    expect(card).toMatch(/padding:\s*0/)
  })

  it('lays the photographs out as a grid of at least two columns, from tokens', () => {
    const list = body('.list')
    expect(list).toMatch(/display:\s*grid/)
    expect(list).toMatch(/minmax\(min\(100%,\s*var\(--tile-min-width\)\),\s*1fr\)/)
    expect(body('.thumb')).toMatch(/aspect-ratio:\s*1/)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b\d+px\b/i)
  })
})

describe('every word and control over a photograph is on an opaque chip', () => {
  it('fills the status badges and the caption with --surface-raised, nothing translucent', () => {
    const chips = body('.detail > span,\n.caption')
    expect(chips).toMatch(/background:\s*var\(--surface-raised\)\s*;/)
    expect(chips).not.toMatch(/color-mix|rgba|oklch|opacity/)
  })

  it('puts the delete control on a chip of its own', () => {
    expect(body('.photo > button')).toMatch(/background:\s*var\(--surface-raised\)\s*;/)
  })

  it('keeps a clip full width, its status below it rather than over the video controls', () => {
    expect(body('.clipRow')).toMatch(/grid-column:\s*1\s*\/\s*-1/)
    expect(body('.clipRow .detail')).toMatch(/position:\s*static/)
  })
})
