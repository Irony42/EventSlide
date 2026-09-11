import { describe, expect, it } from 'vitest'
import { Dimensions } from './dimensions'

const dimensions = (width: number, height: number): Dimensions => {
  const result = Dimensions.create(width, height)
  if (!result.ok) throw new Error(`invalid fixture: ${result.error.code}`)
  return result.value
}

/**
 * Every rule is checked on both edges, and on the `field` the error carries: the
 * upload screen tells the guest which side of their photo is the problem, so an error
 * that blames the wrong edge is a wrong answer and not a cosmetic slip.
 */
const FRACTIONAL: readonly [string, number, number][] = [
  ['width', 1920.5, 1080],
  ['height', 1920, 1080.5],
]

const BELOW_MINIMUM: readonly [string, number, number][] = [
  ['width', 0, 1080],
  ['height', 1920, 0],
  ['width', -1, 1080],
  ['height', 1920, -1],
]

const ABOVE_MAXIMUM: readonly [string, number, number][] = [
  ['width', Dimensions.maxEdge + 1, 1080],
  ['height', 1920, Dimensions.maxEdge + 1],
]

describe('Dimensions.create', () => {
  it('accepts the size of an ordinary phone photo', () => {
    const result = Dimensions.create(4032, 3024)

    expect(result.ok && [result.value.width, result.value.height]).toEqual([4032, 3024])
  })

  it('accepts a single-pixel image, the smallest thing a decoder can report', () => {
    const result = Dimensions.create(Dimensions.minEdge, Dimensions.minEdge)

    expect(result.ok && [result.value.width, result.value.height]).toEqual([1, 1])
  })

  it('accepts both edges at exactly the maximum', () => {
    const result = Dimensions.create(Dimensions.maxEdge, Dimensions.maxEdge)

    expect(result.ok && [result.value.width, result.value.height]).toEqual([
      Dimensions.maxEdge,
      Dimensions.maxEdge,
    ])
  })

  it.each(FRACTIONAL)('refuses a fractional %s edge (%s x %s)', (field, width, height) => {
    const result = Dimensions.create(width, height)

    expect(!result.ok && [result.error.code, result.error.details['field']]).toEqual([
      'dimensions.notInteger',
      field,
    ])
  })

  it.each(BELOW_MINIMUM)('refuses a %s edge below one (%s x %s)', (field, width, height) => {
    const result = Dimensions.create(width, height)

    expect(!result.ok && [result.error.code, result.error.details['field']]).toEqual([
      'dimensions.tooSmall',
      field,
    ])
  })

  it.each(ABOVE_MAXIMUM)(
    'refuses a %s edge one pixel over the maximum (%s x %s)',
    (field, width, height) => {
      const result = Dimensions.create(width, height)

      expect(!result.ok && [result.error.code, result.error.details['field']]).toEqual([
        'dimensions.tooLarge',
        field,
      ])
    },
  )
})

describe('Dimensions arithmetic', () => {
  it('counts the pixels a decoder would have to allocate', () => {
    expect(dimensions(4000, 3000).pixels).toBe(12_000_000)
  })

  it('reports the aspect ratio the wall letterboxes against', () => {
    expect(dimensions(1920, 1080).aspectRatio).toBeCloseTo(16 / 9)
  })

  it('calls a wider-than-tall photo landscape', () => {
    expect(dimensions(4000, 3000).orientation).toBe('landscape')
  })

  it('calls a taller-than-wide photo portrait', () => {
    expect(dimensions(3000, 4000).orientation).toBe('portrait')
  })

  it('calls an equal-sided photo square', () => {
    expect(dimensions(1000, 1000).orientation).toBe('square')
  })
})

describe('Dimensions.exceedsPixelBudget', () => {
  it('allows an image sitting exactly on the budget', () => {
    expect(dimensions(1000, 1000).exceedsPixelBudget(1_000_000)).toBe(false)
  })

  it('refuses an image one pixel over the budget, which is the decompression bomb control', () => {
    expect(dimensions(1000, 1000).exceedsPixelBudget(999_999)).toBe(true)
  })
})

describe('Dimensions.scaleToFit', () => {
  const wall = dimensions(1920, 1080)

  it('shrinks a large landscape photo until its tall edge fits the wall', () => {
    const fitted = dimensions(4000, 3000).scaleToFit(wall)

    expect([fitted.width, fitted.height]).toEqual([1440, 1080])
  })

  it('shrinks a portrait photo on its height, leaving the wall letterboxed', () => {
    const fitted = dimensions(3000, 4000).scaleToFit(wall)

    expect([fitted.width, fitted.height]).toEqual([810, 1080])
  })

  it('leaves a small photo alone rather than upscaling it into a blur', () => {
    const fitted = dimensions(400, 300).scaleToFit(wall)

    expect([fitted.width, fitted.height]).toEqual([400, 300])
  })

  it('never rounds an extreme aspect ratio down to a zero edge', () => {
    const fitted = dimensions(10_000, 1).scaleToFit(dimensions(100, 100))

    expect([fitted.width, fitted.height]).toEqual([100, Dimensions.minEdge])
  })
})

describe('Dimensions identity', () => {
  it('considers two identical sizes equal', () => {
    expect(dimensions(1920, 1080).equals(dimensions(1920, 1080))).toBe(true)
  })

  it('considers a transposed size different, because orientation matters on the wall', () => {
    expect(dimensions(1920, 1080).equals(dimensions(1080, 1920))).toBe(false)
  })

  it('stringifies to the form used in logs and thumbnail names', () => {
    expect(`${dimensions(1920, 1080)}`).toBe('1920x1080')
  })
})
