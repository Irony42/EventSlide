import { describe, expect, it } from 'vitest'
import { asAnnouncementId, asEventId, asUserId } from '../shared/ids'
import { Announcement, type NewAnnouncement } from './announcement'

const NOW = new Date('2026-06-20T21:00:00.000Z')
const SECOND = 1000
const iso = (offsetSeconds: number): string => new Date(NOW.getTime() + offsetSeconds * SECOND).toISOString()

const input = (over: Partial<NewAnnouncement> = {}): NewAnnouncement => ({
  eventId: asEventId('wedding'),
  text: 'Gâteau',
  createdBy: asUserId('host'),
  ...over,
})

const create = (over: Partial<NewAnnouncement> = {}, now: Date = NOW): Announcement => {
  const result = Announcement.create(input(over), asAnnouncementId('a1'), now)
  if (!result.ok) throw new Error(`fixture refused: ${result.error.code}`)
  return result.value
}

const refusal = (over: Partial<NewAnnouncement>): string | null => {
  const result = Announcement.create(input(over), asAnnouncementId('a1'), NOW)
  return result.ok ? null : result.error.code
}

describe('Announcement.create', () => {
  it('schedules a fullscreen card with the defaults: 30 s on screen, a 5 minute countdown', () => {
    const announcement = create({ at: iso(3600) })

    expect(announcement.kind).toBe('fullscreen')
    expect(announcement.durationSeconds).toBe(30)
    expect(announcement.countdownSeconds).toBe(300)
    expect(announcement.at.toISOString()).toBe(iso(3600))
    expect(announcement.text.value).toBe('Gâteau')
    expect(announcement.toProps().createdAt).toEqual(NOW)
  })

  it('takes an absent kind as fullscreen', () => {
    expect(create({ at: iso(60) }).kind).toBe('fullscreen')
  })

  it('schedules a discreet announcement with 15 minutes and no countdown', () => {
    const announcement = create({ kind: 'discreet', at: iso(3600) })

    expect(announcement.durationSeconds).toBe(900)
    expect(announcement.countdownSeconds).toBe(0)
  })

  it('launches at the server clock without a countdown when no moment is given', () => {
    const launched = create({ countdownSeconds: 900 })

    expect(launched.at).toEqual(NOW)
    expect(launched.countdownSeconds).toBe(0)
    expect(launched.phaseAt(NOW).phase).toBe('showing')
  })

  it('still checks the countdown of a launch: a value outside the list is refused', () => {
    expect(refusal({ countdownSeconds: 61 })).toBe('announcement.countdownInvalid')
  })

  it('refuses a discreet announcement that carries a countdown', () => {
    expect(refusal({ kind: 'discreet', at: iso(3600), countdownSeconds: 60 })).toBe(
      'announcement.countdownInvalid',
    )
  })

  it('checks each field with its own code, text first', () => {
    expect(refusal({ text: '' })).toBe('announcement.textInvalid')
    expect(refusal({ kind: 'banner' })).toBe('announcement.kindInvalid')
    expect(refusal({ at: iso(-61) })).toBe('announcement.atInvalid')
    expect(refusal({ at: 'soon' })).toBe('announcement.atInvalid')
    expect(refusal({ at: iso(60), durationSeconds: 9 })).toBe('announcement.durationInvalid')
    expect(refusal({ kind: 'discreet', at: iso(60), durationSeconds: 30 })).toBe(
      'announcement.durationInvalid',
    )
    expect(refusal({ at: iso(60), countdownSeconds: 7 })).toBe('announcement.countdownInvalid')
    expect(refusal({ text: '', kind: 'banner' })).toBe('announcement.textInvalid')
  })

  it('accepts a moment 60 seconds ago, which is a minute typed late', () => {
    expect(create({ at: iso(-60) }).at.toISOString()).toBe(iso(-60))
  })
})

describe('Announcement.restore and accessors', () => {
  it('gives back what it was built with', () => {
    const announcement = create({ at: iso(600), durationSeconds: 60, countdownSeconds: 60 })
    const again = Announcement.restore(announcement.toProps())

    expect(again.id).toBe('a1')
    expect(again.eventId).toBe('wedding')
    expect(again.durationSeconds).toBe(60)
    expect(again.toProps()).toBe(announcement.toProps())
  })
})

describe('Announcement.edit', () => {
  const scheduled = (): Announcement => create({ at: iso(3600) })

  it('changes every field while upcoming, the kind included', () => {
    const result = scheduled().edit(
      { text: 'Discours', kind: 'discreet', at: iso(7200), durationSeconds: 600, countdownSeconds: 0 },
      NOW,
    )

    expect(result.ok && result.value.text.value).toBe('Discours')
    expect(result.ok && result.value.kind).toBe('discreet')
    expect(result.ok && result.value.at.toISOString()).toBe(iso(7200))
    expect(result.ok && result.value.durationSeconds).toBe(600)
  })

  it('leaves a field that is not named as it was', () => {
    const result = scheduled().edit({ text: 'Discours' }, NOW)

    expect(result.ok && result.value.durationSeconds).toBe(30)
    expect(result.ok && result.value.countdownSeconds).toBe(300)
    expect(result.ok && result.value.id).toBe('a1')
  })

  it('is allowed while counting', () => {
    const later = new Date(NOW.getTime() + 3600 * SECOND - 100 * SECOND)

    const result = scheduled().edit({ text: 'Discours' }, later)

    expect(result.ok).toBe(true)
  })

  it('is refused with locked while a fullscreen card is showing, its text included', () => {
    const showing = new Date(NOW.getTime() + 3600 * SECOND + 5 * SECOND)

    const result = scheduled().edit({ text: 'Discours' }, showing)

    expect(!result.ok && result.error.code).toBe('announcement.locked')
  })

  it('is refused with locked once over', () => {
    const over = new Date(NOW.getTime() + 3600 * SECOND + 30 * SECOND)

    expect(!scheduled().edit({ text: 'Discours' }, over).ok).toBe(true)
    const discreetOver = create({ kind: 'discreet', at: iso(0) }).edit(
      { text: 'Discours' },
      new Date(NOW.getTime() + 900 * SECOND),
    )
    expect(!discreetOver.ok && discreetOver.error.code).toBe('announcement.locked')
  })

  it('revalidates the duration for the new kind: 30 s is not a discreet length', () => {
    const result = scheduled().edit({ kind: 'discreet' }, NOW)

    expect(!result.ok && result.error.code).toBe('announcement.durationInvalid')
  })

  it('drops the countdown when the kind becomes discreet, and refuses a named one', () => {
    const dropped = scheduled().edit({ kind: 'discreet', durationSeconds: 900 }, NOW)
    const named = scheduled().edit(
      { kind: 'discreet', durationSeconds: 900, countdownSeconds: 300 },
      NOW,
    )

    expect(dropped.ok && dropped.value.countdownSeconds).toBe(0)
    expect(!named.ok && named.error.code).toBe('announcement.countdownInvalid')
  })

  it('revalidates every field it names', () => {
    const edit = (patch: Parameters<Announcement['edit']>[0]): string | null => {
      const result = scheduled().edit(patch, NOW)
      return result.ok ? null : result.error.code
    }

    expect(edit({ text: '' })).toBe('announcement.textInvalid')
    expect(edit({ kind: 'banner' })).toBe('announcement.kindInvalid')
    expect(edit({ at: iso(-61) })).toBe('announcement.atInvalid')
    expect(edit({ durationSeconds: 121 })).toBe('announcement.durationInvalid')
    expect(edit({ countdownSeconds: 61 })).toBe('announcement.countdownInvalid')
  })

  describe('a discreet announcement on screen', () => {
    const discreet = (): Announcement => create({ kind: 'discreet', at: iso(0) })
    const onScreen = new Date(NOW.getTime() + 120 * SECOND)

    it('lets its text change in place and nothing else', () => {
      const result = discreet().edit({ text: 'Le buffet est ouvert' }, onScreen)

      expect(result.ok && result.value.text.value).toBe('Le buffet est ouvert')
      expect(result.ok && result.value.at.toISOString()).toBe(iso(0))
      expect(result.ok && result.value.durationSeconds).toBe(900)
    })

    it('refuses a new text that is not valid', () => {
      const result = discreet().edit({ text: '' }, onScreen)

      expect(!result.ok && result.error.code).toBe('announcement.textInvalid')
    })

    it('refuses a changed moment, duration, countdown or kind', () => {
      for (const patch of [
        { at: iso(600) },
        { at: 'garbage' },
        { durationSeconds: 600 },
        { countdownSeconds: 60 },
        { kind: 'fullscreen' },
      ]) {
        const result = discreet().edit({ text: 'Autre', ...patch }, onScreen)
        expect(!result.ok && result.error.code).toBe('announcement.locked')
      }
    })

    it('takes the same values sent back unchanged, as a form that sends everything does', () => {
      const result = discreet().edit(
        {
          text: 'Le buffet est ouvert',
          kind: 'discreet',
          at: iso(0),
          durationSeconds: 900,
          countdownSeconds: 0,
        },
        onScreen,
      )

      expect(result.ok && result.value.text.value).toBe('Le buffet est ouvert')
    })
  })
})

describe('Announcement.launch', () => {
  it('sets the moment to now and drops the countdown, keeping the rest', () => {
    const scheduled = create({ at: iso(3600), durationSeconds: 60, text: 'Discours' })

    const result = scheduled.launch(NOW)

    expect(result.ok && result.value.at).toEqual(NOW)
    expect(result.ok && result.value.countdownSeconds).toBe(0)
    expect(result.ok && result.value.durationSeconds).toBe(60)
    expect(result.ok && result.value.text.value).toBe('Discours')
  })

  it('works from counting', () => {
    const later = new Date(NOW.getTime() + 3600 * SECOND - 10 * SECOND)

    expect(create({ at: iso(3600) }).launch(later).ok).toBe(true)
  })

  it('replays one that is over ("Relancer")', () => {
    const over = new Date(NOW.getTime() + 600 * SECOND)

    const result = create({ at: iso(0) }).launch(over)

    expect(result.ok && result.value.at).toEqual(over)
  })

  it('is refused with showing while it is on screen', () => {
    const result = create({ at: iso(0) }).launch(new Date(NOW.getTime() + 5 * SECOND))

    expect(!result.ok && result.error.code).toBe('announcement.showing')
  })
})
