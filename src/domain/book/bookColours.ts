import { toLinearSrgb, type Oklch } from '../events/contrast'

export interface Srgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const encode = (linear: number): number => {
  const clamped = Math.min(1, Math.max(0, linear))
  const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
  return Math.round(gamma * 255)
}

/** An `oklch` colour as 8-bit sRGB, clamped into the gamut (a PDF has no wider space). */
export const oklchToSrgb = (colour: Oklch): Srgb => {
  const [r, g, b] = toLinearSrgb(colour)
  return { r: encode(r), g: encode(g), b: encode(b) }
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

export const srgbToHex = ({ r, g, b }: Srgb): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`

export const oklchToHex = (colour: Oklch): string => srgbToHex(oklchToSrgb(colour))

const linear = (channel: number): number => {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

const parseHex = (hex: string): Srgb => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
})

/** WCAG relative luminance of a `#rrggbb` colour. */
export const luminanceOfHex = (hex: string): number => {
  const { r, g, b } = parseHex(hex)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** The WCAG ratio between two `#rrggbb` colours, 1 to 21, whichever order. */
export const contrastOfHex = (a: string, b: string): number => {
  const first = luminanceOfHex(a)
  const second = luminanceOfHex(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** The least contrast text may have against its paper (WCAG AA for body text). */
export const MIN_TEXT_CONTRAST = 4.5

/**
 * The theme's accent as **text** on a paper: the hue and the chroma of the accent, darkened from a
 * lightness of 0.55 until it reads at 4.5:1 (about 0.5 on ivory, darker on kraft). The light tone
 * stays for what is not read: rules, tape, badges.
 */
export const legibleAccent = (hue: number, paperHex: string, chroma: number): string => {
  let lightness = 0.55
  let hex = oklchToHex({ l: lightness, c: chroma, h: hue })
  while (contrastOfHex(hex, paperHex) < MIN_TEXT_CONTRAST && lightness > 0.1) {
    lightness -= 0.01
    hex = oklchToHex({ l: lightness, c: chroma, h: hue })
  }
  return hex
}
