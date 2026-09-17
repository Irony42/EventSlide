/**
 * WCAG contrast, over `oklch` triples.
 *
 * It lives in the domain because "is this palette legible from the back of the room" is
 * a rule about what the product will let a host do, not a stylesheet concern. The rule
 * that uses it is `eventTheme.ts`; this file is only the arithmetic, so the rule can be
 * read without it and this can be tested without the rule.
 *
 * The same conversion exists a second time in `web/src/design-system/tokens.contrast.test.ts`,
 * which measures the shipped stylesheet. That duplication is not an oversight: the web
 * app may not import from `src/` (see `eslint.config.mjs`), and the two are pinned
 * together by `src/interface/http/presenters/eventThemeContract.test.ts`, which reads
 * `tokens.css` and compares it against what this module's caller derives.
 */

export interface Oklch {
  /** Perceptual lightness, 0-1 rather than the CSS percentage. */
  readonly l: number
  readonly c: number
  /** Degrees, 0-359. */
  readonly h: number
}

/** Oklab to linear sRGB. The matrices are from the CSS Color 4 specification. */
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
 * an `oklch` value can sit slightly outside sRGB, and a negative channel would
 * otherwise flatter the ratio.
 */
const clamp = (value: number): number => Math.min(1, Math.max(0, value))

const luminance = (colour: Oklch): number => {
  const [r, g, b] = toLinearSrgb(colour)
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b)
}

/** The WCAG ratio, between 1 and 21. Order of the arguments does not matter. */
export const contrastRatio = (a: Oklch, b: Oklch): number => {
  const first = luminance(a)
  const second = luminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The shorter way round the hue circle, in degrees, between 0 and 180.
 *
 * A wheel has two arcs between any two points and only the shorter one is what an eye
 * reports, which is why `Math.abs(a - b)` is wrong here: hue 350 and hue 10 differ by
 * 340 arithmetically and by 20 to a viewer.
 */
export const hueDistance = (a: number, b: number): number => {
  const raw = Math.abs(a - b) % 360
  return raw > 180 ? 360 - raw : raw
}

/**
 * How far apart two colours are in Oklab, as a straight line through the space.
 *
 * Hue distance alone answers a different question from the one this product asks. Two
 * tokens can sit thirty degrees apart on the wheel and still be much closer to each
 * other than another pair thirty degrees apart, because each carries its own lightness
 * and chroma: `--warning` is light and weak, `--danger` is dark and strong. Measuring
 * the angle and calling it separation compares an accent against three targets on a
 * scale that means something different for each of them.
 *
 * Oklab is built so that a Euclidean distance in it tracks perceived difference, which
 * is why the comparison happens here rather than on the hue alone.
 */
export const oklabDistance = (a: Oklch, b: Oklch): number => {
  const toLab = ({ l, c, h }: Oklch): readonly [number, number, number] => {
    const radians = (h * Math.PI) / 180
    return [l, c * Math.cos(radians), c * Math.sin(radians)]
  }
  const [firstL, firstA, firstB] = toLab(a)
  const [secondL, secondA, secondB] = toLab(b)
  return Math.hypot(firstL - secondL, firstA - secondA, firstB - secondB)
}
