import { describe, expect, it } from 'vitest'
// Vite's `?raw` rather than `node:fs`: the web project runs under jsdom, where
// `import.meta.url` is not a `file:` URL and `fileURLToPath` throws. This also keeps the
// test reading the same file the bundle does.
import TOKENS from './tokens.css?raw'
// The wall's caption styles, for the one failure mode a colour pair cannot express.
import CAPTIONS from '../features/wall/components/SlideCaption.module.css?raw'
import {
  ambianceBlock,
  composite,
  lightestHue,
  luminanceOf,
  parseOklchTokens,
  ratioOf,
  srgb,
  toLinearSrgb,
  WHITE,
  withoutAmbiances,
  type Oklch,
  type Srgb,
} from './testing/srgb'

/**
 * The contrast targets in docs/DESIGN-SYSTEM.md §8, checked against the tokens.
 *
 * Until now that table was a promise nobody could break a build over. Contrast is the
 * accessibility property most likely to regress silently, because the way it regresses
 * is somebody nudging a lightness value to make one screen look better — which is
 * exactly the change that looks harmless in review.
 *
 * Read from `tokens.css` rather than from a duplicated list of colours, so a token
 * edited without updating this file fails here instead of being quietly untested.
 * `tokens.css` is the single source of the raw values (CLAUDE.md §3.2); a second copy
 * of them in a test would defeat the point.
 *
 * The wall is judged at the same bar as body text regardless of size: a projected
 * caption is read from the back of a room, which cancels the usual large-text
 * concession.
 */

/**
 * `--accent-hue` is substituted before anything else is read.
 *
 * Per-event theming (roadmap 2.2) made the accent's hue a variable so that an event can
 * move it and nothing else — which is what keeps every palette a host can ask for
 * decidable in advance. The consequence here is that `--accent` no longer spells its own
 * hue, so the file is resolved once, the way the browser would, before the parser sees
 * it. Everything below then measures the default palette exactly as it always did.
 */
const DECLARED_HUE = /--accent-hue:\s*([\d.]+)\s*;/.exec(TOKENS)

if (DECLARED_HUE?.[1] === undefined) {
  throw new Error('tokens.css declares no --accent-hue; the accent tokens cannot be resolved.')
}

/** The hue an event with no theme renders, and the one every assertion here measures. */
const DEFAULT_HUE = Number(DECLARED_HUE[1])

/**
 * The product's own palette, without the ambiance blocks (ADR 0010).
 *
 * The Guinguette is the root, and the four other ambiances re-declare every surface and ink.
 * The parser keeps the last declaration of a name, so reading the whole file would quietly
 * measure the last ambiance as if it were the root: they are cut out here and measured on
 * their own below. What is left still ends on the `[data-event-accent]` derivation, which is
 * what every sweep in this file is about; the root's own kraft accent is measured separately.
 */
const ROOT_TOKENS = withoutAmbiances(TOKENS)

/** The root block alone: the Guinguette's own declarations, before any derivation. */
const ROOT_BLOCK = /:root \{[\s\S]*?\n\}/.exec(ROOT_TOKENS)?.[0] ?? ''

const tokens = parseOklchTokens(ROOT_TOKENS.replaceAll('var(--accent-hue)', DECLARED_HUE[1]))

const token = (name: string): Oklch => {
  const value = tokens.get(name)
  if (value === undefined) {
    throw new Error(`${name} is not an oklch token in tokens.css — did it get renamed?`)
  }
  return value
}

/**
 * WCAG relative luminance.
 *
 * Computed from the *linear* channels, so no gamma round-trip is needed: sRGB's
 * transfer function is exactly what `toLinearSrgb` has already undone. Clamped because
 * a wide-gamut oklch value can sit slightly outside sRGB, and a negative channel would
 * otherwise flatter the ratio.
 */
const luminance = (colour: Oklch): number => {
  const [r, g, b] = toLinearSrgb(colour)
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b)
}

const contrast = (a: Oklch, b: Oklch): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** Every surface a piece of text can land on. */
const SURFACES = ['--surface-base', '--surface-raised', '--surface-overlay'] as const

/**
 * The hue sweep, once.
 *
 * It was written three times in this file, and the comment above "the accent on the
 * surfaces the sweep forgot" records what a previous duplication cost: a pair went
 * unmeasured because the second copy of the sweep was not given it. One definition is the
 * fix for that, not a tidy-up.
 */
const HUES = Array.from({ length: 360 }, (_unused, hue) => hue)

/** The token as declared, with only its hue moved — which is all a theme may move. */
const atHue = (name: string, hue: number): Oklch => ({ ...token(name), h: hue })

/** The angle where a pair is at its worst, so a failure names a hue to go and look at. */
const worst = (measure: (hue: number) => number): { hue: number; ratio: number } =>
  HUES.map((hue) => ({ hue, ratio: measure(hue) })).reduce((low, next) =>
    next.ratio < low.ratio ? next : low,
  )

/**
 * The alpha `--focus-ring` is painted at, read out of the token rather than copied.
 *
 * `parseTokens` cannot see it: the ring is a shadow, so the whole declaration is skipped,
 * and every assertion that composites the ring would otherwise be measuring a number that
 * had stopped matching the stylesheet. This throws instead of defaulting, because a ring
 * silently measured at full strength is a ring that passes a test it should fail.
 */
const FOCUS_RING_ALPHA = ((): number => {
  // The derivation's own ring: the first `--focus-ring` in the file is the kraft root's.
  const derived = /\n\[data-event-accent\] \{[^}]*\}/.exec(TOKENS)?.[0] ?? ''
  const found = /--focus-ring:[^;]*\/\s*([\d.]+)\s*\)/.exec(derived)
  if (found?.[1] === undefined) {
    throw new Error('--focus-ring declares no alpha in tokens.css — did its shape change?')
  }
  return Number(found[1])
})()

/**
 * The ambiances, measured on their own (ADR 0010): each block is the same contract as the
 * root's, at the same bars, over its own surfaces. A new ambiance is not shippable until it
 * passes the same pairs. The Guinguette is the root look, so its declarations are the root
 * block's; the others are their own `[data-event-ambiance]` block.
 */
const AMBIANCES = ['guinguette', 'riviera', 'champs', 'bivouac', 'cabaret', 'noces'] as const

/** The darkest photograph there is: nothing is darker, as nothing is brighter than WHITE. */
const BLACK: Srgb = [0, 0, 0]

/**
 * Sur mesure (ADR 0011): a host's own ground, derived from two angles at fixed lightness and chroma.
 * The two blocks read `var(--ground-hue)` and `var(--accent-hue)`, which the browser substitutes on
 * the element that carries them; the sweeps below do the same, once per hue pair.
 */
const CUSTOM_POLARITIES = ['dark', 'light'] as const
type CustomPolarity = (typeof CUSTOM_POLARITIES)[number]

/** 0 to 345 every 15 degrees, and 359 to close the circle: the two ends of what the domain accepts. */
const GRID: readonly number[] = [...Array.from({ length: 24 }, (_unused, step) => step * 15), 359]
const GROUND_HUES = GRID

const customBody = (polarity: CustomPolarity): string => {
  const found = new RegExp(
    String.raw`\[data-event-ambiance='custom'\]\[data-ambiance-ground='${polarity}'\][^{]*\{([^}]*)\}`,
  ).exec(TOKENS)
  if (found?.[1] === undefined) throw new Error(`tokens.css declares no custom ${polarity} block`)
  return found[1]
}

/** The hue an event that chose no accent presses, read out of each block rather than copied. */
const CUSTOM_DEFAULT_ACCENT: Readonly<Record<CustomPolarity, number>> = {
  dark: Number(/--accent-hue:\s*(\d+);/.exec(customBody('dark'))?.[1]),
  light: Number(/--accent-hue:\s*(\d+);/.exec(customBody('light'))?.[1]),
}

const customCache = new Map<string, ReadonlyMap<string, Oklch>>()

/** The block's tokens at one ground hue and one accent hue, the way the browser would resolve them. */
const customTokens = (
  polarity: CustomPolarity,
  ground: number,
  accent: number,
): ReadonlyMap<string, Oklch> => {
  const key = `${polarity}/${ground}/${accent}`
  const cached = customCache.get(key)
  if (cached !== undefined) return cached
  const resolved = customBody(polarity)
    .replaceAll('var(--ground-hue)', String(ground))
    .replaceAll('var(--accent-hue)', String(accent))
  // The ring is a shadow, which the token parser skips: its colour is read out and declared apart.
  const ring = /--focus-ring:\s*0 0 0 3px oklch\(([^)]*)\)/.exec(resolved)?.[1]
  if (ring === undefined) throw new Error(`the custom ${polarity} block declares no focus ring`)
  const parsed = parseOklchTokens(
    `:root {
${resolved}
  --focus-ring-colour: oklch(${ring});
}`,
  )
  customCache.set(key, parsed)
  return parsed
}

/** What a custom block does not restate, it inherits from the root. */
const ROOT_FALLBACK = tokens

describe.each(AMBIANCES)('the %s ambiance', (name) => {
  const body = name === 'guinguette' ? ROOT_BLOCK : ambianceBlock(TOKENS, name)
  const own = parseOklchTokens(`:root {${body}}`)
  const of = (token: string): Oklch => {
    const value = own.get(token)
    if (value === undefined) throw new Error(`the ${name} block does not restate ${token}`)
    return value
  }
  /**
   * The polarity: whether the inks are lighter than the surfaces (every ambiance but the Noces)
   * or darker (the Noces). It decides which photograph is the worst case under a translucent
   * pane: a light-inked pane fears the brightest photograph there is, white, and a dark-inked
   * one the darkest, black. Nothing is exempted by it; the same bars are held both ways.
   */
  const lightInk = luminance(of('--text-primary')) > luminance(of('--surface-base'))
  const worstPhoto: Srgb = lightInk ? WHITE : BLACK
  /**
   * The accent a host's hue derives in this ambiance: its own derivation when it declares one
   * (`[data-event-ambiance='…'][data-event-accent]`), the generic one otherwise. Only the hue
   * moves, which is all a theme may move.
   */
  const derivationBody = new RegExp(
    `\\[data-event-ambiance='${name}'\\]\\[data-event-accent\\]\\s*\\{([^}]*)\\}`,
  ).exec(TOKENS)?.[1]
  const derivation = parseOklchTokens(
    `:root {${(derivationBody ?? '').replaceAll('var(--accent-hue)', String(DEFAULT_HUE))}}`,
  )
  const derivedAt = (property: string, hue: number): Oklch => ({
    ...(derivation.get(property) ?? token(property)),
    h: hue,
  })

  it.each([
    ['--text-primary', 12],
    ['--text-secondary', 7],
    ['--text-muted', 4.5],
  ] as const)('keeps %s above its bar on every surface it declares', (ink, bar) => {
    for (const surface of SURFACES)
      expect(contrast(of(ink), of(surface))).toBeGreaterThanOrEqual(bar)
  })

  it.each(SURFACES)('keeps its --border-strong visible on %s', (surface) => {
    expect(contrast(of('--border-strong'), of(surface))).toBeGreaterThanOrEqual(3)
  })

  it('keeps the label on its accent readable at rest and under a finger', () => {
    expect(contrast(of('--accent-contrast'), of('--accent'))).toBeGreaterThanOrEqual(7)
    expect(contrast(of('--accent-contrast'), of('--accent-strong'))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the label readable where the texture under it is darkest, if it has one', () => {
    // A texture is a noise layer under the label, read out of the token rather than copied:
    // its feColorMatrix paints one colour at an alpha that tops out at the matrix's own A.
    // The worst pixel is that colour at that alpha over the accent, at rest and pressed.
    const declared = /--accent-texture:\s*(none|url\("([^"]*)"\))/.exec(body)
    if (declared === null) throw new Error(`the ${name} block declares no --accent-texture`)
    const texture = declared[2]
    if (texture === undefined) return

    const values = /values='([^']*)'/.exec(texture)?.[1]?.split(/\s+/).map(Number) ?? []
    if (values.length !== 20) throw new Error('the texture no longer declares a 4x5 colour matrix')
    const fibre: Srgb = [values[4] ?? 0, values[9] ?? 0, values[14] ?? 0]
    const alpha = values[18] ?? 0
    const over = (field: Oklch): Srgb => {
      const [r, g, b] = srgb(field)
      return [
        fibre[0] * alpha + r * (1 - alpha),
        fibre[1] * alpha + g * (1 - alpha),
        fibre[2] * alpha + b * (1 - alpha),
      ]
    }
    const label = srgb(of('--accent-contrast'))
    expect(ratioOf(label, over(of('--accent')))).toBeGreaterThanOrEqual(4.5)
    expect(ratioOf(label, over(of('--accent-strong')))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps a texture to the Guinguette alone, or says so', () => {
    // Every other ambiance presses a flat colour, and says `none` rather than inheriting the
    // root's fibres under a label they were never measured on.
    if (name === 'guinguette') expect(body).toMatch(/--accent-texture:\s*url\(/)
    else expect(body).toMatch(/--accent-texture:\s*none;/)
  })

  it.each(['--success', '--danger', '--warning'] as const)(
    'keeps %s readable as text on --surface-raised, where status text sits',
    (status) => {
      expect(
        contrast(own.get(status) ?? token(status), of('--surface-raised')),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(['--success', '--danger', '--warning'] as const)(
    'keeps %s visible as a glyph on every surface it declares',
    (status) => {
      const ink = own.get(status) ?? token(status)
      for (const surface of SURFACES) expect(contrast(ink, of(surface))).toBeGreaterThanOrEqual(3)
    },
  )

  it.each([
    ['--text-primary', 12],
    ['--text-secondary', 7],
    ['--text-muted', 4.5],
  ] as const)(
    'keeps %s above its bar on its glass over the worst photograph (white under light inks, black under dark ones)',
    (ink, bar) => {
      const pane = composite(of('--glass-tint-photo'), worstPhoto)
      expect(ratioOf(srgb(of(ink)), pane)).toBeGreaterThanOrEqual(bar)
      // And no worse than on the darkest surface this palette lets text sit on.
      expect(ratioOf(srgb(of(ink)), pane)).toBeGreaterThanOrEqual(
        ratioOf(srgb(of(ink)), srgb(of('--surface-overlay'))),
      )
    },
  )

  it('declares the lowest photo alpha that holds over the worst photograph, so the number is derived', () => {
    // The shape the root's tiers use: a value is only a floor if the step below it fails. The
    // bars are the pane's: the three inks at their targets and no worse than on the overlay,
    // the status glyphs, and the accent as a link.
    const tint = of('--glass-tint-photo')
    const holds = (alpha: number): boolean => {
      const pane = composite({ ...tint, alpha }, worstPhoto)
      for (const [ink, bar] of [
        ['--text-primary', 12],
        ['--text-secondary', 7],
        ['--text-muted', 4.5],
      ] as const) {
        const ratio = ratioOf(srgb(of(ink)), pane)
        if (ratio < bar) return false
        if (ratio < ratioOf(srgb(of(ink)), srgb(of('--surface-overlay')))) return false
      }
      for (const status of ['--success', '--danger', '--warning'] as const) {
        if (ratioOf(srgb(own.get(status) ?? token(status)), pane) < 3) return false
      }
      return ratioOf(srgb(of('--accent')), pane) >= 4.5
    }

    expect(holds(tint.alpha)).toBe(true)
    expect(holds(Number((tint.alpha - 0.01).toFixed(2)))).toBe(false)
  })

  it('keeps its accent readable from the back of the room', () => {
    expect(contrast(of('--accent'), of('--surface-base'))).toBeGreaterThanOrEqual(7)
  })

  it('keeps the default focus ring visible on every surface it declares', () => {
    const ring = /--focus-ring:\s*0 0 0 3px oklch\(([^)]*)\)/.exec(body)?.[1]
    if (ring === undefined) throw new Error(`the ${name} block declares no focus ring`)
    const colour = parseOklchTokens(`:root {
  --r: oklch(${ring});
}`).get('--r')
    if (colour === undefined) throw new Error('the focus ring is not an oklch colour')
    for (const surface of SURFACES) {
      const ground = srgb(of(surface))
      expect(ratioOf(composite(colour, ground), ground)).toBeGreaterThanOrEqual(3)
    }
  })

  it('holds the event accent to the same bars on its surfaces, at every angle', () => {
    // A host can pick any of the 360 hues in any ambiance, and the derived accent is drawn on
    // this ambiance's surfaces: the root's sweep above measures it on the root's alone.
    const worstOf = (measure: (hue: number) => number): { hue: number; ratio: number } =>
      HUES.map((hue) => ({ hue, ratio: measure(hue) })).reduce((low, next) =>
        next.ratio < low.ratio ? next : low,
      )
    const base = worstOf((h) => contrast(derivedAt('--accent', h), of('--surface-base')))
    expect(base.ratio, `on --surface-base, worst at hue ${base.hue}`).toBeGreaterThanOrEqual(7)

    for (const surface of ['--surface-raised', '--surface-overlay'] as const) {
      const link = worstOf((h) => contrast(derivedAt('--accent', h), of(surface)))
      expect(link.ratio, `on ${surface}, worst at hue ${link.hue}`).toBeGreaterThanOrEqual(4.5)
    }
    for (const surface of SURFACES) {
      const ring = worstOf((h) => {
        const ground = srgb(of(surface))
        return ratioOf(
          composite({ ...derivedAt('--accent', h), alpha: FOCUS_RING_ALPHA }, ground),
          ground,
        )
      })
      expect(ring.ratio, `ring on ${surface}, worst at hue ${ring.hue}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the label readable on the accent a host’s hue derives here, at rest and pressed', () => {
    const rest = worst((h) => contrast(derivedAt('--accent-contrast', h), derivedAt('--accent', h)))
    expect(rest.ratio, `label on accent, worst at hue ${rest.hue}`).toBeGreaterThanOrEqual(7)
    const pressed = worst((h) =>
      contrast(derivedAt('--accent-contrast', h), derivedAt('--accent-strong', h)),
    )
    expect(
      pressed.ratio,
      `label on accent-strong, worst at hue ${pressed.hue}`,
    ).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * The join card on the wall, per ambiance: its ink on its own paper, at the wall's bar. It is
 * the accent's label on the accent paper in the dark ambiances and red ink on white paper in the
 * Noces, so the references are resolved against the block that declares them, not assumed.
 */
describe.each(AMBIANCES)('the wall’s join card in the %s ambiance', (name) => {
  const body = name === 'guinguette' ? ROOT_BLOCK : ambianceBlock(TOKENS, name)
  const own = parseOklchTokens(`:root {${body}}`)
  const resolve = (property: string): Oklch => {
    const pattern = new RegExp(`${property}:\\s*([^;]+);`)
    const declared = (pattern.exec(body) ?? pattern.exec(ROOT_BLOCK))?.[1]?.trim()
    if (declared === undefined) throw new Error(`the ${name} block does not declare ${property}`)
    const reference = /^var\((--[a-z-]+)\)$/.exec(declared)?.[1]
    const found = own.get(reference ?? property)
    if (found === undefined) throw new Error(`${property} does not resolve to a colour in ${name}`)
    return found
  }

  it.each(['--wall-card-ink', '--wall-card-ink-2'] as const)(
    'reads %s on its paper from the back of the room',
    (ink) => {
      expect(contrast(resolve(ink), resolve('--wall-card-bg'))).toBeGreaterThanOrEqual(7)
    },
  )

  it('prints the QR dark on light, never the reverse, at the wall’s bar', () => {
    // An inverted code is read unreliably by the cameras guests use (JoinQr.module.css).
    expect(luminance(resolve('--qr-ink'))).toBeLessThan(luminance(resolve('--qr-field')))
    expect(contrast(resolve('--qr-ink'), resolve('--qr-field'))).toBeGreaterThanOrEqual(7)
  })
})

describe('the kraft the root presses (ADR 0010)', () => {
  const root = parseOklchTokens(ROOT_BLOCK)
  const kraft = root.get('--accent')
  const ink = root.get('--accent-contrast')

  it('is declared as the root accent, without a hue to move', () => {
    expect(kraft).toBeDefined()
  })

  it('carries its label at the accent’s own bar', () => {
    if (kraft === undefined || ink === undefined) throw new Error('no kraft accent at the root')
    expect(contrast(ink, kraft)).toBeGreaterThanOrEqual(7)
    expect(contrast(kraft, token('--surface-base'))).toBeGreaterThanOrEqual(7)
    expect(contrast(kraft, token('--surface-overlay'))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('token contrast', () => {
  it('parses the palette out of tokens.css rather than a copy of it', () => {
    // If this fails, the regex has drifted from the file's format and every assertion
    // below would be vacuously true against an empty map.
    expect(tokens.size).toBeGreaterThanOrEqual(14)
    expect(tokens.has('--text-primary')).toBe(true)
  })

  it.each(SURFACES)('--text-primary reaches 12:1 on %s', (surface) => {
    expect(contrast(token('--text-primary'), token(surface))).toBeGreaterThanOrEqual(12)
  })

  it.each(SURFACES)('--text-secondary reaches 7:1 on %s', (surface) => {
    // The reason the palette is oklch: `L` tracks apparent brightness, so one
    // --text-secondary holds up across all three surfaces instead of needing a
    // hand-picked grey per panel the way 1.0's hex values did.
    expect(contrast(token('--text-secondary'), token(surface))).toBeGreaterThanOrEqual(7)
  })

  it.each(SURFACES)('--text-muted reaches 4.5:1 on %s', (surface) => {
    expect(contrast(token('--text-muted'), token(surface))).toBeGreaterThanOrEqual(4.5)
  })

  it('--accent-contrast reaches 7:1 on --accent', () => {
    // The pairing on every primary button. Getting this wrong makes the one control a
    // guest has to find the hardest thing on the page to read.
    expect(contrast(token('--accent-contrast'), token('--accent'))).toBeGreaterThanOrEqual(7)
  })

  it('--accent-contrast still clears AA on --accent-strong', () => {
    // Hover and pressed states are darker, and a ratio that only holds at rest is a
    // button that becomes unreadable under the cursor.
    //
    // The bar here is 4.5 rather than the 7 demanded at rest, because 7 is not reachable
    // on this colour at all: `--accent-strong` sits at 64% lightness, so even pure black
    // on it measures 5.74. Asserting 7 would be a permanently red test demanding a
    // different hover colour. If the palette ever restyles that hover, raise this.
    expect(contrast(token('--accent-contrast'), token('--accent-strong'))).toBeGreaterThanOrEqual(
      4.5,
    )
  })

  it.each(['--success', '--danger', '--warning'] as const)(
    '%s reaches 4.5:1 on --surface-raised, where status text sits',
    (status) => {
      expect(contrast(token(status), token('--surface-raised'))).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(['--text-print', '--text-print-secondary'] as const)(
    '%s reaches 7:1 on --surface-print, the polaroid mat',
    (ink) => {
      // The only light ground in the palette, and it is on the wall — so both inks are
      // held to the wall's bar (§8: anything projected clears 7:1 regardless of size)
      // rather than to body text's. A caption written on a print is read from the same
      // five metres as a caption on a scrim, and so is the credit under it.
      expect(contrast(token(ink), token('--surface-print'))).toBeGreaterThanOrEqual(7)
    },
  )

  /**
   * The gap every ratio above is blind to.
   *
   * Contrast here is computed between two *declared* colours. Text at `opacity: 0.75`
   * renders as neither of them — it renders as a composite against whatever is behind
   * it — so a caption can pass every assertion in this file and still be unreadable.
   * That is not hypothetical: the polaroid credit shipped at `opacity: 0.75` over
   * `--surface-print` and measured 5.6:1 in Chromium while `--text-print` measured 11.8.
   *
   * So the wall's captions may not dilute their ink. A quieter credit is a second
   * declared token, which is a number this file can see.
   */
  it('no wall caption dilutes its ink with opacity, which no ratio here could see', () => {
    // Comments stripped first, or the paragraph above this rule fails it by describing
    // the very declaration it forbids.
    const rules = CAPTIONS.replace(/\/\*[\s\S]*?\*\//g, '')
    const declarations = [...rules.matchAll(/opacity\s*:\s*([\d.]+)/g)].map(([, value]) => value)

    expect(declarations).toEqual([])
  })

  it('resolves the event accent from the hue the root declares', () => {
    // The substitution above is load-bearing: if it ever stopped matching, `--accent`
    // would fall out of the map and the three assertions about it would throw instead of
    // measuring anything. Naming the value also pins the default — this is the hue
    // `DEFAULT_EVENT_THEME` carries, and the two agreeing is what makes an event with no
    // theme render what it rendered before theming existed.
    expect(DEFAULT_HUE).toBe(305)
    expect(token('--accent').h).toBe(305)
  })

  it.each(SURFACES)('--border-strong stays visible against %s', (surface) => {
    // An input's rest state is a border and nothing else. WCAG 1.4.11 puts the floor for
    // a UI component's boundary at 3:1, and below that it reads as an absent field — a
    // guest does not tap what does not look tappable. Checked on all three surfaces
    // because inputs appear inside cards and dialogs, not only on the page ground.
    expect(contrast(token('--border-strong'), token(surface))).toBeGreaterThanOrEqual(3)
  })
})

/**
 * The same targets, for every accent a host could be given.
 *
 * Roadmap 2.2 lets a host move `--accent-hue`, and the rule that decides which angles are
 * allowed lives in `src/domain/events/eventTheme.ts` — where it belongs, because refusing
 * a host is a product decision and a stylesheet can only render. What this file adds is
 * the other half of the claim: that the *stylesheet* holds up all the way round the
 * circle, measured on the real declarations rather than on the derivation the domain
 * restates. If the two ever disagree, `eventThemeContract.test.ts` says so; if the
 * declarations themselves stop clearing the bar at some angle, it is said here.
 *
 * The whole circle, not the four hues the picker offers, because the boundary schema
 * accepts any of the 360 and the rule refuses only those that crowd a status colour.
 * One assertion per target rather than one per hue: a failure should name the worst
 * angle, not bury it in 360 green results.
 */
describe('every accent hue an event can carry', () => {
  it('keeps the button label readable at rest, at every angle', () => {
    const { hue, ratio } = worst((h) =>
      contrast(atHue('--accent-contrast', h), atHue('--accent', h)),
    )

    expect(ratio, `--accent-contrast on --accent is worst at hue ${hue}`).toBeGreaterThanOrEqual(7)
  })

  it('keeps the button label readable under a finger, at every angle', () => {
    const { hue, ratio } = worst((h) =>
      contrast(atHue('--accent-contrast', h), atHue('--accent-strong', h)),
    )

    expect(
      ratio,
      `--accent-contrast on --accent-strong is worst at hue ${hue}`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the accent readable from the back of the room, at every angle', () => {
    // The wall's bar, and the surface the wall actually uses: the empty state's
    // invitation is `--accent` on `--surface-base`, projected, so it is held to 7:1
    // regardless of size like everything else the room reads.
    const { hue, ratio } = worst((h) => contrast(atHue('--accent', h), token('--surface-base')))

    expect(ratio, `--accent on --surface-base is worst at hue ${hue}`).toBeGreaterThanOrEqual(7)
  })

  it.each(['--surface-raised', '--surface-overlay'] as const)(
    'keeps an accent-coloured link readable on %s, at every angle',
    (surface) => {
      // Body text's bar, not the wall's: a link inside a Card or a Dialog is read at
      // arm's length. 7:1 is not reachable here at any angle — the default palette
      // measures 6.69 on --surface-raised — which is why this is the pair the design
      // system holds to AA.
      const { hue, ratio } = worst((h) => contrast(atHue('--accent', h), token(surface)))

      expect(ratio, `--accent on ${surface} is worst at hue ${hue}`).toBeGreaterThanOrEqual(4.5)
    },
  )
})

/**
 * The two pairs the sweep above did not cover, both found by review rather than by a
 * failure: one became hue-dependent in this change and was not added to it, and one is
 * a surface the sweep's name implies and its list omits.
 */
describe('the accent on the surfaces the sweep forgot', () => {
  it.each(['--surface-base', '--surface-raised', '--surface-overlay'] as const)(
    'keeps the focus ring visible on %s, at every angle',
    (surface) => {
      /**
       * `--focus-ring` moved into the hue-derived block in this change, so it is now the
       * one accent-derived token an event can move that is drawn on the guest's only
       * control. WCAG 1.4.11 asks 3:1 of a focus indicator, and the ring is painted at
       * `FOCUS_RING_ALPHA` — read out of the declaration rather than copied from it, or
       * lowering the alpha in `tokens.css` would leave this measuring the old one.
       *
       * The headroom is thin on purpose to be visible: the worst angle lands near 3.2,
       * and dropping the alpha to 0.60 would put it under the bar. Without this the
       * suite would stay green while it did.
       */
      const ring = (hue: number): Oklch => {
        const over = token(surface)
        const ink = atHue('--accent', hue)
        const alpha = FOCUS_RING_ALPHA
        return {
          l: ink.l * alpha + over.l * (1 - alpha),
          c: ink.c * alpha + over.c * (1 - alpha),
          h: hue,
          // Composited already: the ring is compared as it is painted, not at full strength.
          alpha: 1,
        }
      }

      const { hue, ratio } = worst((h) => contrast(ring(h), token(surface)))

      expect(ratio, `--focus-ring on ${surface} is worst at hue ${hue}`).toBeGreaterThanOrEqual(3)
    },
  )

  it('is never drawn on the polaroid mat, which no hue can make readable', () => {
    /**
     * `--surface-print` is the product's one light ground, and `--accent` on it measures
     * 2.29:1 at the default hue and 1.88 at its worst — under 3:1 at all 360 angles.
     * Nothing draws accent there today and nothing may start: this asserts the trap
     * rather than a ratio, because the honest bar here is "do not".
     */
    const { ratio } = worst((h) => contrast(atHue('--accent', h), token('--surface-print')))

    expect(ratio).toBeLessThan(3)
  })
})

/**
 * The glass material, over a photograph nobody has taken yet — roadmap 11.1.
 *
 * Every ratio above compares two **declared** colours. A translucent pane is neither: it
 * renders as a composite against whatever is behind it, and what is behind it here is a
 * guest's upload. This file already says as much about `opacity` on a caption and
 * declines to model it; the material cannot decline, because being composited over
 * something unknown is the whole of what it is.
 *
 * ## Why the arithmetic below is a second kind
 *
 * Alpha compositing happens in **gamma-encoded sRGB**, which is why 50% black over white
 * renders as mid grey rather than as the much darker colour a linear-light blend would
 * give. Measuring the blend in Oklab or in linear light would flatter the material by a
 * wide margin, so the helpers here encode to sRGB, blend, and decode again. The `ring()`
 * helper above blends in oklch instead and is left alone: it measures a ring against a
 * surface of nearly its own lightness, where the two agree closely, and moving it would
 * change an assertion this work is not about.
 *
 * ## Why pure white is the whole answer
 *
 * No sRGB colour has a relative luminance above white's. A pane that holds its contrast
 * over white therefore holds it over every photograph, every accent a host can choose,
 * and every combination of the two — so the sweeps below are not what proves the floor.
 * They are here because a sweep names the angle to go and look at when something moves,
 * and because roadmap 11.1 states the themed-accent case explicitly: this is that claim
 * measured, rather than inferred from a theorem in a comment.
 *
 * ## Where 0.95 comes from
 *
 * Not a taste. It is the lowest alpha at which the material over white is at least as
 * good a ground as `--surface-overlay` — the darkest surface this design system already
 * lets text sit on — for all three text tokens at once. At 0.94 `--text-muted` measures
 * 4.50 against `--surface-overlay`'s 4.62, and the material would be a ground the design
 * system would refuse if it were opaque.
 */
describe('the glass material over an unknown photograph', () => {
  /**
   * The material as it renders over `backdrop` — the tint, and deliberately not the
   * filter.
   *
   * `--glass-filter` also carries `saturate(180%)`, which does change a coloured backdrop
   * before the tint is painted over it. It is left out because it cannot help the floor
   * and cannot hurt it: saturation is a rotation about the luminance axis, white is
   * invariant under it, and the sRGB clamp keeps any other backdrop no brighter than the
   * white case already measured. So what follows is the tint's guarantee, which is the
   * one the alpha is chosen to make.
   */
  const pane = (backdrop: Srgb): Srgb => composite(token('--glass-tint-photo'), backdrop)

  /** The lightest the pane can ever be, and therefore the hardest ground it offers. */
  const lightestPane = (): Srgb => pane(WHITE)

  /** docs/DESIGN-SYSTEM.md §8, by token. */
  const TEXT_TARGETS = [
    ['--text-primary', 12],
    ['--text-secondary', 7],
    ['--text-muted', 4.5],
  ] as const

  it.each(['--glass-tint-photo', '--glass-tint-ground'] as const)(
    '%s is --surface-raised with an alpha rather than a shade of its own',
    (tintName) => {
      // The tints and the fallback are one colour at three alphas, which is what makes the
      // no-blur tier a surface this product already ships rather than a degraded mode
      // nobody has looked at — and what keeps the second tint from being a fourth grey. A
      // new shade between two existing ones is a rejected change (§2), and a tier is
      // exactly the shape a fourth one would arrive in.
      const tint = token(tintName)
      const raised = token('--surface-raised')

      expect({ l: tint.l, c: tint.c, h: tint.h }).toEqual({ l: raised.l, c: raised.c, h: raised.h })
      expect(tint.alpha).toBeLessThan(1)
      expect(TOKENS).toMatch(/--glass-opaque:\s*var\(--surface-raised\)\s*;/)
    },
  )

  it('holds the translucent tier below the strict one, or the split buys nothing', () => {
    // The whole claim of two tiers in one line. Written the day the numbers came out
    // three points apart, because "there are two tints" is satisfied just as well by two
    // tints that are equal, and that is the shape this would rot into.
    //
    // ADR 0010 is the day it stopped buying anything, and that is recorded rather than
    // hidden: the Chambre noire's primary button is the paper, a field as bright as the
    // white the photo tier was derived against, so our own ground is no kinder than a
    // photograph and both floors land on 0.96. The tiers stay two names, so an ambiance
    // with a darker action can win the points back; the ground may never be the stricter.
    expect(token('--glass-tint-ground').alpha).toBeLessThanOrEqual(
      token('--glass-tint-photo').alpha,
    )
  })

  it.each(['--glass-border', '--glass-highlight'] as const)(
    '%s is the product’s own light at a hairline’s strength, not a colour of its own',
    (edge) => {
      // The comment in `tokens.css` asserts this identity; without a test it is prose. The
      // material's parts are all existing colours at new alphas, which is what keeps a
      // six-token set from being six new shades (§2).
      const ink = token('--text-primary')
      const part = token(edge)

      expect({ l: part.l, c: part.c, h: part.h }).toEqual({ l: ink.l, c: ink.c, h: ink.h })
      expect(part.alpha).toBeLessThan(1)
    },
  )

  it.each(TEXT_TARGETS)('%s clears %d:1 on glass over pure white', (ink, target) => {
    // The floor, stated the way the contract states it. Over white, so it holds over
    // anything a camera can produce.
    expect(ratioOf(srgb(token(ink)), lightestPane())).toBeGreaterThanOrEqual(target)
  })

  it.each(TEXT_TARGETS)(
    '%s is no worse on glass over white than on --surface-overlay, which set the floor',
    (ink) => {
      // The derivation, kept beside the number it produced. If somebody lowers the alpha
      // to make the material prettier, this is the assertion that says what it cost.
      const onOverlay = ratioOf(srgb(token(ink)), srgb(token('--surface-overlay')))

      expect(ratioOf(srgb(token(ink)), lightestPane())).toBeGreaterThanOrEqual(onOverlay)
    },
  )

  it.each(TEXT_TARGETS)('%s is worse over white than over any accent an event can pick', (ink) => {
    // A sample of the theorem the floor rests on, and honest about being a sample: white
    // is the brightest thing in the gamut, so no backdrop makes the pane a harder ground,
    // and what is checked here is the 360 backdrops this product can itself produce. If
    // even one of them beat white, every other assertion in this block would be measuring
    // the wrong worst case.
    const overWhite = ratioOf(srgb(token(ink)), lightestPane())
    const { hue, ratio } = worst((h) => ratioOf(srgb(token(ink)), pane(srgb(atHue('--accent', h)))))

    expect(ratio, `${ink} on glass over --accent is worst at hue ${hue}`).toBeGreaterThanOrEqual(
      overWhite,
    )
  })

  it.each(TEXT_TARGETS)(
    '%s clears %d:1 on glass over a themed accent, at every angle',
    (ink, target) => {
      // Roadmap 11.1: "glass over a themed accent must still pass". The sweep §12's rule
      // already uses, applied to a composite rather than to a declared pair.
      const { hue, ratio } = worst((h) =>
        ratioOf(srgb(token(ink)), pane(srgb(atHue('--accent', h)))),
      )

      expect(ratio, `${ink} on glass over --accent is worst at hue ${hue}`).toBeGreaterThanOrEqual(
        target,
      )
    },
  )

  it('keeps an accent-coloured link readable on glass, at every angle', () => {
    // `base.css` colours every `<a>` with `--accent`, so a link inside a glass pane is
    // reachable without anybody deciding to put one there. Body text's bar, because §8
    // holds that same pair to AA on --surface-raised and --surface-overlay.
    const { hue, ratio } = worst((h) => ratioOf(srgb(atHue('--accent', h)), lightestPane()))

    expect(ratio, `--accent on glass is worst at hue ${hue}`).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the focus ring visible on glass, at every angle', () => {
    // The guest's primary control sits on the glass composer, so this is what decides
    // whether a keyboard guest can see where they are. WCAG 1.4.11 asks 3:1, and the ring
    // is painted at 0.65 alpha — measured composited, as it is drawn, over the lightest
    // the pane can be.
    const { hue, ratio } = worst((h) => {
      const ground = lightestPane()
      const ring = composite({ ...atHue('--accent', h), alpha: FOCUS_RING_ALPHA }, ground)
      return ratioOf(ring, ground)
    })

    expect(ratio, `--focus-ring on glass is worst at hue ${hue}`).toBeGreaterThanOrEqual(3)
  })

  it.each(['--success', '--danger', '--warning'] as const)(
    '%s stays a visible glyph on glass over white',
    (status) => {
      // A Toast's tone colours its glyph and the word beside it carries the meaning (§8),
      // so the bar is WCAG 1.4.11's 3:1 for a graphical object rather than text's.
      expect(ratioOf(srgb(token(status)), lightestPane())).toBeGreaterThanOrEqual(3)
    },
  )
})

/**
 * The glass material over our own ground — roadmap 11.2.
 *
 * The block above measures a pane against a backdrop nobody has taken yet, and takes the
 * ceiling of the gamut because there is no other honest answer. Most of this product is not
 * that. Login, the dashboard, the create form, the settings page and the guest's join
 * screen never show a photograph, so what can be painted under a pane there is a colour
 * this file declares — and a worst case you can enumerate is a calculation rather than a
 * bound.
 *
 * ## What the second floor is derived against, and why it is that
 *
 * **The brightest *field* a stylesheet paints, not the brightest token.** Contrast is a
 * property of a ground, and a ground is an area. `--text-primary` is lighter than anything
 * else in the palette, but as body text it paints glyph strokes over a small share of their
 * line boxes — a 20 px blur of a paragraph is a haze near the page's own ground, nowhere
 * near white. What fills an area is a surface or a filled control, and the lightest filled
 * control this product draws is a primary button: `--accent`, at whichever of the 360 hues
 * a host may choose renders lightest.
 *
 * That is a claim about the stylesheets, so it is not left as a claim.
 * `app/glassBackdrop.test.ts` walks the real import graph and refuses the translucent tier
 * to any address that can reach a brighter field — which is how the event page, whose QR
 * plate is a near-white `--text-primary` fill, ends up on the strict floor with no guest
 * photograph anywhere on it.
 *
 * ## The same bar, so that only the backdrop differs
 *
 * Every assertion below holds the ground tier to exactly what §11.1 held the photo tier to:
 * at least as good a ground as `--surface-overlay` for all three inks, plus the link, the
 * ring and the status glyphs. Changing the bar as well as the backdrop would have made the
 * two numbers incomparable, and the comparison is the only thing that says what the split
 * bought.
 */
describe('the glass material over our own ground', () => {
  /** The backdrop the ground floor is derived against. See `lightestHue`. */
  // ADR 0010: the root's own primary button is the kraft. It is the field the ground floor
  // has to hold over when it is brighter than the lightest hue an event can carry.
  const KRAFT = parseOklchTokens(ROOT_BLOCK).get('--accent')
  if (KRAFT === undefined) throw new Error('tokens.css declares no kraft accent at the root')
  const LIGHTEST_HUE = srgb(lightestHue(token('--accent')))
  const CEILING = luminanceOf(srgb(KRAFT)) > luminanceOf(LIGHTEST_HUE) ? srgb(KRAFT) : LIGHTEST_HUE

  const groundPane = (alpha: number): Srgb =>
    composite({ ...token('--glass-tint-ground'), alpha }, CEILING)

  const TEXT_TARGETS = [
    ['--text-primary', 12],
    ['--text-secondary', 7],
    ['--text-muted', 4.5],
  ] as const

  /** Every bar §8 puts on a pane, as one predicate, so the derivation can step the alpha. */
  const holds = (alpha: number): boolean => {
    const ground = groundPane(alpha)

    for (const [ink, target] of TEXT_TARGETS) {
      const ratio = ratioOf(srgb(token(ink)), ground)
      if (ratio < target) return false
      if (ratio < ratioOf(srgb(token(ink)), srgb(token('--surface-overlay')))) return false
    }
    for (const status of ['--success', '--danger', '--warning'] as const) {
      if (ratioOf(srgb(token(status)), ground) < 3) return false
    }
    for (const hue of HUES) {
      if (ratioOf(srgb(atHue('--accent', hue)), ground) < 4.5) return false
      const ring = composite({ ...atHue('--accent', hue), alpha: FOCUS_RING_ALPHA }, ground)
      if (ratioOf(ring, ground) < 3) return false
    }
    return true
  }

  it('is derived against a field this product paints, not against a token it merely has', () => {
    // The one sentence the whole tier rests on, asserted so it cannot quietly stop being
    // true: the ceiling is an accent, and it is meaningfully darker than the photograph the
    // strict tier assumes. If a future palette made the accent as bright as white, the two
    // tiers would collapse into one and this is where that shows up.
    expect(luminanceOf(CEILING)).toBeLessThan(luminanceOf(WHITE))
    expect(luminanceOf(CEILING)).toBeGreaterThan(luminanceOf(srgb(token('--surface-overlay'))))
  })

  it.each(TEXT_TARGETS)(
    '%s clears %d:1 on the translucent tier, at every accent',
    (ink, target) => {
      const declared = token('--glass-tint-ground').alpha
      const { hue, ratio } = worst((h) =>
        ratioOf(
          srgb(token(ink)),
          composite(token('--glass-tint-ground'), srgb(atHue('--accent', h))),
        ),
      )

      expect(ratio, `${ink} on the ground tier is worst at hue ${hue}`).toBeGreaterThanOrEqual(
        target,
      )
      // And against the derivation's own bar, not only §8's, which is the tighter of the two.
      expect(ratioOf(srgb(token(ink)), groundPane(declared))).toBeGreaterThanOrEqual(
        ratioOf(srgb(token(ink)), srgb(token('--surface-overlay'))),
      )
    },
  )

  it('declares the lowest alpha that holds, so the number is derived and not chosen', () => {
    // The shape §11.1 used for 0.95, applied to 0.92: the value is only a floor if the step
    // below it fails. Without this the tier is a taste somebody could nudge either way, and
    // the direction it would get nudged is down.
    const declared = token('--glass-tint-ground').alpha

    expect(holds(declared)).toBe(true)
    expect(holds(Number((declared - 0.01).toFixed(2)))).toBe(false)
  })

  it('states what the split actually bought, in the units a reader cares about', () => {
    /**
     * Seven per cent of the backdrop against four (eight against five before ADR 0010), and it is recorded rather than
     * celebrated.
     *
     * The gain is small because the photograph was never what made the material opaque.
     * `--text-muted` clears 4.62:1 on `--surface-overlay` against a 4.5 target, so the
     * palette has roughly a tenth of a ratio point of headroom before a translucent ground
     * stops being one this design system would accept — and removing the unknown backdrop
     * spends nearly all of it. Anything more transparent than this needs an ink moved, not
     * a backdrop narrowed, and that is a different change with a different argument.
     */
    const photo = 1 - token('--glass-tint-photo').alpha
    const ground = 1 - token('--glass-tint-ground').alpha

    // ADR 0010 moved the numbers: on the Chambre noire's darker raised black the photograph
    // floor sits at 0.96 and our own ground at 0.93, and the paper button takes the split to nothing (see the tier test above).
    expect(Math.round(photo * 100)).toBe(4)
    expect(Math.round(ground * 100)).toBe(7)
  })
})

/**
 * The wall's caption ground — roadmap 11.3, and the finding 11.1 parked here.
 *
 * `--surface-scrim` is the same kind of thing as the glass tint — a translucent ground
 * over a photograph nobody has taken yet — and it predates the material by two releases.
 * At the 55% it shipped with, composited over a white dress in full sun, it gave
 * `--text-primary` 4.36:1 and `--text-secondary` 2.38:1 against §8's "anything on the wall
 * ≥ 7:1 regardless of size". Every wall caption sits on it. The suite above could not see
 * it, because every ratio it took was between two *declared* colours.
 *
 * ## Why this is a sweep and not a pair of numbers
 *
 * The version of this that shipped under 11.1 asserted the two failing ratios in the
 * direction they were wrong in. That pinned the defect, which was the right thing to do
 * while the fix belonged to another branch, but it protected nothing else: an ink moved
 * onto the caption would not have touched either number.
 *
 * So what is asserted now is §8's sentence rather than two of its consequences. **Every
 * ink the wall declares is measured against every ground the wall paints under it**, read
 * off the wall's own stylesheets. `--text-muted` on a caption fails here the day somebody
 * writes it, and so does a scrim quietly lightened to let more of the photograph through.
 *
 * What this does **not** cover, said plainly: an ink painted over the photograph with no
 * ground at all. `ReactionBurst` does exactly that — a floating glyph in `--text-primary`
 * over whatever is behind it — and no ratio taken against a declared ground can see it.
 * It is a graphical object rather than text and it is out of this item's scope, but it is
 * a gap and not a covered case.
 */
describe('the wall reads from the back of the room, over any photograph', () => {
  const WALL_STYLESHEETS = import.meta.glob<string>('../features/wall/**/*.css', {
    query: '?raw',
    import: 'default',
    eager: true,
  })

  const stylesheets = Object.entries(WALL_STYLESHEETS).map(
    ([path, source]) =>
      [path.replace(/^\.\.\//, ''), source.replace(/\/\*[\s\S]*?\*\//g, '')] as const,
  )

  /**
   * `color: var(--text-…)`, and only that.
   *
   * The leading character class is load-bearing twice over: it keeps `font-size:
   * var(--text-xl)` out — the size scale shares the `--text-` prefix — and it keeps a
   * longhand like `border-inline-start-color` from reading as a `color` declaration.
   */
  const inksIn = (css: string): readonly string[] =>
    [...css.matchAll(/(?:^|[;{\s])color\s*:\s*var\((--text-[a-z-]+)\)/g)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    )

  const declaredInks = [...new Set(stylesheets.flatMap(([, css]) => inksIn(css)))].sort()

  /** The mat is the one light ground up there, so its inks are the ones named for it. */
  const onPaper = (ink: string): boolean => ink.startsWith('--text-print')

  /** The scrim at an alpha, over the brightest backdrop a photograph can be. */
  const scrimAt = (alpha: number): Srgb => composite({ ...token('--surface-scrim'), alpha }, WHITE)

  const DECLARED_ALPHA = token('--surface-scrim').alpha

  /**
   * Every ground the wall paints under an ink of its own.
   *
   * The scrim is in the list at the backdrop that makes it worst, which is the whole
   * point of it being here: `--surface-base` and `--surface-raised` are declared colours
   * the suite above already measures, and the scrim is the one that renders as neither
   * itself nor as what is behind it.
   */
  const DARK_GROUNDS = [
    ['--surface-base', srgb(token('--surface-base'))],
    ['--surface-raised', srgb(token('--surface-raised'))],
    ['--surface-scrim over a white dress', scrimAt(DECLARED_ALPHA)],
  ] as const

  /** Section 8: anything on the wall clears 7:1, whatever size it is set at. */
  const WALL_TARGET = 7

  it('reads the wall stylesheets, rather than an empty list', () => {
    // Every assertion below is a sweep, and a sweep over nothing is green for ever.
    expect(stylesheets.length).toBeGreaterThan(5)
    expect(declaredInks).toContain('--text-primary')
    expect(declaredInks).toContain('--text-secondary')
    expect(inksIn('font-size: var(--text-xl);')).toEqual([])
  })

  it.each(DARK_GROUNDS)('every ink the wall declares clears 7:1 on %s', (_ground, background) => {
    const failures = declaredInks
      .filter((ink) => !onPaper(ink))
      .map((ink) => [ink, ratioOf(srgb(token(ink)), background as Srgb)] as const)
      .filter(([, ratio]) => ratio < WALL_TARGET)
      .map(([ink, ratio]) => `${ink}: ${ratio.toFixed(2)}`)

    expect(failures).toEqual([])
  })

  it('and the mat carries only the inks named for it', () => {
    // The other half of the partition, so that an ink cannot pass by being measured
    // against the wrong ground: a print ink on a scrim would be dark on dark, and a
    // dark-surface ink on the mat would be light on light.
    const failures = declaredInks
      .filter(onPaper)
      .map((ink) => [ink, ratioOf(srgb(token(ink)), srgb(token('--surface-print')))] as const)
      .filter(([, ratio]) => ratio < WALL_TARGET)
      .map(([ink, ratio]) => `${ink}: ${ratio.toFixed(2)}`)

    expect(failures).toEqual([])
  })

  it('is the least dense scrim that carries them, because the photograph is the hero', () => {
    // Derived rather than chosen, exactly as both glass tints are. A scrim is a grey slab
    // over somebody's photograph, so the alpha is the lowest one at which section 8's
    // sentence is true and not a point more — and asserting that the step below it fails
    // is what makes this a derivation rather than a value with a comment beside it.
    // Both of its contracts: the wall's 7:1 for every ink it declares, and the clip badge on the
    // host console, which reads at body text's own 12:1 for --text-primary (tested below).
    const holds = (alpha: number): boolean =>
      ratioOf(srgb(token('--text-primary')), scrimAt(alpha)) >= 12 &&
      declaredInks
        .filter((ink) => !onPaper(ink))
        .every((ink) => ratioOf(srgb(token(ink)), scrimAt(alpha)) >= WALL_TARGET)

    expect(holds(DECLARED_ALPHA)).toBe(true)
    expect(holds(Number((DECLARED_ALPHA - 0.01).toFixed(2)))).toBe(false)
  })

  /**
   * Who paints it, pinned the way `glass.material.test.ts` pins the two glass surfaces.
   *
   * The token's own comment has said "behind wall captions, over photos" since 2.0, and
   * `Dialog` borrowed it anyway to dim the page behind a modal. Those are two different
   * jobs: one is a ground that has to carry text over an unknown image, the other dims a
   * page and carries nothing at all. Sharing one value meant the caption could not be made
   * legible without also making every modal on a guest's phone nearly opaque.
   */
  it('is painted by the surfaces that put text over an unknown image, and by no others', () => {
    const ALL_STYLESHEETS = import.meta.glob<string>('../**/*.css', {
      query: '?raw',
      import: 'default',
      eager: true,
    })

    const painters = Object.entries(ALL_STYLESHEETS)
      .filter(([, source]) =>
        /background[^;:]*:\s*var\(--surface-scrim\)/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
      )
      .map(([path]) => path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, ''))
      .sort()

    expect(painters).toEqual([
      // The moderation tile's "Vidéo · 8 s" over a poster frame, which is a guest's
      // photograph and can be any brightness at all.
      'features/moderation/components/ModerationCard.module.css',
      // The wall's own notices, top-right, over the photograph.
      'features/wall/WallPage.module.css',
      // Every wall caption.
      'features/wall/components/SlideCaption.module.css',
    ])
  })

  it('carries the clip badge on the host console at body text’s own bar', () => {
    // The one painter that is not the wall, so the 7:1 sweep above does not reach it. A
    // host reads a tile at arm's length rather than from the back of a room, which is
    // body text's 12:1 for `--text-primary` — a higher bar than the wall's, not a lower.
    expect(ratioOf(srgb(token('--text-primary')), scrimAt(DECLARED_ALPHA))).toBeGreaterThanOrEqual(
      12,
    )
  })

  /**
   * The same wall, in every ambiance, by polarity. The captions sit on `--surface-scrim` and
   * their inks are the ambiance's: light inks on a dark scrim over the brightest photograph
   * (white) in the dark ambiances, dark inks on an ivory scrim over the darkest (black) in the
   * Noces. An ambiance that declares no scrim of its own wears the root's, and is measured on it.
   */
  describe.each(AMBIANCES)('in the %s ambiance', (name) => {
    const body = name === 'guinguette' ? ROOT_BLOCK : ambianceBlock(TOKENS, name)
    const own = parseOklchTokens(`:root {${body}}`)
    const of = (property: string): Oklch => own.get(property) ?? token(property)
    const lightInk = luminance(of('--text-primary')) > luminance(of('--surface-base'))
    const worstPhoto: Srgb = lightInk ? WHITE : BLACK
    const scrim = of('--surface-scrim')
    const scrimOver = (alpha: number): Srgb => composite({ ...scrim, alpha }, worstPhoto)
    const wallInks = declaredInks.filter((ink) => !onPaper(ink))

    it.each(['--surface-base', '--surface-raised'] as const)(
      'every ink the wall declares clears 7:1 on %s',
      (surface) => {
        const failures = wallInks
          .map((ink) => [ink, contrast(of(ink), of(surface))] as const)
          .filter(([, ratio]) => ratio < WALL_TARGET)
          .map(([ink, ratio]) => `${ink}: ${ratio.toFixed(2)}`)
        expect(failures).toEqual([])
      },
    )

    const holds = (alpha: number): boolean =>
      ratioOf(srgb(of('--text-primary')), scrimOver(alpha)) >= 12 &&
      wallInks.every((ink) => ratioOf(srgb(of(ink)), scrimOver(alpha)) >= WALL_TARGET)

    it('clears 7:1 for every ink on its scrim over the worst photograph, and 12:1 for the badge', () => {
      expect(holds(scrim.alpha)).toBe(true)
    })

    it.runIf(name === 'noces')(
      'declares the lowest scrim alpha that holds, because the photograph is the hero',
      () => {
        expect(holds(Number((scrim.alpha - 0.01).toFixed(2)))).toBe(false)
      },
    )
  })

  /**
   * Sur mesure (ADR 0011), on the wall: the same two polarities as above, at every ground hue.
   * The captions sit on `--surface-scrim`, tinted by the ground, over the worst photograph.
   */
  describe.each(CUSTOM_POLARITIES)('in the custom %s ambiance, at every ground hue', (polarity) => {
    const worstPhoto: Srgb = polarity === 'dark' ? WHITE : BLACK
    const wallInks = declaredInks.filter((ink) => !onPaper(ink))
    const inkOf = (t: ReadonlyMap<string, Oklch>, name: string): Oklch => t.get(name) ?? token(name)
    const atGround = (hue: number) => customTokens(polarity, hue, CUSTOM_DEFAULT_ACCENT[polarity])
    const scrimOver = (t: ReadonlyMap<string, Oklch>, alpha: number): Srgb =>
      composite({ ...inkOf(t, '--surface-scrim'), alpha }, worstPhoto)
    const holds = (t: ReadonlyMap<string, Oklch>, alpha: number): boolean =>
      ratioOf(srgb(inkOf(t, '--text-primary')), scrimOver(t, alpha)) >= 12 &&
      wallInks.every((ink) => ratioOf(srgb(inkOf(t, ink)), scrimOver(t, alpha)) >= WALL_TARGET)

    it('every ink the wall declares clears 7:1 on both surfaces it paints', () => {
      for (const hue of GROUND_HUES) {
        const t = atGround(hue)
        for (const surface of ['--surface-base', '--surface-raised'] as const)
          for (const ink of wallInks)
            expect(
              contrast(inkOf(t, ink), inkOf(t, surface)),
              `${ink} on ${surface} at ground hue ${hue}`,
            ).toBeGreaterThanOrEqual(WALL_TARGET)
      }
    })

    it('clears 7:1 for every ink on its scrim over the worst photograph, and 12:1 for the badge', () => {
      for (const hue of GROUND_HUES)
        expect(
          holds(atGround(hue), atGround(hue).get('--surface-scrim')?.alpha ?? 0),
          `ground ${hue}`,
        ).toBe(true)
    })

    it('declares the lowest scrim alpha that holds at the hue that needs it most', () => {
      const alpha = atGround(0).get('--surface-scrim')?.alpha ?? 0
      const below = Number((alpha - 0.01).toFixed(2))
      expect(GROUND_HUES.some((hue) => !holds(atGround(hue), below))).toBe(true)
    })
  })
})

/**
 * Sur mesure, ADR 0011 decision 3: the proof is a sweep.
 *
 * Both polarities, every bar the per-ambiance suites above hold, at **every ground hue** on a
 * 15 degree grid (0 to 345, and 359 to close the circle) crossed with **every accent hue** on the
 * same grid plus the block's own default. The domain refuses an accent only for crowding a status
 * colour, never for legibility, so measuring all of them is a superset of the hues it accepts:
 * nothing it could accept is unmeasured. `var(--ground-hue)` and `var(--accent-hue)` are resolved
 * by substitution, which is what the browser does on the element that carries them.
 *
 * Never weaken a bar here: a tone that cannot hold at some hue is changed in tokens.css.
 */
describe.each(CUSTOM_POLARITIES)(
  'the custom %s ambiance, at every ground hue (ADR 0011)',
  (polarity) => {
    const worstPhoto: Srgb = polarity === 'dark' ? WHITE : BLACK
    const body = customBody(polarity)
    const defaultAccent = CUSTOM_DEFAULT_ACCENT[polarity]
    const accents = [...new Set([...GRID, defaultAccent])]
    const at = (ground: number, accent: number = defaultAccent) =>
      customTokens(polarity, ground, accent)
    const of = (t: ReadonlyMap<string, Oklch>, name: string): Oklch => {
      const value = t.get(name) ?? ROOT_FALLBACK.get(name)
      if (value === undefined)
        throw new Error(`the custom ${polarity} block does not restate ${name}`)
      return value
    }

    /** The lowest ratio of `measure` over a set of hues, with where it happened. */
    const lowest = (
      measure: (t: ReadonlyMap<string, Oklch>) => number,
      pairs: boolean,
    ): { ratio: number; where: string } => {
      let low = { ratio: Number.POSITIVE_INFINITY, where: '' }
      for (const ground of GRID)
        for (const accent of pairs ? accents : [defaultAccent]) {
          const ratio = measure(at(ground, accent))
          if (ratio < low.ratio)
            low = { ratio, where: `ground hue ${ground}, accent hue ${accent}` }
        }
      return low
    }
    const expectAtLeast = (
      label: string,
      bar: number,
      measure: (t: ReadonlyMap<string, Oklch>) => number,
      pairs = false,
    ): void => {
      const { ratio, where } = lowest(measure, pairs)
      expect(ratio, `${label}: worst ${ratio.toFixed(2)} at ${where}`).toBeGreaterThanOrEqual(bar)
    }

    it('sweeps 25 ground hues, closes the circle, and crosses them with every accent on the grid', () => {
      expect(GRID).toHaveLength(25)
      expect(GRID[0]).toBe(0)
      expect(GRID[23]).toBe(345)
      expect(GRID[24]).toBe(359)
      expect(accents.length).toBeGreaterThanOrEqual(25)
      expect(accents).toContain(defaultAccent)
    })

    it('has its own block, whose lightness and chroma are fixed and whose hues are the variables', () => {
      // Nothing in the block spells a hue of its own except the semantic colours and the default
      // accent: every surface and ink reads the ground hue, every accent token the accent hue.
      for (const name of [
        '--surface-base',
        '--surface-raised',
        '--surface-overlay',
        '--border-subtle',
        '--border-strong',
        '--text-primary',
        '--text-secondary',
        '--text-muted',
        '--surface-scrim',
        '--glass-tint-photo',
        '--glass-tint-ground',
      ])
        expect(body, name).toMatch(
          new RegExp(`${name}:\\s*oklch\\([\\d.]+% [\\d.]+ var\\(--ground-hue\\)`),
        )
      for (const name of ['--accent', '--accent-strong', '--accent-contrast'])
        expect(body, name).toMatch(
          new RegExp(`${name}:\\s*oklch\\([\\d.]+% [\\d.]+ var\\(--accent-hue\\)`),
        )
      expect(body).toMatch(/--accent-texture:\s*none;/)
      expect(body).toMatch(/--ambiance-ground:\s*none;/)
    })

    it.each([
      ['--text-primary', 12],
      ['--text-secondary', 7],
      ['--text-muted', 4.5],
    ] as const)('keeps %s above its bar on every surface it declares', (ink, bar) => {
      for (const surface of SURFACES)
        expectAtLeast(`${ink} on ${surface}`, bar, (t) => contrast(of(t, ink), of(t, surface)))
    })

    it.each(SURFACES)('keeps its --border-strong visible on %s', (surface) => {
      expectAtLeast(`--border-strong on ${surface}`, 3, (t) =>
        contrast(of(t, '--border-strong'), of(t, surface)),
      )
    })

    it.each(['--success', '--danger', '--warning'] as const)(
      'keeps %s readable as text on --surface-raised and as a glyph on every surface',
      (status) => {
        expectAtLeast(`${status} on --surface-raised`, 4.5, (t) =>
          contrast(of(t, status), of(t, '--surface-raised')),
        )
        for (const surface of SURFACES)
          expectAtLeast(`${status} glyph on ${surface}`, 3, (t) =>
            contrast(of(t, status), of(t, surface)),
          )
      },
    )

    it('keeps the label on its accent readable at rest and under a finger, at every accent hue', () => {
      expectAtLeast(
        'label on --accent',
        7,
        (t) => contrast(of(t, '--accent-contrast'), of(t, '--accent')),
        true,
      )
      expectAtLeast(
        'label on --accent-strong',
        4.5,
        (t) => contrast(of(t, '--accent-contrast'), of(t, '--accent-strong')),
        true,
      )
    })

    it('keeps the accent readable from the back of the room, and as a link on the other surfaces', () => {
      expectAtLeast(
        '--accent on --surface-base',
        7,
        (t) => contrast(of(t, '--accent'), of(t, '--surface-base')),
        true,
      )
      for (const surface of ['--surface-raised', '--surface-overlay'] as const)
        expectAtLeast(
          `--accent on ${surface}`,
          4.5,
          (t) => contrast(of(t, '--accent'), of(t, surface)),
          true,
        )
    })

    it('keeps the focus ring visible on every surface, for every accent hue', () => {
      for (const surface of SURFACES)
        expectAtLeast(
          `focus ring on ${surface}`,
          3,
          (t) => {
            const ground = srgb(of(t, surface))
            return ratioOf(composite(of(t, '--focus-ring-colour'), ground), ground)
          },
          true,
        )
    })

    it.each([
      ['--text-primary', 12],
      ['--text-secondary', 7],
      ['--text-muted', 4.5],
    ] as const)(
      'keeps %s above its bar on its glass over the worst photograph, and no worse than on the overlay',
      (ink, bar) => {
        expectAtLeast(`${ink} on glass`, bar, (t) =>
          ratioOf(srgb(of(t, ink)), composite(of(t, '--glass-tint-photo'), worstPhoto)),
        )
        expectAtLeast(
          `${ink} on glass vs overlay`,
          1,
          (t) =>
            ratioOf(srgb(of(t, ink)), composite(of(t, '--glass-tint-photo'), worstPhoto)) /
            ratioOf(srgb(of(t, ink)), srgb(of(t, '--surface-overlay'))),
        )
      },
    )

    it('declares the lowest glass alpha that holds, at the hue that needs it most', () => {
      const holds = (t: ReadonlyMap<string, Oklch>, alpha: number): boolean => {
        const pane = composite({ ...of(t, '--glass-tint-photo'), alpha }, worstPhoto)
        for (const [ink, bar] of [
          ['--text-primary', 12],
          ['--text-secondary', 7],
          ['--text-muted', 4.5],
        ] as const) {
          const ratio = ratioOf(srgb(of(t, ink)), pane)
          if (ratio < bar) return false
          if (ratio < ratioOf(srgb(of(t, ink)), srgb(of(t, '--surface-overlay')))) return false
        }
        for (const status of ['--success', '--danger', '--warning'] as const)
          if (ratioOf(srgb(of(t, status)), pane) < 3) return false
        return ratioOf(srgb(of(t, '--accent')), pane) >= 4.5
      }
      const alpha = of(at(0), '--glass-tint-photo').alpha
      for (const ground of GRID)
        for (const accent of accents)
          expect(holds(at(ground, accent), alpha), `ground ${ground}, accent ${accent}`).toBe(true)
      const below = Number((alpha - 0.01).toFixed(2))
      expect(
        GRID.some((ground) => accents.some((accent) => !holds(at(ground, accent), below))),
      ).toBe(true)
    })

    it('keeps the join card and the QR at the wall’s bar, at every ground and accent hue', () => {
      const resolve = (t: ReadonlyMap<string, Oklch>, property: string): Oklch => {
        const declared = new RegExp(`${property}:\\s*([^;]+);`).exec(body)?.[1]?.trim()
        if (declared === undefined) throw new Error(`the block declares no ${property}`)
        const reference = /^var\((--[a-z-]+)\)$/.exec(declared)?.[1]
        return of(t, reference ?? property)
      }
      for (const ink of ['--wall-card-ink', '--wall-card-ink-2'] as const)
        expectAtLeast(
          `${ink} on its paper`,
          7,
          (t) => contrast(resolve(t, ink), resolve(t, '--wall-card-bg')),
          true,
        )
      expectAtLeast('QR dark on light', 7, (t) =>
        contrast(resolve(t, '--qr-ink'), resolve(t, '--qr-field')),
      )
      for (const hue of GRID) {
        const t = at(hue)
        expect(luminance(resolve(t, '--qr-ink'))).toBeLessThan(luminance(resolve(t, '--qr-field')))
      }
    })

    it('restates the semantic colours darker in the light block, and keeps the root’s in the dark one', () => {
      if (polarity === 'light') expect(body).toMatch(/--success:[\s\S]*--danger:[\s\S]*--warning:/)
      else expect(body).not.toMatch(/--(success|danger|warning):/)
    })

    it('wears no photograph of its own, and the polarity of its scheme is declared', () => {
      expect(body).toMatch(/--ambiance-ground:\s*none;/)
      if (polarity === 'light') expect(body).toMatch(/color-scheme:\s*light;/)
      else expect(body).not.toMatch(/color-scheme:/)
    })
  },
)

describe('the faces a Sur mesure event borrows (ADR 0011)', () => {
  const FACE_PROPERTIES = [
    '--font-heading',
    '--font-display',
    '--font-display-weight',
    '--button-radius',
  ] as const
  const valueIn = (css: string, property: string): string | undefined =>
    new RegExp(`${property}:\\s*([^;]+);`).exec(css)?.[1]?.trim()

  it.each(AMBIANCES)(
    'restates the %s’s faces, display weight and control radius exactly',
    (name) => {
      const rule = new RegExp(`\\n\\[data-ambiance-faces='${name}'\\][^{]*\\{([^}]*)\\}`).exec(
        TOKENS,
      )?.[1]
      if (rule === undefined) throw new Error(`tokens.css declares no faces block for ${name}`)
      const owner = name === 'guinguette' ? ROOT_BLOCK : ambianceBlock(TOKENS, name)
      for (const property of FACE_PROPERTIES)
        expect(valueIn(rule, property), `${property} of ${name}`).toBe(valueIn(owner, property))
    },
  )

  it('moves nothing but those four properties', () => {
    const rules = [...TOKENS.matchAll(/\n\[data-ambiance-faces='[a-z]+'\][^{]*\{([^}]*)\}/g)]
    expect(rules).toHaveLength(AMBIANCES.length)
    for (const [, declarations] of rules)
      expect([...(declarations ?? '').matchAll(/(--[a-z-]+):/g)].map((match) => match[1])).toEqual([
        ...FACE_PROPERTIES,
      ])
  })
})
