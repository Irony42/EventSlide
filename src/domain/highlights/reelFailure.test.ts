import { describe, expect, it } from 'vitest'
import {
  MAX_REEL_ATTEMPTS,
  classifyReelFailure,
  reelRetryDelayMs,
  shouldRetryReel,
} from './reelFailure'

describe('reel failures', () => {
  it.each([
    'reel.notEnoughPhotos',
    'reel.eventUnavailable',
    'reel.notAllowed',
    'event.notFound',
    'event.quotaExceeded',
    'client.storageFull',
  ])('%s is permanent', (code) => {
    expect(classifyReelFailure(code)).toBe('permanent')
  })

  it.each(['reel.transcoderUnavailable', 'reel.renderFailed', 'reel.timedOut', 'who.knows'])(
    '%s is transient, as is any code the table does not know',
    (code) => {
      expect(classifyReelFailure(code)).toBe('transient')
    },
  )

  it('retries a transient failure until the third attempt, and a permanent one never', () => {
    expect(shouldRetryReel('transient', MAX_REEL_ATTEMPTS - 1)).toBe(true)
    expect(shouldRetryReel('transient', MAX_REEL_ATTEMPTS)).toBe(false)
    expect(shouldRetryReel('permanent', 1)).toBe(false)
  })

  it('waits longer after the second failure than after the first', () => {
    expect(reelRetryDelayMs(2)).toBeGreaterThan(reelRetryDelayMs(1))
  })
})
