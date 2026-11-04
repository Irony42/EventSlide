import { describe, expect, it } from 'vitest'
import { ClipTrim, MAX_TRIM_SOURCE_MS, TRIM_TOLERANCE_MS } from './clipTrim'

const MAX = 15_000

const code = (start: number, end: number, max = MAX): string | null => {
  const result = ClipTrim.create(start, end, max)
  return result.ok ? null : result.error.code
}

describe('ClipTrim.create', () => {
  it('accepts a range inside the cap and exposes its length', () => {
    const result = ClipTrim.create(12_000, 24_500, MAX)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.startMs).toBe(12_000)
    expect(result.value.endMs).toBe(24_500)
    expect(result.value.lengthMs).toBe(12_500)
  })

  it('accepts exactly the cap and exactly one second', () => {
    expect(code(0, 15_000)).toBeNull()
    expect(code(5_000, 6_000)).toBeNull()
  })

  it('refuses a range longer than the cap by one millisecond', () => {
    expect(code(0, 15_001)).toBe('clip.tooLong')
  })

  it('refuses a range shorter than one second', () => {
    expect(code(5_000, 5_999)).toBe('clip.tooShort')
  })

  it.each([
    ['a negative start', -1, 5_000],
    ['an end equal to the start', 5_000, 5_000],
    ['an end before the start', 6_000, 5_000],
    ['a fractional start', 0.5, 5_000],
    ['a fractional end', 0, 5_000.5],
    ['a start that is not a number', Number.NaN, 5_000],
    ['an end that is infinite', 0, Number.POSITIVE_INFINITY],
  ])('refuses %s as an invalid trim', (_name, start, end) => {
    expect(code(start, end)).toBe('clip.trimInvalid')
  })

  it('judges the length against the cap it is given, not a constant', () => {
    expect(code(0, 30_000, 30_000)).toBeNull()
    expect(code(0, 30_001, 30_000)).toBe('clip.tooLong')
  })
})

describe('ClipTrim.fitsWithin', () => {
  const trim = (end: number): ClipTrim => {
    const made = ClipTrim.create(end - 5_000, end, MAX)
    if (!made.ok) throw new Error('fixture')
    return made.value
  }

  it('accepts an end at the declared duration', () => {
    expect(trim(40_000).fitsWithin(40_000)).toBe(true)
  })

  it('allows the tolerance and not a millisecond more', () => {
    expect(trim(40_000 + TRIM_TOLERANCE_MS).fitsWithin(40_000)).toBe(true)
    expect(trim(40_000 + TRIM_TOLERANCE_MS + 1).fitsWithin(40_000)).toBe(false)
  })
})

describe('ClipTrim.equals', () => {
  it('compares both bounds', () => {
    const a = ClipTrim.create(1_000, 5_000, MAX)
    const b = ClipTrim.create(1_000, 5_000, MAX)
    const c = ClipTrim.create(1_000, 6_000, MAX)
    const d = ClipTrim.create(2_000, 5_000, MAX)
    if (!a.ok || !b.ok || !c.ok || !d.ok) throw new Error('fixture')
    expect(a.value.equals(b.value)).toBe(true)
    expect(a.value.equals(c.value)).toBe(false)
    expect(a.value.equals(d.value)).toBe(false)
  })
})

describe('MAX_TRIM_SOURCE_MS', () => {
  it('is thirty minutes', () => {
    expect(MAX_TRIM_SOURCE_MS).toBe(1_800_000)
  })
})
