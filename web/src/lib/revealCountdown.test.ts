import { describe, expect, it } from 'vitest'
import { countdownParts } from './revealCountdown'

const MINUTE = 60_000

describe('countdownParts', () => {
  it('says "soon" under a minute and a time from a minute on', () => {
    expect(countdownParts(59_999)).toBe('soon')
    expect(countdownParts(MINUTE)).toEqual({ hours: 0, minutes: 1 })
  })

  it('rounds a started minute up, so zero is never said with time left', () => {
    expect(countdownParts(MINUTE + 1)).toEqual({ hours: 0, minutes: 2 })
  })

  it('splits hours and minutes', () => {
    expect(countdownParts(130 * MINUTE)).toEqual({ hours: 2, minutes: 10 })
    expect(countdownParts(60 * MINUTE)).toEqual({ hours: 1, minutes: 0 })
  })
})
