import { describe, expect, it } from 'vitest'
import {
  MAX_VOICE_ATTEMPTS,
  VOICE_FAILURES,
  classifyVoiceFailure,
  isVoiceFailure,
  shouldRetryVoice,
  voiceFailureOf,
  voiceRetryDelayMs,
} from './voiceFailure'

describe('the closed list of voice failures', () => {
  it('is the nine of migration 032', () => {
    expect([...VOICE_FAILURES]).toEqual([
      'unsupportedFormat',
      'corrupt',
      'notAudio',
      'noAudioStream',
      'tooLong',
      'tooShort',
      'transcodeFailed',
      'timedOut',
      'storageFailed',
    ])
  })

  it('recognises its own words and nothing else', () => {
    expect(VOICE_FAILURES.every(isVoiceFailure)).toBe(true)
    expect(isVoiceFailure('voice.corrupt')).toBe(false)
    expect(isVoiceFailure(null)).toBe(false)
  })
})

describe('voiceFailureOf', () => {
  it.each([
    ['voice.unsupportedFormat', 'unsupportedFormat'],
    ['voice.corrupt', 'corrupt'],
    ['voice.notAudio', 'notAudio'],
    ['voice.noAudioStream', 'noAudioStream'],
    ['voice.tooLong', 'tooLong'],
    ['voice.tooShort', 'tooShort'],
    ['voice.transcodeFailed', 'transcodeFailed'],
    ['voice.transcodeTimedOut', 'timedOut'],
    ['voice.storageFailed', 'storageFailed'],
    ['voice.transcoderUnavailable', 'transcodeFailed'],
    ['event.quotaExceeded', 'storageFailed'],
    ['client.storageFull', 'storageFailed'],
  ] as const)('reads %s as %s', (code, failure) => {
    expect(voiceFailureOf(code)).toBe(failure)
  })

  it('reads a code it was never taught as a transcode failure, never as a permanent one', () => {
    expect(voiceFailureOf('something.new')).toBe('transcodeFailed')
    // A bare lookup on an object would resolve inherited members: this table answers about the
    // codes it holds or not at all.
    expect(voiceFailureOf('constructor')).toBe('transcodeFailed')
    expect(voiceFailureOf('toString')).toBe('transcodeFailed')
  })

  it('never answers outside the closed list', () => {
    for (const code of ['voice.corrupt', 'x', '', 'voice.transcoderUnavailable']) {
      expect(isVoiceFailure(voiceFailureOf(code))).toBe(true)
    }
  })
})

describe('classifying a failure', () => {
  it('calls the file the problem when the same bytes would answer the same way', () => {
    for (const failure of [
      'unsupportedFormat',
      'corrupt',
      'notAudio',
      'noAudioStream',
      'tooLong',
      'tooShort',
    ] as const) {
      expect(classifyVoiceFailure(failure)).toBe('permanent')
    }
  })

  it('calls the machine the problem when a second attempt could answer differently', () => {
    for (const failure of ['transcodeFailed', 'timedOut', 'storageFailed'] as const) {
      expect(classifyVoiceFailure(failure)).toBe('transient')
    }
  })
})

describe('the retry ladder, which is the clip’s', () => {
  it('allows three attempts', () => {
    expect(MAX_VOICE_ATTEMPTS).toBe(3)
  })

  it('retries a transient failure while attempts are left, and never a permanent one', () => {
    expect(shouldRetryVoice('transcodeFailed', 1)).toBe(true)
    expect(shouldRetryVoice('transcodeFailed', 2)).toBe(true)
    expect(shouldRetryVoice('transcodeFailed', 3)).toBe(false)
    expect(shouldRetryVoice('corrupt', 1)).toBe(false)
  })

  it('waits briefly, because the guest is looking at "En traitement"', () => {
    expect(voiceRetryDelayMs(1)).toBe(2_000)
    expect(voiceRetryDelayMs(2)).toBe(10_000)
  })
})
