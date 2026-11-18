import { describe, expect, it } from 'vitest'
import {
  VOICE_FORMATS,
  baseMimeType,
  canRecordVoice,
  formatClock,
  isInAppBrowser,
  microphoneForbiddenByPage,
  pickVoiceFormat,
  voiceFileName,
  type VoiceEnvironment,
} from './voiceRecording'

/** What the phone knows about recording, as pure functions (spec 25). */

const supports =
  (...types: string[]) =>
  (type: string) =>
    types.includes(type)

describe('the format ladder', () => {
  it('prefers AAC in MP4, which is what Safari records', () => {
    expect(pickVoiceFormat(supports('audio/mp4', 'audio/webm;codecs=opus'))).toBe('audio/mp4')
    expect(pickVoiceFormat(supports('audio/mp4;codecs=mp4a.40.2', 'audio/mp4'))).toBe(
      'audio/mp4;codecs=mp4a.40.2',
    )
  })

  it('takes Opus in WebM for Chrome, then Opus in Ogg for Firefox on a desktop', () => {
    expect(pickVoiceFormat(supports('audio/webm;codecs=opus', 'audio/webm'))).toBe(
      'audio/webm;codecs=opus',
    )
    expect(pickVoiceFormat(supports('audio/ogg;codecs=opus'))).toBe('audio/ogg;codecs=opus')
  })

  it('finds no format, and so offers no button, when the browser knows none of them', () => {
    expect(pickVoiceFormat(supports())).toBeNull()
  })

  it('is the order the spec gives', () => {
    expect(VOICE_FORMATS).toEqual([
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ])
  })
})

describe('the file a recording becomes', () => {
  it.each([
    ['audio/mp4;codecs=mp4a.40.2', 'message-vocal.m4a'],
    ['audio/webm;codecs=opus', 'message-vocal.webm'],
    ['audio/ogg;codecs=opus', 'message-vocal.ogg'],
    ['', 'message-vocal.webm'],
  ])('is named from the type %s', (type, name) => {
    expect(voiceFileName(type)).toBe(name)
  })

  it('has a type without its codecs', () => {
    expect(baseMimeType('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(baseMimeType('audio/mp4')).toBe('audio/mp4')
  })
})

describe('the clock', () => {
  it.each([
    [0, '0:00'],
    [7_400, '0:07'],
    [59_999, '0:59'],
    [60_000, '1:00'],
    [-5, '0:00'],
  ])('writes %d ms as %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text)
  })
})

describe('whether this browser can record', () => {
  const environment = (overrides: Partial<VoiceEnvironment> = {}): VoiceEnvironment => ({
    isSecureContext: true,
    hasGetUserMedia: true,
    mediaRecorder: { isTypeSupported: supports('audio/webm') },
    ...overrides,
  })

  it('can, with a secure context, a microphone, a recorder and a format', () => {
    expect(canRecordVoice(environment())).toBe(true)
  })

  it.each([
    ['no secure context (a box served over http on a local network)', { isSecureContext: false }],
    ['no getUserMedia', { hasGetUserMedia: false }],
    ['no MediaRecorder', { mediaRecorder: null }],
    ['no format of the ladder', { mediaRecorder: { isTypeSupported: supports() } }],
  ] as const)('cannot with %s', (_name, overrides) => {
    expect(canRecordVoice(environment(overrides))).toBe(false)
  })
})

describe('whether the page forbids the microphone', () => {
  const documentWith = (policy: unknown): Document =>
    ({ permissionsPolicy: policy }) as unknown as Document

  it('says yes only when the browser says the feature is not allowed', () => {
    expect(microphoneForbiddenByPage(documentWith({ allowsFeature: () => false }))).toBe(true)
    expect(microphoneForbiddenByPage(documentWith({ allowsFeature: () => true }))).toBe(false)
  })

  it('says no when the browser does not expose the question', () => {
    // Safari and Firefox do not: the refusal is then read as the guest's.
    expect(microphoneForbiddenByPage(documentWith(undefined))).toBe(false)
  })

  it('asks about the microphone and nothing else', () => {
    const asked: string[] = []
    microphoneForbiddenByPage(
      documentWith({
        allowsFeature: (feature: string) => {
          asked.push(feature)
          return true
        },
      }),
    )
    expect(asked).toEqual(['microphone'])
  })
})

describe('the browsers that open a link inside an app', () => {
  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/430.0]',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Instagram 300.0',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 WhatsApp/2.23',
    'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/110 Mobile Safari/537.36 Line/13.0',
  ])('knows %s', (userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(true)
  })

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  ])('does not take %s for one', (userAgent) => {
    expect(isInAppBrowser(userAgent)).toBe(false)
  })
})
