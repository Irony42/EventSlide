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

const tokens = parseTokens(TOKENS)

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

  it.each(SURFACES)('--border-strong stays visible against %s', (surface) => {
    // An input's rest state is a border and nothing else. WCAG 1.4.11 puts the floor for
    // a UI component's boundary at 3:1, and below that it reads as an absent field — a
    // guest does not tap what does not look tappable. Checked on all three surfaces
    // because inputs appear inside cards and dialogs, not only on the page ground.
    expect(contrast(token('--border-strong'), token(surface))).toBeGreaterThanOrEqual(3)
  })
})
