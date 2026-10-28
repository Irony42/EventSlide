import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  luminanceOf,
  parseOklchTokens,
  srgb,
  type Oklch,
  type Srgb,
} from '../web/src/design-system/testing/srgb'

/**
 * Text over a photographed ground (ADR 0010), measured on the photograph that ships.
 *
 * The Guinguette paints a photograph behind the guest's page under a grade, and the event's
 * name, the intro and the signature sit directly on it, not on a pane. The grade is what makes
 * that legible, and a grade chosen by eye is a number nobody can defend: the bright part of a
 * photograph of string lights is a bulb, and a bulb under too thin a grade is a white field.
 *
 * So this reads the WebP itself, crops it the way `background-size: cover` does on a phone in
 * portrait, applies the grade the stylesheet declares at each row, and holds the inks to the
 * product's own bars against the 99th percentile of the result: the brightest ground a line of
 * text can realistically land on, ignoring the few pixels at the core of a bulb.
 */

const ROOT = process.cwd()
const TOKENS = readFileSync(join(ROOT, 'web/src/design-system/tokens.css'), 'utf8')
const GROUND = join(ROOT, 'web/src/design-system/ambiances/guinguette-ground-1600.webp')

/** The Guinguette's own block, read the way the ambiance contrast tests read it. */
const block = (() => {
  const found = /\[data-event-ambiance='guinguette'\][^{]*\{([\s\S]*?)\n\}/.exec(TOKENS)
  if (found?.[1] === undefined) throw new Error('tokens.css declares no guinguette block')
  return found[1]
})()
const inks = parseOklchTokens(`:root {${block}}`)
const ink = (name: string): Oklch => {
  const value = inks.get(name)
  if (value === undefined) throw new Error(`the guinguette block does not restate ${name}`)
  return value
}

/** The grade's stops, `oklch(… / alpha) position%`, in order down the page. */
const gradeStops = (() => {
  const grade = /--ambiance-grade-bundled:([\s\S]*?);/.exec(block)?.[1]
  if (grade === undefined)
    throw new Error('the guinguette block declares no --ambiance-grade-bundled')
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
})()

const alphaAt = (y: number): number => {
  const { stops } = gradeStops
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (a === undefined || b === undefined) continue
    if (y <= b.at) return a.alpha + ((b.alpha - a.alpha) * (y - a.at)) / (b.at - a.at || 1)
  }
  return stops[stops.length - 1]?.alpha ?? 1
}

/** The graded ground's luminances in a band of the page, on a 390 × 844 phone. */
const groundLuminances = async (fromY: number, toY: number): Promise<number[]> => {
  const image = sharp(GROUND)
  const { width = 0, height = 0 } = await image.metadata()
  // `cover` on a portrait screen: the full height, the centre of the width.
  const visibleWidth = Math.round(height * (390 / 844))
  const left = Math.max(0, Math.round((width - visibleWidth) / 2))
  const { data, info } = await image
    .extract({ left, top: 0, width: Math.min(visibleWidth, width), height })
    .resize({ width: 195 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const out: number[] = []
  const [gr, gg, gb] = gradeStops.colour
  for (let row = Math.floor(fromY * info.height); row < Math.ceil(toY * info.height); row++) {
    const a = alphaAt(row / info.height)
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

describe('text over the Guinguette’s photographed ground', () => {
  // The top half of the phone, where the event's name, the intro and the signature sit on the
  // ground itself; below it the composer pane carries the text.
  const band = groundLuminances(0, 0.5)

  it.each([
    ['--text-primary', 4.5],
    ['--text-secondary', 4.5],
    ['--text-muted', 4.5],
  ] as const)(
    'keeps %s above %s:1 on the 99th percentile of the graded photograph',
    async (name, bar) => {
      const luminances = await band
      const p99 = luminances[Math.floor(luminances.length * 0.99)] ?? 1
      expect(ratio(luminanceOf(srgb(ink(name))), p99)).toBeGreaterThanOrEqual(bar)
    },
  )
})

/**
 * A host's own photograph (ADR 0010, decision 8) is nobody's measured photograph, so the claim
 * cannot be "the 99th percentile passes", it has to hold for **any** photograph. It does, and
 * for the strongest possible reason: the venue grade is the bundled one plus one more coat of
 * the same brown, and under that the inks pass over a ground that is **pure white**, the
 * brightest thing a photograph can be. A photograph that is not white is only darker.
 */
describe('text over a host’s own photograph of their venue', () => {
  const venueRule = (() => {
    const found =
      /\[data-event-ambiance='guinguette'\]\[data-venue-ground\]\s*\{([\s\S]*?)\n\}/.exec(TOKENS)
    if (found?.[1] === undefined) throw new Error('tokens.css declares no venue-photo rule')
    return found[1]
  })()

  const scrimAlpha = (() => {
    const scrim = /--ambiance-scrim:\s*oklch\(([^)]*)\/\s*([\d.]+)\)/.exec(venueRule)
    if (scrim?.[2] === undefined) throw new Error('the venue rule declares no --ambiance-scrim')
    return Number(scrim[2])
  })()

  it('layers one more coat over the bundled grade and never replaces it', () => {
    // Layered, not substituted: the venue grade can only be darker than the bundled one.
    expect(venueRule).toMatch(/--ambiance-grade:\s*linear-gradient\(var\(--ambiance-scrim\)/)
    expect(venueRule).toMatch(/var\(--ambiance-grade-bundled\)\s*;/)
    expect(scrimAlpha).toBeGreaterThan(0)
  })

  it.each([
    ['--text-primary', 4.5],
    ['--text-secondary', 4.5],
    ['--text-muted', 4.5],
  ] as const)('keeps %s above %s:1 even over a pure white photograph', (name, bar) => {
    const [gr, gg, gb] = gradeStops.colour
    let worst = Number.POSITIVE_INFINITY
    // Every row of the top half of the page, where the text sits on the ground itself.
    for (let step = 0; step <= 50; step++) {
      const bundled = alphaAt(step / 100)
      // Two coats composited: the scrim over the photograph, then the bundled grade over that.
      const a = 1 - (1 - bundled) * (1 - scrimAlpha)
      const white = 1
      const graded: Srgb = [
        gr * a + white * (1 - a),
        gg * a + white * (1 - a),
        gb * a + white * (1 - a),
      ]
      worst = Math.min(worst, ratio(luminanceOf(srgb(ink(name))), luminanceOf(graded)))
    }
    expect(worst).toBeGreaterThanOrEqual(bar)
  })

  it('is needed: the bundled grade alone does not hold the muted ink over pure white', () => {
    // The mutation that proves the coat earns its place. Remove it and this is the failure.
    const [gr, gg, gb] = gradeStops.colour
    let worst = Number.POSITIVE_INFINITY
    for (let step = 0; step <= 50; step++) {
      const a = alphaAt(step / 100)
      const graded: Srgb = [gr * a + (1 - a), gg * a + (1 - a), gb * a + (1 - a)]
      worst = Math.min(worst, ratio(luminanceOf(srgb(ink('--text-muted'))), luminanceOf(graded)))
    }
    expect(worst).toBeLessThan(4.5)
  })
})
