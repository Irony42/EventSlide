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
