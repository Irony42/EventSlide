import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import type { Result } from '../shared/result'
import { EventSettings, isModerationMode } from './eventSettings'
import { DEFAULT_EVENT_THEME } from './eventTheme'

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

  it('looks exactly as the product did before theming existed', () => {
    // The whole point of the default theme: an event nobody themed must render byte for
    // byte what it rendered yesterday, or every committed wall baseline is wrong.
    //
    // The literal, not `DEFAULT_EVENT_THEME` — `DEFAULTS.theme` *is* that constant, so
    // comparing the two would pass whatever either of them became. 305 is the hue
    // `tokens.css` declares, `sans` the stack it already resolves to, `soft` the radius
    // the wall already draws.
    expect(EventSettings.default().theme).toEqual({
      accentHue: 305,
      fonts: 'sans',
      frame: 'soft',
      material: 'glass',
    })
  })

  it('hands out a default theme nothing can edit under another event', () => {
    // `{ ...DEFAULTS }` is a shallow copy, so every unthemed event shares one theme
    // object. Frozen, that sharing is free; unfrozen it is a mutation away from
    // recolouring every event on the box at once.
    expect(Object.isFrozen(EventSettings.default().theme)).toBe(true)
    expect(EventSettings.default().theme).toBe(DEFAULT_EVENT_THEME)
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
        allowClips: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 30,
        maxPhotosPerGuest: 20,
        theme: { accentHue: 345, fonts: 'serif', frame: 'round', material: 'glass' },
      }),
    )

    expect(settings.toProps()).toEqual({
      moderation: 'auto',
      allowCaptions: false,
      allowReactions: false,
      allowClips: false,
      allowGuestSelfDelete: false,
      guestSelfDeleteGraceSeconds: 60,
      retentionDays: 30,
      maxPhotosPerGuest: 20,
      theme: { accentHue: 345, fonts: 'serif', frame: 'round', material: 'glass' },
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

  it('takes a theme as one decision, never half of one', () => {
    // Replaced whole rather than merged: the legibility rule judges the three choices
    // together, so a patch carrying only a hue must not leave a font behind from before.
    const before = unwrap(
      EventSettings.create({
        theme: { accentHue: 250, fonts: 'serif', frame: 'round', material: 'glass' },
      }),
    )

    const after = unwrap(
      before.with({ theme: { accentHue: 345, fonts: 'sans', frame: 'soft', material: 'glass' } }),
    )

    expect(after.theme).toEqual({ accentHue: 345, fonts: 'sans', frame: 'soft', material: 'glass' })
  })

  it('keeps the theme when the patch does not mention it', () => {
    const before = unwrap(
      EventSettings.create({
        theme: { accentHue: 250, fonts: 'serif', frame: 'round', material: 'glass' },
      }),
    )

    const after = unwrap(before.with({ allowCaptions: false }))

    expect(after.theme.accentHue).toBe(250)
  })

  it('refuses a theme the legibility rule rejects, and says which rule', () => {
    const result = EventSettings.default().with({
      theme: { accentHue: 160, fonts: 'sans', frame: 'soft', material: 'glass' },
    })

    expect(!result.ok && result.error.code).toBe('eventTheme.accentTooCloseToStatus')
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

describe('a theme the current rule would refuse, on an event that already has one', () => {
  /**
   * The asymmetry between `createEventTheme` and `restoreEventTheme` exists so that a
   * legibility rule tightened on Tuesday does not take somebody's Saturday wedding off
   * the screen. It was defeated on the one path a host uses every day: `with` judged the
   * *stored* theme as a fresh choice on every save, so an unrelated patch answered
   * `eventTheme.accentTooCloseToStatus` and made every setting on the page unsavable
   * until the host also changed a colour they never chose.
   *
   * Hue 30 stands in for "legal when it was chosen, refused by today's rule" — it is
   * eight degrees from `--danger`, which `restore` accepts on shape and `create`
   * refuses on legibility.
   */
  const stored = { accentHue: 30, fonts: 'sans', frame: 'soft', material: 'glass' } as const

  it('is read back without being re-judged', () => {
    const restored = EventSettings.restore({
      ...EventSettings.default().toProps(),
      theme: stored,
    })

    expect(restored.ok).toBe(true)
  })

  it('does not block a patch that changes something else entirely', () => {
    const settings = unwrap(
      EventSettings.restore({ ...EventSettings.default().toProps(), theme: stored }),
    )

    const saved = settings.with({ allowReactions: false })

    expect(saved.ok).toBe(true)
    expect(unwrap(saved).theme.accentHue).toBe(30)
  })

  it('still refuses the host who chooses that colour themselves', () => {
    const settings = unwrap(
      EventSettings.restore({ ...EventSettings.default().toProps(), theme: stored }),
    )

    const chosen = settings.with({
      theme: { accentHue: 30, fonts: 'serif', frame: 'soft', material: 'glass' },
    })

    expect(chosen.ok).toBe(false)
    expect(!chosen.ok && chosen.error.code).toBe('eventTheme.accentTooCloseToStatus')
  })
})
