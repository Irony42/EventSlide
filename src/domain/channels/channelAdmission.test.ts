import { describe, expect, it } from 'vitest'

import { admitByRate, admitMedia, queueHasRoom, type AdmissionLimits } from './channelAdmission'

const LIMITS: AdmissionLimits = {
  maxPhotoBytes: 10_000,
  maxVideoBytes: 20_000,
  maxClipMs: 15_000,
  clipsAccepted: true,
}

type Declared = Parameters<typeof admitMedia>[0]

const media = (patch: Partial<Declared> = {}): Declared => ({
  kind: 'photo',
  declaredBytes: 1_000,
  durationMs: null,
  declaredMimeType: null,
  ...patch,
})

const code = (result: ReturnType<typeof admitMedia>): string | null =>
  result.ok ? null : result.error.code

describe('admitMedia', () => {
  it('takes a photograph within the size ceiling, also when its size is not declared', () => {
    expect(admitMedia(media(), LIMITS)).toEqual({ ok: true, value: { kind: 'photo' } })
    expect(admitMedia(media({ declaredBytes: null }), LIMITS).ok).toBe(true)
    expect(admitMedia(media({ declaredBytes: 10_000 }), LIMITS).ok).toBe(true)
  })

  it('refuses a photograph heavier than the ceiling', () => {
    expect(code(admitMedia(media({ declaredBytes: 10_001 }), LIMITS))).toBe('channel.mediaTooLarge')
  })

  it('takes a short video as it is', () => {
    const result = admitMedia(media({ kind: 'video', durationMs: 15_000 }), LIMITS)
    expect(result).toEqual({ ok: true, value: { kind: 'video', trim: null } })
  })

  it('keeps the first seconds of a video longer than a clip', () => {
    const result = admitMedia(media({ kind: 'video', durationMs: 15_001 }), LIMITS)
    expect(result).toEqual({
      ok: true,
      value: { kind: 'video', trim: { startMs: 0, endMs: 15_000 } },
    })
  })

  it('sends a video of unknown length as it is and lets the clip pipeline decide', () => {
    const result = admitMedia(media({ kind: 'video', durationMs: null }), LIMITS)
    expect(result).toEqual({ ok: true, value: { kind: 'video', trim: null } })
  })

  it('refuses a video heavier than the channel allows', () => {
    const result = admitMedia(media({ kind: 'video', declaredBytes: 20_001 }), LIMITS)
    expect(code(result)).toBe('channel.mediaTooLarge')
    expect(admitMedia(media({ kind: 'video', declaredBytes: 20_000 }), LIMITS).ok).toBe(true)
  })

  it('refuses a video when the event or the plan does not take clips', () => {
    const result = admitMedia(media({ kind: 'video' }), { ...LIMITS, clipsAccepted: false })
    expect(code(result)).toBe('channel.videoNotAccepted')
  })

  it('does not let clips being off refuse a photograph', () => {
    expect(admitMedia(media(), { ...LIMITS, clipsAccepted: false }).ok).toBe(true)
  })

  it.each([
    ['image/jpeg', 'photo'],
    ['IMAGE/HEIC', 'photo'],
    ['video/mp4', 'video'],
  ])('takes a document declared %s as a %s', (mime, kind) => {
    const result = admitMedia(media({ kind: 'document', declaredMimeType: mime }), LIMITS)
    expect(result.ok && result.value.kind).toBe(kind)
  })

  it.each(['application/pdf', 'text/plain', '', null])(
    'refuses a document declared %j: not a photograph or a film',
    (mime) => {
      const result = admitMedia(media({ kind: 'document', declaredMimeType: mime }), LIMITS)
      expect(code(result)).toBe('channel.unsupportedFormat')
    },
  )
})

describe('admitByRate', () => {
  const now = new Date('2026-11-19T20:00:30Z')
  const at = (secondsAgo: number): Date => new Date(now.getTime() - secondsAgo * 1000)

  it('lets media through below the rate and records them', () => {
    const verdict = admitByRate([at(10)], now, 2)
    expect(verdict.allowed).toBe(true)
    expect(verdict.window).toEqual([at(10), now])
  })

  it('refuses the media past the rate and does not count it', () => {
    const verdict = admitByRate([at(10), at(5)], now, 2)
    expect(verdict.allowed).toBe(false)
    expect(verdict.window).toEqual([at(10), at(5)])
  })

  it('forgets what is older than a minute', () => {
    const verdict = admitByRate([at(61), at(60), at(59)], now, 2)
    expect(verdict.allowed).toBe(true)
    expect(verdict.window).toEqual([at(59), now])
  })
})

describe('queueHasRoom', () => {
  it('stops at the ceiling', () => {
    expect(queueHasRoom(199, 200)).toBe(true)
    expect(queueHasRoom(200, 200)).toBe(false)
  })
})
