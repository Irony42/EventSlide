import { describe, expect, it } from 'vitest'
import {
  MIN_TRIM_MS,
  defaultTrim,
  moveEnd,
  moveStart,
  needsTrim,
  secondsOf,
  type TrimRange,
} from './clipTrim'

const MAX = 15_000
const DURATION = 40_000

describe('defaultTrim', () => {
  it('opens on the first seconds the cap allows, which is already a valid choice', () => {
    expect(defaultTrim(DURATION, MAX)).toEqual({ startMs: 0, endMs: 15_000 })
  })

  it('never reaches past the end of a recording only just over the cap', () => {
    expect(defaultTrim(15_400, MAX)).toEqual({ startMs: 0, endMs: 15_000 })
    expect(defaultTrim(12_000, MAX)).toEqual({ startMs: 0, endMs: 12_000 })
  })
})

describe('moveStart', () => {
  const range: TrimRange = { startMs: 10_000, endMs: 20_000 }

  it('moves the start and leaves the end alone while the range stays valid', () => {
    expect(moveStart(range, 12_000, DURATION, MAX)).toEqual({ startMs: 12_000, endMs: 20_000 })
  })

  it('pushes the end along rather than letting the range pass the cap', () => {
    // 10 s -> 2 s would make 18 s: the end follows to keep exactly the cap.
    expect(moveStart(range, 2_000, DURATION, MAX)).toEqual({ startMs: 2_000, endMs: 17_000 })
  })

  it('keeps a second at least, pushing the end ahead of the start', () => {
    expect(moveStart(range, 19_800, DURATION, MAX)).toEqual({
      startMs: 19_800,
      endMs: 19_800 + MIN_TRIM_MS,
    })
  })

  it('stops at a second before the end of the recording, and at zero', () => {
    expect(moveStart(range, 99_000, DURATION, MAX)).toEqual({ startMs: 39_000, endMs: 40_000 })
    expect(moveStart(range, -500, DURATION, MAX)).toEqual({ startMs: 0, endMs: 15_000 })
  })

  it('gives whole milliseconds', () => {
    expect(moveStart(range, 12_000.6, DURATION, MAX).startMs).toBe(12_001)
  })
})

describe('moveEnd', () => {
  const range: TrimRange = { startMs: 10_000, endMs: 20_000 }

  it('moves the end and leaves the start alone while the range stays valid', () => {
    expect(moveEnd(range, 18_000, DURATION, MAX)).toEqual({ startMs: 10_000, endMs: 18_000 })
  })

  it('pushes the start along rather than letting the range pass the cap', () => {
    expect(moveEnd(range, 30_000, DURATION, MAX)).toEqual({ startMs: 15_000, endMs: 30_000 })
  })

  it('keeps a second at least, pulling the start back from the end', () => {
    expect(moveEnd(range, 10_200, DURATION, MAX)).toEqual({
      startMs: 10_200 - MIN_TRIM_MS,
      endMs: 10_200,
    })
  })

  it('stops at the end of the recording, and a second from zero', () => {
    expect(moveEnd(range, 99_000, DURATION, MAX)).toEqual({ startMs: 25_000, endMs: 40_000 })
    expect(moveEnd(range, 0, DURATION, MAX)).toEqual({ startMs: 0, endMs: 1_000 })
  })
})

describe('needsTrim', () => {
  it('is true only for a duration over the cap, in milliseconds', () => {
    expect(needsTrim(15_001, 15)).toBe(true)
    expect(needsTrim(15_000, 15)).toBe(false)
  })

  it('is false when the browser could not tell, which is not a refusal', () => {
    expect(needsTrim(null, 15)).toBe(false)
  })
})

describe('secondsOf', () => {
  it('rounds to a tenth', () => {
    expect(secondsOf(12_449)).toBe(12.4)
    expect(secondsOf(12_450)).toBe(12.5)
  })
})
