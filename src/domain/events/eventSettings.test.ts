import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import type { Result } from '../shared/result'
import { EventSettings, isModerationMode } from './eventSettings'

const unwrap = (result: Result<EventSettings, DomainError>): EventSettings => {
  if (!result.ok) throw new Error(`unexpected domain error: ${result.error.code}`)
  return result.value
}

describe('EventSettings defaults', () => {
  it('holds every photo for a decision, so nothing reaches the wall unmoderated', () => {
    expect(EventSettings.default().moderation).toBe('manual')
  })

  it('lets a guest caption, react and take back their own photo', () => {
    const settings = EventSettings.default()

    expect(settings.allowCaptions).toBe(true)
    expect(settings.allowReactions).toBe(true)
    expect(settings.allowGuestSelfDelete).toBe(true)
  })

  it('never deletes anything on its own and puts no cap on a guest', () => {
    const settings = EventSettings.default()

    expect(settings.retentionDays).toBeNull()
    expect(settings.maxPhotosPerGuest).toBeNull()
  })

  it('hands each caller its own props, so nothing can edit the defaults themselves', () => {
    const one = EventSettings.default()
    const other = EventSettings.default()

    expect(one.toProps()).not.toBe(other.toProps())
  })

  it('gives a guest fifteen minutes to take a photo back', () => {
    expect(EventSettings.default().guestSelfDeleteGraceSeconds).toBe(900)
  })

  it('exposes the grace window in milliseconds, the unit the Photo predicates use', () => {
    expect(EventSettings.default().guestSelfDeleteGraceMs).toBe(900_000)
  })
})

describe('EventSettings.create', () => {
  it('keeps the defaults for every field the host did not set', () => {
    const settings = unwrap(EventSettings.create({ moderation: 'auto' }))

    expect(settings.moderation).toBe('auto')
    expect(settings.guestSelfDeleteGraceSeconds).toBe(900)
  })

  it('takes every value the host did set', () => {
    const settings = unwrap(
      EventSettings.create({
        moderation: 'auto',
        allowCaptions: false,
        allowReactions: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 30,
        maxPhotosPerGuest: 20,
      }),
    )

    expect(settings.toProps()).toEqual({
      moderation: 'auto',
      allowCaptions: false,
      allowReactions: false,
      allowGuestSelfDelete: false,
      guestSelfDeleteGraceSeconds: 60,
      retentionDays: 30,
      maxPhotosPerGuest: 20,
    })
  })

  it('accepts a zero grace window, which turns the window off without the feature', () => {
    const settings = unwrap(
      EventSettings.create({ guestSelfDeleteGraceSeconds: EventSettings.graceSecondsRange.min }),
    )

    expect(settings.guestSelfDeleteGraceSeconds).toBe(0)
  })

  it('accepts a grace window of a whole day', () => {
    const settings = unwrap(
      EventSettings.create({ guestSelfDeleteGraceSeconds: EventSettings.graceSecondsRange.max }),
    )

    expect(settings.guestSelfDeleteGraceSeconds).toBe(86_400)
  })

  it.each([[-1], [86_401], [900.5]])(
    'refuses a grace window of %p seconds',
    (guestSelfDeleteGraceSeconds: number) => {
      const result = EventSettings.create({ guestSelfDeleteGraceSeconds })

      expect(!result.ok && result.error.code).toBe('eventSettings.graceSecondsInvalid')
    },
  )

  it('reports the range it enforced, so the form can phrase it in French', () => {
    const result = EventSettings.create({ guestSelfDeleteGraceSeconds: -1 })

    expect(!result.ok && result.error.details).toEqual({ min: 0, max: 86_400 })
  })

  it.each([[EventSettings.retentionDaysRange.min], [EventSettings.retentionDaysRange.max]])(
    'accepts a retention policy of %p days',
    (retentionDays: number) => {
      const settings = unwrap(EventSettings.create({ retentionDays }))

      expect(settings.retentionDays).toBe(retentionDays)
    },
  )

  it.each([[0], [3_651], [30.5]])(
    'refuses a retention policy of %p days',
    (retentionDays: number) => {
      const result = EventSettings.create({ retentionDays })

      expect(!result.ok && result.error.code).toBe('eventSettings.retentionDaysInvalid')
    },
  )

  it('reads an explicit null retention policy as keep the album forever', () => {
    const settings = unwrap(EventSettings.create({ retentionDays: null }))

    expect(settings.retentionDays).toBeNull()
  })

  it.each([[EventSettings.maxPhotosPerGuestRange.min], [EventSettings.maxPhotosPerGuestRange.max]])(
    'accepts a cap of %p photos per guest',
    (maxPhotosPerGuest: number) => {
      const settings = unwrap(EventSettings.create({ maxPhotosPerGuest }))

      expect(settings.maxPhotosPerGuest).toBe(maxPhotosPerGuest)
    },
  )

  it.each([[0], [10_001], [12.5]])(
    'refuses a cap of %p photos per guest',
    (maxPhotosPerGuest: number) => {
      const result = EventSettings.create({ maxPhotosPerGuest })

      expect(!result.ok && result.error.code).toBe('eventSettings.maxPhotosPerGuestInvalid')
    },
  )

  it('reads an explicit null cap as unlimited', () => {
    const settings = unwrap(EventSettings.create({ maxPhotosPerGuest: null }))

    expect(settings.maxPhotosPerGuest).toBeNull()
  })

  it('reports a bad setting as a parse failure, not a conflict', () => {
    const result = EventSettings.create({ retentionDays: 0 })

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('EventSettings.with', () => {
  it('changes the field the host edited', () => {
    const settings = unwrap(EventSettings.default().with({ moderation: 'auto' }))

    expect(settings.moderation).toBe('auto')
  })

  it('leaves every other field as it was', () => {
    const before = unwrap(EventSettings.create({ retentionDays: 30, allowReactions: false }))

    const after = unwrap(before.with({ moderation: 'auto' }))

    expect(after.retentionDays).toBe(30)
    expect(after.allowReactions).toBe(false)
  })

  it('leaves the original settings untouched', () => {
    const before = EventSettings.default()

    unwrap(before.with({ moderation: 'auto' }))

    expect(before.moderation).toBe('manual')
  })

  it('clears a retention policy when the host explicitly asks for no expiry', () => {
    const before = unwrap(EventSettings.create({ retentionDays: 30 }))

    const after = unwrap(before.with({ retentionDays: null }))

    expect(after.retentionDays).toBeNull()
  })

  it('keeps the current retention policy when the patch does not mention it', () => {
    const before = unwrap(EventSettings.create({ retentionDays: 30 }))

    const after = unwrap(before.with({ allowCaptions: false }))

    expect(after.retentionDays).toBe(30)
  })

  it('refuses a patch that would put a field out of range', () => {
    const before = EventSettings.default()

    const result = before.with({ maxPhotosPerGuest: 0 })

    expect(!result.ok && result.error.code).toBe('eventSettings.maxPhotosPerGuestInvalid')
  })
})

describe('isModerationMode', () => {
  it.each([['manual'], ['auto']])('recognises %s', (value: string) => {
    expect(isModerationMode(value)).toBe(true)
  })

  it.each([['automatic'], ['MANUAL'], [''], [42], [null], [undefined], [{ mode: 'auto' }]])(
    'refuses %p, which a stored settings blob could still contain',
    (value: unknown) => {
      expect(isModerationMode(value)).toBe(false)
    },
  )
})
