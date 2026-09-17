import { describe, expect, it } from 'vitest'
// Vite's `?raw` rather than `node:fs`: the web project runs under jsdom, where
// `import.meta.url` is not a `file:` URL and `fileURLToPath` throws. This also keeps the
// test reading the same file the bundle does.
import TOKENS from './tokens.css?raw'
// The wall's caption styles, for the one failure mode a colour pair cannot express.
import CAPTIONS from '../features/wall/components/SlideCaption.module.css?raw'

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

interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly alpha: number
}

/** `--name: oklch(L% C H)` or `oklch(L% C H / A)`, ignoring tokens that wrap a shadow. */
const parseTokens = (css: string): ReadonlyMap<string, Oklch> => {
  const found = new Map<string, Oklch>()
  const pattern =
    /^\s*(--[a-z-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)\s*;/gm

  for (const match of css.matchAll(pattern)) {
    const [, name, l, c, h, alpha] = match
    if (name === undefined || l === undefined || c === undefined || h === undefined) continue
    found.set(name, {
      l: Number(l) / 100,
      c: Number(c),
      h: Number(h),
      alpha: alpha === undefined ? 1 : Number(alpha),
    })
  }
  return found
}

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

const tokens = parseTokens(TOKENS.replaceAll('var(--accent-hue)', DECLARED_HUE[1]))

const token = (name: string): Oklch => {
  const value = tokens.get(name)
  if (value === undefined) {
    throw new Error(`${name} is not an oklch token in tokens.css — did it get renamed?`)
  }
  return value
}

/** Oklab → linear sRGB. The matrices are from the CSS Color 4 specification. */
const toLinearSrgb = ({ l, c, h }: Oklch): readonly [number, number, number] => {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ]
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
  const found = /--focus-ring:[^;]*\/\s*([\d.]+)\s*\)/.exec(TOKENS)
  if (found?.[1] === undefined) {
    throw new Error('--focus-ring declares no alpha in tokens.css — did its shape change?')
  }
  return Number(found[1])
})()

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

  it('resolves the accent from the hue an unthemed event renders', () => {
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
  /** A colour the way the compositor holds it: gamma-encoded sRGB, per channel 0-1. */
  type Srgb = readonly [number, number, number]

  const bounded = (value: number): number => Math.min(1, Math.max(0, value))

  /** Linear light to sRGB: the transfer function the specification defines. */
  const encode = (channel: number): number => {
    const value = bounded(channel)
    return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  }

  const decode = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

  const srgb = (colour: Oklch): Srgb => {
    const [r, g, b] = toLinearSrgb(colour)
    return [encode(r), encode(g), encode(b)]
  }

  const luminanceOf = ([r, g, b]: Srgb): number =>
    0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)

  const ratioOf = (a: Srgb, b: Srgb): number => {
    const [light, dark] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x) as [number, number]
    return (light + 0.05) / (dark + 0.05)
  }

  /** `source` painted over `backdrop` at `source`'s own alpha. */
  const composite = (source: Oklch, backdrop: Srgb): Srgb => {
    const [r, g, b] = srgb(source)
    const [backR, backG, backB] = backdrop
    const a = source.alpha
    return [r * a + backR * (1 - a), g * a + backG * (1 - a), b * a + backB * (1 - a)]
  }

  /** The ceiling of the gamut: a white dress in full sun, and nothing can be brighter. */
  const WHITE: Srgb = [1, 1, 1]

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
  const pane = (backdrop: Srgb): Srgb => composite(token('--glass-tint'), backdrop)

  /** The lightest the pane can ever be, and therefore the hardest ground it offers. */
  const lightestPane = (): Srgb => pane(WHITE)

  /** docs/DESIGN-SYSTEM.md §8, by token. */
  const TEXT_TARGETS = [
    ['--text-primary', 12],
    ['--text-secondary', 7],
    ['--text-muted', 4.5],
  ] as const

  it('is --surface-raised with an alpha rather than a shade of its own', () => {
    // The tint and the fallback are one colour at two alphas, which is what makes the
    // no-blur tier a surface this product already ships rather than a degraded mode
    // nobody has looked at. A new grey between two existing ones is a rejected change
    // (§2), and it would be one here too if the material invented its own.
    const tint = token('--glass-tint')
    const raised = token('--surface-raised')

    expect({ l: tint.l, c: tint.c, h: tint.h }).toEqual({ l: raised.l, c: raised.c, h: raised.h })
    expect(tint.alpha).toBeLessThan(1)
    expect(TOKENS).toMatch(/--glass-opaque:\s*var\(--surface-raised\)\s*;/)
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

  /**
   * The gap this material does **not** close, measured so that it stops being invisible.
   *
   * `--surface-scrim` is the same idea as the glass tint — a translucent ground over an
   * unknown photograph — and it predates it by two releases. Composited over a white
   * photograph it gives `--text-primary` 4.36:1 and `--text-secondary` 2.38:1, against
   * §8's "anything on the wall ≥ 7:1 regardless of size". Every wall caption sits on it,
   * and the suite above could not see it because both numbers it compared were declared.
   *
   * Recorded rather than fixed here because fixing it changes what the projector renders,
   * and the committed baselines in `tests/e2e/visual/` exist precisely so that cannot
   * happen by accident: it is a re-baseline with a human looking at every image. The
   * number is asserted in the direction it is wrong in, the way the polaroid mat above
   * is — so whoever raises the scrim fails this test and is told to delete it.
   */
  it('records the wall scrim, which is the same problem and is still open', () => {
    const scrimOverPhoto = composite(token('--surface-scrim'), WHITE)

    // Pinned close to what was measured — 4.36 and 2.38 — rather than loosely under the
    // 7:1 bar. A pin with slack is a pin that lets the number drift further the wrong way
    // and still reports the same thing.
    expect(ratioOf(srgb(token('--text-primary')), scrimOverPhoto)).toBeLessThan(4.5)
    expect(ratioOf(srgb(token('--text-secondary')), scrimOverPhoto)).toBeLessThan(2.5)
  })
})
