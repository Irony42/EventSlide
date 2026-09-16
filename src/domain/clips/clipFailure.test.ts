import { describe, expect, it } from 'vitest'
import { MAX_ATTEMPTS, classifyClipFailure, retryDelayMs, shouldRetry } from './clipFailure'

describe('classifyClipFailure', () => {
  it.each([
    'clip.unsupportedFormat',
    'clip.corrupt',
    'clip.noVideoStream',
    'clip.durationUnknown',
    'clip.tooShort',
    'clip.tooLong',
    'clip.pixelBudgetExceeded',
    'clip.sourceMissing',
    'event.quotaExceeded',
    'event.photoLimitReached',
  ])('treats %s as a property of the file, not of the machine', (code) => {
    expect(classifyClipFailure(code)).toBe('permanent')
  })

  it.each([
    'clip.transcoderUnavailable',
    'clip.transcodeFailed',
    'clip.storageFailed',
    'clip.transcodeTimedOut',
    'clip.transcodeCancelled',
    'clip.probeUnreadable',
  ])('treats %s as something a second attempt could answer differently', (code) => {
    expect(classifyClipFailure(code)).toBe('transient')
  })

  it('does not destroy a clip because the box was busy', () => {
    // A timeout was the one machine condition classified permanent, so a venue mini-PC
    // briefly under load deleted a guest's only copy of the first dance on attempt one.
    // The stall bound, not the wall clock, is what catches a genuinely wedged decoder.
    expect(classifyClipFailure('clip.transcodeTimedOut')).toBe('transient')
  })

  it('does not destroy a clip because shutdown interrupted it', () => {
    // `dispose()` kills every running encoder. Reported as a timeout, that was a
    // permanent failure on every deploy — and it did not bite only because
    // `process.exit` happened to win the race.
    expect(classifyClipFailure('clip.transcodeCancelled')).toBe('transient')
  })

  it('does not destroy a clip because we could not read ffprobe’s own answer', () => {
    // ffprobe exited zero; the file was fine. An ordinary four-stream iPhone clip's JSON
    // is 7.9 KB, and this used to be answered `clip.corrupt`, which is permanent.
    expect(classifyClipFailure('clip.probeUnreadable')).toBe('transient')
  })

  it('treats a code it has never been taught as transient', () => {
    // Bounded by MAX_ATTEMPTS either way, so the cost of guessing wrong here is two
    // wasted attempts; guessing the other way throws a guest's clip away outright.
    expect(classifyClipFailure('clip.somethingNew')).toBe('transient')
  })
})

describe('shouldRetry', () => {
  it('brings a transient failure back while attempts remain', () => {
    expect(shouldRetry('transient', 1)).toBe(true)
    expect(shouldRetry('transient', MAX_ATTEMPTS - 1)).toBe(true)
  })

  it('gives up on a transient failure once the attempts are spent', () => {
    expect(shouldRetry('transient', MAX_ATTEMPTS)).toBe(false)
  })

  it('never retries a permanent failure, however few attempts were made', () => {
    expect(shouldRetry('permanent', 1)).toBe(false)
  })
})

describe('retryDelayMs', () => {
  it('waits a couple of seconds after the first attempt', () => {
    expect(retryDelayMs(1)).toBe(2_000)
  })

  it('waits longer after the second', () => {
    expect(retryDelayMs(2)).toBe(10_000)
  })

  it('reuses the last rung rather than growing without bound', () => {
    // Unreachable while MAX_ATTEMPTS sits inside the ladder, and total anyway: a
    // function that answered `undefined` here would schedule a retry at the epoch.
    expect(retryDelayMs(9)).toBe(10_000)
  })

  it('never answers a negative delay for a nonsensical attempt count', () => {
    expect(retryDelayMs(0)).toBe(2_000)
    expect(retryDelayMs(-3)).toBe(2_000)
  })
})
