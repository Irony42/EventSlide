import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  ambianceBlock,
  luminanceOf,
  parseOklchTokens,
  srgb,
  withoutAmbiances,
  type Oklch,
  type Srgb,
} from '../web/src/design-system/testing/srgb'

/**
 * Text over a photographed ground (ADR 0010), measured on the photograph that ships.
 *
 * Every ambiance paints a photograph behind the guest's page under a grade, and the event's
 * name, the intro and the signature sit directly on it, not on a pane. The grade is what makes
 * that legible, and a grade chosen by eye is a number nobody can defend: the bright part of a
 * photograph of string lights is a bulb, and a bulb under too thin a grade is a white field.
 *
 * So this reads each WebP itself, crops it the way `background-size: cover` does on a phone in
 * portrait, applies the grade the stylesheet declares at each row, and holds the three inks to
 * the product's own bars against the 99th percentile of the result: the brightest ground a
 * line of text can realistically land on, ignoring the few pixels at the core of a bulb.
 */

const ROOT = process.cwd()
const TOKENS = readFileSync(join(ROOT, 'web/src/design-system/tokens.css'), 'utf8')

const AMBIANCES = ['guinguette', 'riviera', 'champs', 'bivouac', 'cabaret'] as const

/**
 * Ambiances whose grade is deliberately denser than the lowest that holds on the phone, and
 * why. The phone's top half is what is measured; the wall's centre, where an empty room prints
 * the event's name over the graded photograph, is not, so a very dark photograph still gets a
 * floor. The test then asserts the floor holds and is not mistaken for a derivation.
 */
const FLOORED: Readonly<Record<string, string>> = {
  bivouac: 'a night sky is dark already (0.05 would hold), and a flame sits in the wall’s centre',
}

/** An ambiance's own block; the Guinguette's is the root's. */
const blockOf = (name: string): string =>
  name === 'guinguette'
    ? (/:root \{[\s\S]*?\n\}/.exec(withoutAmbiances(TOKENS))?.[0] ?? '')
    : ambianceBlock(TOKENS, name)

const inksOf = (name: string): ((token: string) => Oklch) => {
  const inks = parseOklchTokens(blockOf(name).replace(/^:root \{/, ':root {\n'))
  return (token) => {
    const value = inks.get(token)
    if (value === undefined) throw new Error(`the ${name} block does not restate ${token}`)
    return value
  }
}

/** The grade's stops, `oklch(… / alpha) position%`, in order down the page. */
const gradeOf = (name: string) => {
  const grade = /--ambiance-grade:([\s\S]*?);/.exec(blockOf(name))?.[1]
  if (grade === undefined) throw new Error(`the ${name} block declares no --ambiance-grade`)
  const stops = [...grade.matchAll(/oklch\(([^)]*)\/\s*([\d.]+)\)\s*(?:([\d.]+)%)?/g)]
  if (stops.length < 2) throw new Error('the grade is not a gradient of oklch stops')
  const colour = parseOklchTokens(`:root {
  --g: oklch(${(stops[0]?.[1] ?? '').trim()});
}`).get('--g')
  if (colour === undefined) throw new Error('the grade colour is not oklch')
  return {
    colour: srgb(colour),
    stops: stops.map((stop, index) => ({
      alpha: Number(stop[2]),
      at: stop[3] === undefined ? index / (stops.length - 1) : Number(stop[3]) / 100,
    })),
  }
}

type Grade = ReturnType<typeof gradeOf>

const alphaAt = (grade: Grade, y: number): number => {
  const { stops } = grade
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (a === undefined || b === undefined) continue
    if (y <= b.at) return a.alpha + ((b.alpha - a.alpha) * (y - a.at)) / (b.at - a.at || 1)
  }
  return stops[stops.length - 1]?.alpha ?? 1
}

/** The photograph as a 390 × 844 phone crops it, once per ambiance. */
const phoneCrop = async (name: string) => {
  const image = sharp(join(ROOT, `web/src/design-system/ambiances/${name}-ground-1600.webp`))
  const { width = 0, height = 0 } = await image.metadata()
  // `cover` on a portrait screen. A photograph wider than the phone shows the full height and
  // the centre of the width; a taller one would show the full width and the top of the height.
  const phone = 390 / 844
  const cropWidth = Math.min(width, Math.round(height * phone))
  const cropHeight = Math.min(height, Math.round(width / phone))
  const left = Math.max(0, Math.round((width - cropWidth) / 2))
  return image
    .extract({ left, top: 0, width: cropWidth, height: cropHeight })
    .resize({ width: 195 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
}

/** The graded ground's luminances in a band of the page, sorted. */
const groundLuminances = async (
  name: string,
  grade: Grade,
  fromY: number,
  toY: number,
): Promise<number[]> => {
  const { data, info } = await phoneCrop(name)
  const out: number[] = []
  const [gr, gg, gb] = grade.colour
  for (let row = Math.floor(fromY * info.height); row < Math.ceil(toY * info.height); row++) {
    const a = alphaAt(grade, row / info.height)
    for (let col = 0; col < info.width; col++) {
      const i = (row * info.width + col) * 3
      const pixel: Srgb = [(data[i] ?? 0) / 255, (data[i + 1] ?? 0) / 255, (data[i + 2] ?? 0) / 255]
      // The browser blends in encoded sRGB, which is what `composite` in srgb.ts does too.
      out.push(
        luminanceOf([
          gr * a + pixel[0] * (1 - a),
          gg * a + pixel[1] * (1 - a),
          gb * a + pixel[2] * (1 - a),
        ]),
      )
    }
  }
  return out.sort((x, y) => x - y)
}

const ratio = (inkLuminance: number, groundLuminance: number): number =>
  (Math.max(inkLuminance, groundLuminance) + 0.05) /
  (Math.min(inkLuminance, groundLuminance) + 0.05)

const INKS = ['--text-primary', '--text-secondary', '--text-muted'] as const

/** The top half of the phone, where the name, the intro and the signature sit on the ground. */
const BAND = [0, 0.5] as const

describe.each(AMBIANCES)('text over the %s’s photographed ground', (name) => {
  const ink = inksOf(name)
  const grade = gradeOf(name)

  const holdsAt = async (topAlpha: number): Promise<boolean> => {
    // The grade's other stops keep their offsets from the declared top, which is how every
    // block here is written: the top stop moves, the rest follow it.
    const first = grade.stops[0]?.alpha ?? 0
    const shifted: Grade = {
      colour: grade.colour,
      stops: grade.stops.map((stop, index) =>
        index === grade.stops.length - 1
          ? stop
          : { at: stop.at, alpha: Math.max(0, stop.alpha - first + topAlpha) },
      ),
    }
    const luminances = await groundLuminances(name, shifted, ...BAND)
    const p99 = luminances[Math.floor(luminances.length * 0.99)] ?? 1
    return INKS.every((token) => ratio(luminanceOf(srgb(ink(token))), p99) >= 4.5)
  }

  it('ships a photograph and declares it', () => {
    expect(blockOf(name)).toContain(`ambiances/${name}-ground-1600.webp`)
  })

  it.each(INKS)(
    'keeps %s above 4.5:1 on the 99th percentile of the graded photograph',
    async (token) => {
      const luminances = await groundLuminances(name, grade, ...BAND)
      const p99 = luminances[Math.floor(luminances.length * 0.99)] ?? 1
      expect(ratio(luminanceOf(srgb(ink(token))), p99)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it(
    FLOORED[name] === undefined
      ? 'declares the lowest top alpha that holds, so the grade is derived and not chosen'
      : `declares a deliberate floor (${FLOORED[name]}), and the floor holds`,
    async () => {
      const declared = grade.stops[0]?.alpha ?? 1

      expect(await holdsAt(declared)).toBe(true)
      const below = Number((declared - 0.01).toFixed(2))
      // A derived grade fails one step lower. A floored one still holds there: it is a choice
      // made for the wall, said out loud, and it may never be a way to hide a failing grade.
      expect(await holdsAt(below)).toBe(FLOORED[name] !== undefined)
    },
  )
})
