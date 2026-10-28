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
 * the product's own bars against a percentile of the result that depends on the **polarity**:
 * light inks on a dark grade are held against the 99th percentile, the brightest ground a line of
 * text can realistically land on, ignoring the few pixels at the core of a bulb; dark inks on a
 * light grade (the Noces) are held against the 1st, the darkest, ignoring the few pixels of a
 * shadow. The worst case is the end of the photograph that is nearest the ink, and which end
 * that is follows from whether the ink is lighter or darker than the grade's own colour.
 */

const ROOT = process.cwd()
const TOKENS = readFileSync(join(ROOT, 'web/src/design-system/tokens.css'), 'utf8')

const AMBIANCES = ['guinguette', 'riviera', 'champs', 'bivouac', 'cabaret', 'noces'] as const

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

const inksOf = (name: string): ((token: string) => Oklch) => inksFrom(blockOf(name), name)

const inksFrom = (block: string, name: string): ((token: string) => Oklch) => {
  const inks = parseOklchTokens(block.replace(/^:root \{/, ':root {\n'))
  return (token) => {
    const value = inks.get(token)
    if (value === undefined) throw new Error(`the ${name} block does not restate ${token}`)
    return value
  }
}

/** The grade's stops, `oklch(… / alpha) position%`, in order down the page. */
const gradeOf = (name: string) => gradeFrom(blockOf(name), name)

const gradeFrom = (block: string, name: string) => {
  const grade = /--ambiance-grade:([\s\S]*?);/.exec(block)?.[1]
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

/**
 * Which end of the photograph is the worst case for an ink: the ink's luminance against the
 * grade colour's decides. A light ink on a dark grade fears the brightest pixels, a dark ink on a
 * light grade the darkest.
 */
const polarityOf = (inkColour: Oklch, grade: Grade): 'light-ink' | 'dark-ink' =>
  luminanceOf(srgb(inkColour)) > luminanceOf(grade.colour) ? 'light-ink' : 'dark-ink'

/** The percentile of the sorted luminances that bounds the worst realistic ground for a polarity. */
const worstGround = (sorted: readonly number[], polarity: 'light-ink' | 'dark-ink'): number =>
  polarity === 'light-ink'
    ? (sorted[Math.floor(sorted.length * 0.99)] ?? 1)
    : (sorted[Math.floor(sorted.length * 0.01)] ?? 0)

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
    return INKS.every((token) => {
      const worst = worstGround(luminances, polarityOf(ink(token), grade))
      return ratio(luminanceOf(srgb(ink(token))), worst) >= 4.5
    })
  }

  it('ships a photograph and declares it', () => {
    expect(blockOf(name)).toContain(`ambiances/${name}-ground-1600.webp`)
  })

  it.each(INKS)(
    'keeps %s above 4.5:1 on the worst percentile of the graded photograph (99th for a light ink, 1st for a dark one)',
    async (token) => {
      const luminances = await groundLuminances(name, grade, ...BAND)
      const worst = worstGround(luminances, polarityOf(ink(token), grade))
      expect(ratio(luminanceOf(srgb(ink(token))), worst)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('keeps all three inks on one side of the grade, so one polarity is measured per ambiance', () => {
    const polarities = new Set(INKS.map((token) => polarityOf(ink(token), grade)))
    expect(polarities.size).toBe(1)
  })

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

/**
 * A host's own photograph of their venue (ADR 0010, decision 8a) is nobody's measured
 * photograph, so the claim cannot be "the worst percentile passes": it has to hold for **any**
 * photograph. It does, and for the simplest reason. The venue grade is the ambiance's own grade
 * plus one more coat of its own surface colour, and under that the inks pass over the extreme
 * photograph on the side the ink fears: **pure white** for a light ink on a dark grade (nothing
 * is brighter), **pure black** for a dark ink on a light grade (nothing is darker). Any other
 * photograph lies between the two and is kinder.
 */
describe.each(AMBIANCES)('text over a host’s own photograph, under the %s', (name) => {
  const ink = inksOf(name)
  const grade = gradeOf(name)

  const venueRule = (() => {
    const found = /\n\[data-venue-ground\]\s*\{([\s\S]*?)\n\}/.exec(TOKENS)
    if (found?.[1] === undefined) throw new Error('tokens.css declares no venue-photo rule')
    return found[1]
  })()
  const scrimAlpha = (() => {
    const share =
      /--ambiance-scrim:\s*color-mix\(in oklch,\s*var\(--surface-base\)\s*([\d.]+)%/.exec(
        blockOf(name),
      )
    if (share?.[1] === undefined) throw new Error(`the ${name} block declares no --ambiance-scrim`)
    return Number(share[1]) / 100
  })()

  it('layers one more coat of the ambiance’s surface colour over its grade and never replaces it', () => {
    expect(venueRule).toMatch(/--venue-scrim-layer:\s*linear-gradient\(var\(--ambiance-scrim\)/)
    expect(scrimAlpha).toBeGreaterThan(0)
    // The scrim sits on top of the grade, which sits on top of the photograph, on both surfaces.
    const layers =
      /var\(--venue-scrim-layer\),\s*var\(--ambiance-grade\),\s*var\(--ambiance-ground\)/
    expect(readFileSync(join(ROOT, 'web/src/design-system/base.css'), 'utf8')).toMatch(layers)
    expect(TOKENS).toMatch(
      /\[data-venue-ground='wall'\]\s*\{\s*--wall-ground:\s*var\(--venue-scrim-layer\),\s*var\(--ambiance-grade\)/,
    )
  })

  it.each(INKS)(
    'keeps %s above 4.5:1 even over the worst pure photograph (white, or black under a light grade)',
    (token) => {
      const [gr, gg, gb] = grade.colour
      const [sr, sg, sb] = srgb(ink('--surface-base'))
      let worst = Number.POSITIVE_INFINITY
      // The photograph the ink fears: white under a light ink, black under a dark one.
      const photo = polarityOf(ink(token), grade) === 'light-ink' ? 1 : 0
      // Every row of the top half of the page, where the text sits on the ground itself.
      for (let step = 0; step <= 50; step++) {
        const a = alphaAt(grade, step / 100)
        // The grade over the photograph, then the venue coat over that, in encoded sRGB like the browser.
        const g: Srgb = [
          gr * a + photo * (1 - a),
          gg * a + photo * (1 - a),
          gb * a + photo * (1 - a),
        ]
        const s = scrimAlpha
        const graded: Srgb = [
          sr * s + g[0] * (1 - s),
          sg * s + g[1] * (1 - s),
          sb * s + g[2] * (1 - s),
        ]
        worst = Math.min(worst, ratio(luminanceOf(srgb(ink(token))), luminanceOf(graded)))
      }
      expect(worst).toBeGreaterThanOrEqual(4.5)
    },
  )
})

/**
 * Sur mesure (ADR 0011, decision 4): no bundled photograph, so the only photograph that can sit
 * under it is a host's own, and the claim is the same bound as above, held **per polarity** and at
 * **every ground hue** on a 15 degree grid (0 to 345, and 359 to close the circle): the inks keep
 * 4.5:1 over pure white under the dark ground's grade and coat, and over pure black under the light
 * ground's. `--ground-hue` is substituted the way the browser does on the element that carries it.
 */
const GROUND_GRID: readonly number[] = [
  ...Array.from({ length: 24 }, (_unused, step) => step * 15),
  359,
]

describe.each(['dark', 'light'] as const)(
  'text over a host’s own photograph, under the custom %s ground, at every ground hue',
  (polarity) => {
    const raw = new RegExp(
      String.raw`\[data-event-ambiance='custom'\]\[data-ambiance-ground='${polarity}'\][^{]*\{([^}]*)\}`,
    ).exec(TOKENS)?.[1]
    if (raw === undefined) throw new Error(`tokens.css declares no custom ${polarity} block`)
    const at = (hue: number): string =>
      `:root {${raw.replaceAll('var(--ground-hue)', String(hue))}}`

    /** The coat's share of the ambiance's own surface colour, in per cent, as declared. */
    const coatShare = (block: string): number => {
      const share =
        /--ambiance-scrim:\s*color-mix\(in oklch,\s*var\(--surface-base\)\s*([\d.]+)%/.exec(block)
      if (share?.[1] === undefined) throw new Error('the block declares no --ambiance-scrim')
      return Number(share[1])
    }

    const worstAt = (hue: number, token: (typeof INKS)[number], top?: number): number => {
      const block = at(hue)
      const ink = inksFrom(block, `custom ${polarity}`)
      const declared = gradeFrom(block, `custom ${polarity}`)
      // The grade's other stops keep their offsets from the declared top, as in the suite above.
      const first = declared.stops[0]?.alpha ?? 0
      const grade: Grade =
        top === undefined
          ? declared
          : {
              colour: declared.colour,
              stops: declared.stops.map((stop, index) =>
                index === declared.stops.length - 1
                  ? stop
                  : { at: stop.at, alpha: Math.max(0, stop.alpha - first + top) },
              ),
            }
      const s = coatShare(block) / 100
      const [gr, gg, gb] = grade.colour
      const [sr, sg, sb] = srgb(ink('--surface-base'))
      // The photograph the polarity fears: white under light inks, black under dark ones.
      const photo = polarityOf(ink(token), grade) === 'light-ink' ? 1 : 0
      let worst = Number.POSITIVE_INFINITY
      for (let step = 0; step <= 50; step++) {
        const a = alphaAt(grade, step / 100)
        const g: Srgb = [
          gr * a + photo * (1 - a),
          gg * a + photo * (1 - a),
          gb * a + photo * (1 - a),
        ]
        const graded: Srgb = [
          sr * s + g[0] * (1 - s),
          sg * s + g[1] * (1 - s),
          sb * s + g[2] * (1 - s),
        ]
        worst = Math.min(worst, ratio(luminanceOf(srgb(ink(token))), luminanceOf(graded)))
      }
      return worst
    }

    const holdsAt = (top: number): boolean =>
      GROUND_GRID.every((hue) => INKS.every((token) => worstAt(hue, token, top) >= 4.5))

    it('declares the lowest top alpha that holds under its coat, at the ground hue and ink that need it most', () => {
      const declared = gradeFrom(at(0), `custom ${polarity}`).stops[0]?.alpha ?? 1
      expect(holdsAt(declared)).toBe(true)
      // The derivation of every grade above: one step thinner fails, so the number is not a round
      // figure that happens to hold.
      expect(holdsAt(Number((declared - 0.01).toFixed(2)))).toBe(false)
    })

    it('wears no photograph of its own and layers its coat the way every ambiance does', () => {
      expect(raw).toMatch(/--ambiance-ground:\s*none;/)
      expect(raw).toMatch(/--ambiance-scrim:\s*color-mix\(in oklch,\s*var\(--surface-base\)/)
    })

    it('puts every ink on the polarity’s side of the grade, at every hue', () => {
      for (const hue of GROUND_GRID) {
        const block = at(hue)
        const ink = inksFrom(block, `custom ${polarity}`)
        const grade = gradeFrom(block, `custom ${polarity}`)
        expect(new Set(INKS.map((token) => polarityOf(ink(token), grade))).size).toBe(1)
      }
    })

    it.each(INKS)(
      'keeps %s above 4.5:1 over the worst pure photograph, at every ground hue',
      (token) => {
        let low = { hue: -1, ratio: Number.POSITIVE_INFINITY }
        for (const hue of GROUND_GRID) {
          const measured = worstAt(hue, token)
          if (measured < low.ratio) low = { hue, ratio: measured }
        }
        expect(low.ratio, `worst at ground hue ${low.hue}`).toBeGreaterThanOrEqual(4.5)
      },
    )
  },
)
