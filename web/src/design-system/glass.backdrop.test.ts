import { describe, expect, it } from 'vitest'
import TOKENS from './tokens.css?raw'
import BACKDROP_CSS from '../features/guest-upload/components/GuestBackdrop.module.css?raw'
import { ambianceBlock, parseOklchTokens, ratioOf, srgb, withoutAmbiances } from './testing/srgb'
import type { Srgb } from './testing/srgb'

/**
 * Clear glass, variant W2 (ADR 0010, "Proposed amendment"): the guest's photographs are the page's
 * ambient light, under a coat of the ambiance's own surface colour. This is the derivation the coat
 * rests on, in the manner of `scripts/ambianceGround.test.ts`: over the brightest photograph there can
 * be (white, dimmed by the layer's brightness) and over the darkest (black), the three inks keep their
 * bars, and the declared share is the lowest that does so (a heavier coat would be colour thrown away).
 */

const BARS = [
  ['--text-primary', 12],
  ['--text-secondary', 7],
  ['--text-muted', 4.5],
] as const

const mix = (coat: Srgb, photo: Srgb, share: number): Srgb =>
  [0, 1, 2].map((i) => coat[i]! * share + photo[i]! * (1 - share)) as unknown as Srgb

const holds = (
  own: ReturnType<typeof parseOklchTokens>,
  brightness: number,
  coatPercent: number,
): boolean => {
  const base = srgb(own.get('--surface-base')!)
  // `brightness()` multiplies the encoded channels, so the brightest photograph is grey at `brightness`.
  const photos: Srgb[] = [
    [brightness, brightness, brightness],
    [0, 0, 0],
  ]
  return photos.every((photo) => {
    const ground = mix(base, photo, coatPercent / 100)
    return BARS.every(([ink, bar]) => ratioOf(srgb(own.get(ink)!), ground) >= bar)
  })
}

const share = (body: string, token: string): number | null => {
  const found = new RegExp(String.raw`${token}:\s*([\d.]+)%?\s*;`).exec(body)
  return found?.[1] === undefined ? null : Number(found[1])
}

const root = withoutAmbiances(TOKENS)
const rootBrightness = share(root, '--guest-backdrop-brightness')!

describe.each(['eventslide', 'guinguette', 'riviera', 'champs', 'bivouac', 'cabaret', 'noces'])(
  'the %s ambiance',
  (name) => {
    const body = name === 'eventslide' ? root : ambianceBlock(TOKENS, name)
    const own = parseOklchTokens(`:root {${body.replaceAll('var(--accent-hue)', '305')}}`)
    const coat = share(body, '--guest-backdrop-coat')
    const brightness = share(body, '--guest-backdrop-brightness') ?? rootBrightness

    it('declares its own coat', () => {
      expect(coat).not.toBeNull()
    })

    it('keeps all three inks at their bars over the brightest and the darkest photograph', () => {
      expect(holds(own, brightness, coat!)).toBe(true)
    })

    it('declares the lowest coat that does (a heavier one is colour thrown away)', () => {
      expect(holds(own, brightness, coat! - 1)).toBe(false)
    })
  },
)

describe('the Sur mesure ambiance, at every ground hue', () => {
  const custom = (polarity: 'dark' | 'light'): string => {
    const found = new RegExp(
      String.raw`data-ambiance-ground='${polarity}'\]:not\(\[data-template-preview\]\)\)\)\s*\{([^}]*)\}`,
    ).exec(TOKENS)
    if (found?.[1] === undefined) throw new Error(`no ${polarity} custom block`)
    return found[1]
  }

  it.each(['dark', 'light'] as const)('holds the bars in its %s polarity', (polarity) => {
    const body = custom(polarity)
    const coat = share(body, '--guest-backdrop-coat')!
    const brightness = share(body, '--guest-backdrop-brightness') ?? rootBrightness
    for (let hue = 0; hue < 360; hue += 10) {
      const own = parseOklchTokens(`:root {${body.replaceAll('var(--ground-hue)', String(hue))}}`)
      expect(holds(own, brightness, coat), `hue ${hue}`).toBe(true)
    }
  })

  it('does not dim in its light polarity, whose worst photograph is a black one', () => {
    expect(share(custom('light'), '--guest-backdrop-brightness')).toBe(1)
  })
})

describe('the layer is switched off wherever the glass is', () => {
  const rules = TOKENS.replace(/\/\*[\s\S]*?\*\//g, '')

  it('shows by default and is gone in the opaque tiers, as the clear pane is', () => {
    expect(root).toMatch(/--guest-backdrop-display:\s*block;/)
    // Every place the clear pane goes opaque: no backdrop-filter, reduced transparency or more
    // contrast, and the `plain` tier. The layer has nothing to light there and must not darken the page.
    const opaque = rules.match(/--glass-clear-alpha:\s*100%;[\s\S]*?\}/g) ?? []
    expect(opaque).toHaveLength(3)
    for (const block of opaque) expect(block).toMatch(/--guest-backdrop-display:\s*none;/)
  })

  it('has an opaque coat first for a browser without color-mix, and reads the coat from tokens', () => {
    const css = BACKDROP_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(
      /background:\s*var\(--surface-base\);[\s\S]*color-mix\(in oklch, var\(--surface-base\) var\(--guest-backdrop-coat\)/,
    )
    expect(css).toMatch(/brightness\(var\(--guest-backdrop-brightness\)\)/)
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\boklch\(/i)
  })
})
