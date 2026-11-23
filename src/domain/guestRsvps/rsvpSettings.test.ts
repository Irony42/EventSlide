import { describe, expect, it } from 'vitest'
import type { InviteSchedule } from '../guestInvites/inviteStateOf'
import {
  applySettingsPatch,
  closeRsvps,
  DEFAULT_RSVP_SETTINGS,
  reopenRsvps,
  type RsvpSettingsPatch,
} from './rsvpSettings'

const PARTY: InviteSchedule = {
  startsAt: new Date('2026-12-13T18:00:00Z'),
  endsAt: null,
  timeZone: 'Europe/Paris',
}

const apply = (patch: RsvpSettingsPatch, schedule: InviteSchedule | null = PARTY) =>
  applySettingsPatch(DEFAULT_RSVP_SETTINGS, patch, schedule, () => 'aaaaaaaa')

describe('applySettingsPatch', () => {
  it('starts switched off, with no deadline, not closed, and the default form', () => {
    expect(DEFAULT_RSVP_SETTINGS).toMatchObject({ enabled: false, deadline: null, closedAt: null })
  })

  it('leaves an absent field as it was', () => {
    const result = apply({})

    expect(result.ok && result.value).toEqual(DEFAULT_RSVP_SETTINGS)
  })

  it('switches replies on and applies a form patch', () => {
    const result = apply({ enabled: true, form: { maybe: false } })

    expect(result.ok && result.value).toMatchObject({ enabled: true, form: { maybe: false } })
  })

  it('refuses a switch that is not a boolean, and passes a form error through', () => {
    const notBoolean = apply({ enabled: 'on' })
    const badForm = apply({ form: { maybe: 'x' } })

    expect(!notBoolean.ok && notBoolean.error.code).toBe('rsvp.enabledInvalid')
    expect(!badForm.ok && badForm.error.code).toBe('rsvp.formInvalid')
  })

  it('takes a deadline up to the day the party starts, in the zone of the party', () => {
    expect(apply({ deadline: '2026-12-13' }).ok).toBe(true)
    expect(apply({ deadline: '2026-12-01' }).ok).toBe(true)
    const after = apply({ deadline: '2026-12-14' })
    expect(!after.ok && after.error.code).toBe('rsvp.deadlineAfterStart')
  })

  it('reads the start in the zone of the party: 00:30 in Paris is already the next day', () => {
    const lateParty: InviteSchedule = { ...PARTY, startsAt: new Date('2026-12-13T23:30:00Z') }

    expect(apply({ deadline: '2026-12-14' }, lateParty).ok).toBe(true)
    expect(apply({ deadline: '2026-12-14' }).ok).toBe(false)
  })

  it('clears a deadline with null, even with no date to compare to', () => {
    const set = apply({ deadline: '2026-12-01' })
    if (!set.ok) throw new Error('set')

    const cleared = applySettingsPatch(set.value, { deadline: null }, null, () => 'aaaaaaaa')

    expect(cleared.ok && cleared.value.deadline).toBeNull()
  })

  it('refuses a deadline that is not a real day, or that has no party date to be before', () => {
    for (const deadline of ['2026-02-31', '13/12/2026', 20261201, '']) {
      const result = apply({ deadline })
      expect(!result.ok && result.error.code).toBe('rsvp.deadlineInvalid')
    }
    const noDate = apply({ deadline: '2026-12-01' }, null)
    expect(!noDate.ok && noDate.error.code).toBe('rsvp.deadlineNeedsDate')
  })

  it('does not rewrite a stored deadline when something else is saved', () => {
    const set = apply({ deadline: '2026-12-13' })
    if (!set.ok) throw new Error('set')
    const movedEarlier: InviteSchedule = { ...PARTY, startsAt: new Date('2026-12-01T18:00:00Z') }

    const result = applySettingsPatch(set.value, { enabled: true }, movedEarlier, () => 'aaaaaaaa')

    expect(result.ok && result.value.deadline).toBe('2026-12-13')
  })
})

describe('closing and reopening by hand', () => {
  const at = new Date('2026-12-01T10:00:00Z')

  it('closes at the given instant, and keeps the first instant when closed twice', () => {
    const once = closeRsvps(DEFAULT_RSVP_SETTINGS, at)
    const twice = closeRsvps(once, new Date('2026-12-02T10:00:00Z'))

    expect(once.closedAt).toBe(at)
    expect(twice.closedAt).toBe(at)
  })

  it('reopens by clearing the instant, and changes nothing else', () => {
    const closed = closeRsvps(
      { ...DEFAULT_RSVP_SETTINGS, enabled: true, deadline: '2026-12-05' },
      at,
    )

    expect(reopenRsvps(closed)).toEqual({
      ...DEFAULT_RSVP_SETTINGS,
      enabled: true,
      deadline: '2026-12-05',
    })
  })
})
