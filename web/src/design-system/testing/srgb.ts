/**
 * The arithmetic the accessibility contract is measured with — docs/DESIGN-SYSTEM.md §8.
 *
 * Nothing in the bundle imports this: it is a harness, and it lives under `testing/` for
 * the reason every other folder of that name in this repository does — so that a guard and
 * the number it guards are computed by one implementation rather than by two that agree
 * until somebody edits one of them.
 *
 * It exists because roadmap 11.2 gave the material a second tint floor. The floor is
 * derived in `tokens.contrast.test.ts` against the brightest field this product paints, and
 * `app/glassBackdrop.test.ts` refuses a screen that could paint a brighter one. Those two
 * numbers have to be the same number; a second copy of `toLinearSrgb` is how they would
 * stop being.
 *
 * ## Two kinds of arithmetic, deliberately
 *
 * A ratio between two **declared** colours can be taken in linear light, which is what
 * `toLinearSrgb` is for. A ratio involving a **translucent** ground cannot: alpha
 * compositing happens in gamma-encoded sRGB — which is why 50% black over white renders as
 * mid grey rather than the much darker colour a linear blend gives — so `composite` encodes
 * first, blends, and lets `luminanceOf` decode again. Measuring a blend in Oklab or in
 * linear light flatters it by a wide margin, and the glass tint floor is exactly the number
 * that would have been flattered.
 */

export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly alpha: number
}

/** A colour the way the compositor holds it: gamma-encoded sRGB, per channel 0-1. */
export type Srgb = readonly [number, number, number]

/**
 * `--name: oklch(L% C H)` or `oklch(L% C H / A)`, ignoring tokens that wrap a shadow.
 *
 * Read off the stylesheet rather than copied into a list, so a token edited without
 * updating a test fails there instead of being quietly untested (CLAUDE.md §3.2).
 */
export const parseOklchTokens = (css: string): ReadonlyMap<string, Oklch> => {
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

/** Oklab → linear sRGB. The matrices are from the CSS Color 4 specification. */
export const toLinearSrgb = ({ l, c, h }: Oklch): readonly [number, number, number] => {
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

const bounded = (value: number): number => Math.min(1, Math.max(0, value))

/** Linear light to sRGB: the transfer function the specification defines. */
const encode = (channel: number): number => {
  const value = bounded(channel)
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

const decode = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

/**
 * A declared colour, encoded the way it is painted.
 *
 * Clamped by `encode`, because a wide-gamut oklch value can sit slightly outside sRGB and a
 * negative channel would otherwise flatter the ratio.
 */
export const srgb = (colour: Oklch): Srgb => {
  const [r, g, b] = toLinearSrgb(colour)
  return [encode(r), encode(g), encode(b)]
}

/** WCAG relative luminance, from encoded channels. */
export const luminanceOf = ([r, g, b]: Srgb): number =>
  0.2126 * decode(r) + 0.7152 * decode(g) + 0.0722 * decode(b)

export const ratioOf = (a: Srgb, b: Srgb): number => {
  const [light, dark] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** `source` painted over `backdrop` at `source`'s own alpha. */
export const composite = (source: Oklch, backdrop: Srgb): Srgb => {
  const [r, g, b] = srgb(source)
  const [backR, backG, backB] = backdrop
  const a = source.alpha
  return [r * a + backR * (1 - a), g * a + backG * (1 - a), b * a + backB * (1 - a)]
}

/** The ceiling of the gamut: a white dress in full sun, and nothing can be brighter. */
export const WHITE: Srgb = [1, 1, 1]

/**
 * The same token at whichever of the 360 hues renders lightest.
 *
 * Roadmap 2.2 lets a host move `--accent-hue` and nothing else, so a token derived from it
 * is not one colour but a circle of them — and oklch's `L` is perceptual lightness, which
 * does not track relative luminance: a yellow and a blue at the same `L` are far apart on
 * the axis WCAG measures. The worst case therefore has to be found rather than assumed.
 *
 * This is the backdrop the ground tint floor is derived against, and the ceiling
 * `app/glassBackdrop.test.ts` refuses a brighter field than — one function, so the floor
 * and the guard cannot come to different answers about the same colour.
 */
export const lightestHue = (colour: Oklch): Oklch =>
  Array.from({ length: 360 }, (_unused, h) => ({ ...colour, h })).reduce((light, next) =>
    luminanceOf(srgb(next)) > luminanceOf(srgb(light)) ? next : light,
  )
