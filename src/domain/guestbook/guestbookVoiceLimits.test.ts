import { describe, expect, it } from 'vitest'
import { MAX_ENTRIES_PER_EVENT, MAX_ENTRIES_PER_GUEST } from './guestbookLimits'
import {
  MAX_QUEUED_VOICES,
  MAX_QUEUED_VOICES_PER_EVENT,
  MAX_VOICE_PER_EVENT,
  VOICE_DECLARED_SLACK_MS,
  VOICE_FAILED_RETENTION_MS,
  VOICE_MIN_MS,
  admitsAnotherVoice,
  voiceDeclaredTooLong,
  voiceOutputCeilingBytes,
  voiceQueueFull,
  voiceRefusalFor,
  voiceRetryAfterSecondsFor,
} from './guestbookVoiceLimits'

const room = { heldByGuest: 0, openInEvent: 0, voicesInEvent: 0 }

describe('the ceilings on voice messages', () => {
  it('are the spec’s: 200 voices, a queue of 40 and 20, a floor of a second, a day for a failure', () => {
    expect(MAX_VOICE_PER_EVENT).toBe(200)
    expect(MAX_QUEUED_VOICES).toBe(40)
    expect(MAX_QUEUED_VOICES_PER_EVENT).toBe(20)
    expect(VOICE_MIN_MS).toBe(1_000)
    expect(VOICE_FAILED_RETENTION_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('voiceRefusalFor', () => {
  it('accepts the 200th voice of an event and refuses the 201st', () => {
    expect(voiceRefusalFor({ ...room, voicesInEvent: MAX_VOICE_PER_EVENT - 1 })).toBeNull()
    expect(voiceRefusalFor({ ...room, voicesInEvent: MAX_VOICE_PER_EVENT })).toBe('voiceFull')
  })

  it('keeps the text ceilings: the third message of a guest, texts and voices together', () => {
    expect(voiceRefusalFor({ ...room, heldByGuest: MAX_ENTRIES_PER_GUEST - 1 })).toBeNull()
    expect(voiceRefusalFor({ ...room, heldByGuest: MAX_ENTRIES_PER_GUEST })).toBe('guestLimit')
  })

  it('keeps the 500 open messages of an event, which voices are counted in', () => {
    expect(voiceRefusalFor({ ...room, openInEvent: MAX_ENTRIES_PER_EVENT })).toBe('eventFull')
  })

  it('says the whole book is full before it says the voices are', () => {
    const everythingFull = {
      heldByGuest: 0,
      openInEvent: MAX_ENTRIES_PER_EVENT,
      voicesInEvent: MAX_VOICE_PER_EVENT,
    }

    expect(voiceRefusalFor(everythingFull)).toBe('eventFull')
  })

  it('says the guest is at their limit before either event ceiling', () => {
    expect(
      voiceRefusalFor({
        heldByGuest: MAX_ENTRIES_PER_GUEST,
        openInEvent: MAX_ENTRIES_PER_EVENT,
        voicesInEvent: MAX_VOICE_PER_EVENT,
      }),
    ).toBe('guestLimit')
  })

  it('has no refusal for an empty book', () => {
    expect(voiceRefusalFor(room)).toBeNull()
  })
})

describe('the queue’s backpressure', () => {
  it('admits while the depth is strictly below the ceiling', () => {
    expect(admitsAnotherVoice(MAX_QUEUED_VOICES - 1, MAX_QUEUED_VOICES)).toBe(true)
    expect(admitsAnotherVoice(MAX_QUEUED_VOICES, MAX_QUEUED_VOICES)).toBe(false)
  })

  it('advises a wait of about a second a recording, never less than one and never a minute more', () => {
    expect(voiceRetryAfterSecondsFor(0)).toBe(1)
    expect(voiceRetryAfterSecondsFor(12)).toBe(12)
    expect(voiceRetryAfterSecondsFor(500)).toBe(60)
  })

  it('is a 429 that names the ceiling that refused, and never the quota’s 413', () => {
    const refusal = voiceQueueFull(20, MAX_QUEUED_VOICES_PER_EVENT)

    expect(refusal.code).toBe('voice.queueFull')
    expect(refusal.kind).toBe('rateLimited')
    expect(refusal.details).toEqual({ depth: 20, maxDepth: 20, retryAfterSeconds: 20 })
  })
})

describe('voiceDeclaredTooLong', () => {
  const cap = 60_000

  it('lets a file declare up to five seconds past the cap, the cap itself and anything shorter', () => {
    expect(voiceDeclaredTooLong(cap + VOICE_DECLARED_SLACK_MS, cap)).toBe(false)
    expect(voiceDeclaredTooLong(cap, cap)).toBe(false)
    expect(voiceDeclaredTooLong(1_000, cap)).toBe(false)
  })

  it('refuses a file declaring a single millisecond more than the cap plus the slack', () => {
    expect(voiceDeclaredTooLong(cap + VOICE_DECLARED_SLACK_MS + 1, cap)).toBe(true)
  })

  it('makes no claim of a file that declares no duration, which is the normal browser recording', () => {
    expect(voiceDeclaredTooLong(null, cap)).toBe(false)
  })

  it('is five seconds, the figure the spec says', () => {
    expect(VOICE_DECLARED_SLACK_MS).toBe(5_000)
  })
})

describe('voiceOutputCeilingBytes', () => {
  it('is one megabyte for every cap up to a minute and a half, where a message is a third of it', () => {
    expect(voiceOutputCeilingBytes(10_000)).toBe(1_000_000)
    expect(voiceOutputCeilingBytes(60_000)).toBe(1_000_000)
    expect(voiceOutputCeilingBytes(83_000)).toBe(1_000_000)
  })

  it('grows with a longer cap so the longest message the operator allows still fits its output', () => {
    // 180 seconds of 48 kbit/s is about 1.08 MB: a fixed megabyte would refuse every one of them.
    expect(voiceOutputCeilingBytes(180_000)).toBe(2_160_000)
    expect(voiceOutputCeilingBytes(180_000)).toBeGreaterThan(180 * 6_000)
  })
})
