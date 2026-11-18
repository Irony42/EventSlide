import { describe, expect, it } from 'vitest'
import { isTerminal, TERMINAL_CODES } from './outboxPolicy'
import {
  VOICE_BLOCKED_CODES,
  VOICE_POLICY,
  VOICE_TERMINAL_CODES,
  voiceOutcomeForFailure,
} from './voicePolicy'

/**
 * Three states, not two (spec 25, section 5): a recording is never destroyed on a doubt, and never
 * retried for twelve hours on a refusal that will not pass.
 */

describe('what the voice queue does with an answer', () => {
  it.each(['guestbook.voiceDisabled', 'guestbook.disabled', 'event.notAcceptingUploads'])(
    'keeps the recording, stopped, when the event says %s',
    (code) => {
      // The host unticked a box by mistake, or the guest reopens the page after the window: the
      // recording is theirs to save or delete, not ours to destroy.
      expect(voiceOutcomeForFailure(409, code)).toEqual({ kind: 'blocked', code })
    },
  )

  it.each(['guestbook.limitReached', 'guestbook.eventFull', 'guestbook.voiceEventFull'])(
    'keeps the recording, stopped, on the ceiling %s',
    (code) => {
      expect(voiceOutcomeForFailure(409, code)).toEqual({ kind: 'blocked', code })
    },
  )

  it.each([
    'voice.unsupportedFormat',
    'voice.notAudio',
    'voice.corrupt',
    'voice.tooLong',
    'voice.tooShort',
  ])('drops the recording only for a refusal of its content, %s', (code) => {
    expect(voiceOutcomeForFailure(400, code)).toEqual({ kind: 'rejected', code })
  })

  it.each([
    [0, 'unknown'],
    [429, 'rate.limited'],
    [429, 'voice.queueFull'],
    [500, 'voice.transcoderUnavailable'],
    [502, 'unknown'],
    [413, 'event.quotaExceeded'],
    [403, 'guest.revoked'],
    [404, 'event.notFound'],
  ])('retries on %s %s: an unknown refusal is never a reason to destroy', (status, code) => {
    expect(voiceOutcomeForFailure(status, code)).toEqual({ kind: 'deferred' })
  })

  it('retries when nothing reached the server, even with a code that would block', () => {
    expect(voiceOutcomeForFailure(0, 'guestbook.voiceDisabled')).toEqual({ kind: 'deferred' })
  })

  it('has no code that both blocks and drops', () => {
    for (const code of VOICE_BLOCKED_CODES) expect(VOICE_TERMINAL_CODES.has(code)).toBe(false)
  })
})

describe('the voice queue’s own rules', () => {
  it('holds three recordings to an event, the server’s ceiling per guest', () => {
    expect(VOICE_POLICY.maxEntriesPerEvent).toBe(3)
  })

  it('keeps a recording twelve hours', () => {
    expect(VOICE_POLICY.maxAgeMs).toBe(12 * 60 * 60 * 1000)
  })

  it('discards by its own list and not the photo queue’s', () => {
    expect(isTerminal('voice.corrupt', VOICE_POLICY)).toBe(true)
    expect(isTerminal('image.corrupt', VOICE_POLICY)).toBe(false)
    expect(TERMINAL_CODES.has('voice.corrupt')).toBe(false)
  })
})
