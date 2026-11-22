import { describe, expect, it } from 'vitest'
import { Event } from '../events/event'
import { EventName } from '../events/eventName'
import { EventSettings } from '../events/eventSettings'
import type { EventStatus } from '../events/eventStatus'
import { GuestInvite } from '../guestInvites/guestInvite'
import { GuestInviteToken } from '../guestInvites/guestInviteToken'
import { asEventId, asUserId } from '../shared/ids'
import { JoinCode } from '../shared/joinCode'
import { Slug } from '../shared/slug'
import { DEFAULT_RSVP_FORM } from './rsvpForm'
import { DEFAULT_RSVP_SETTINGS, type RsvpSettings } from './rsvpSettings'
import { guestMayReachOwn, guestMayWrite, rsvpClosesAt, rsvpStateOf } from './rsvpWindow'

const unwrap = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) throw new Error('unexpected')
  return result.value
}

const NOW = new Date('2026-12-01T10:00:00Z')

const eventIn = (status: EventStatus, extra: { clientSuspendedAt?: Date } = {}): Event =>
  Event.restore({
    id: asEventId('evt-1'),
    ownerId: asUserId('usr-1'),
    name: unwrap(EventName.create('Léa')),
    slug: unwrap(Slug.create('lea')),
    joinCode: unwrap(JoinCode.create('H7K2QM')),
    status,
    settings: EventSettings.default(),
    quotaBytes: 1_000,
    createdAt: NOW,
    startsAt: null,
    clientId: null,
    closedAt: null,
    openedAt: null,
    scheduledOpenAt: null,
    scheduledCloseAt: null,
    scheduleDiscardedAt: null,
    ...extra,
  })

const inviteWith = (options: { enabled?: boolean; startsAt?: string | null } = {}): GuestInvite => {
  const token = unwrap(GuestInviteToken.fromBytes(new Uint8Array(16).fill(3)))
  let invite = GuestInvite.blank(asEventId('evt-1'), token, 'fr', NOW)
  const startsAt = options.startsAt === undefined ? '2026-12-13T18:00:00Z' : options.startsAt
  if (startsAt !== null) {
    invite = unwrap(invite.withContent({ startsAt, timeZone: 'Europe/Paris' }, NOW))
  }
  return GuestInvite.restore({ ...invite.toProps(), enabled: options.enabled ?? true })
}

const on = (extra: Partial<RsvpSettings> = {}): RsvpSettings => ({
  ...DEFAULT_RSVP_SETTINGS,
  enabled: true,
  ...extra,
})

const stateOf = (
  settings: RsvpSettings,
  now: Date,
  options: { status?: EventStatus; invite?: GuestInvite; yesPeople?: number } = {},
) =>
  rsvpStateOf(settings, options.invite ?? inviteWith(), eventIn(options.status ?? 'draft'), now, {
    yesPeople: options.yesPeople ?? 0,
  })

describe('rsvpStateOf', () => {
  it('is off when replies are not asked', () => {
    expect(stateOf(DEFAULT_RSVP_SETTINGS, NOW)).toBe('off')
  })

  it('is open before the party, with no deadline', () => {
    expect(stateOf(on(), NOW)).toBe('open')
  })

  it('is off when the invitation page is not served: switched off, no date, archived, suspended', () => {
    expect(stateOf(on(), NOW, { invite: inviteWith({ enabled: false }) })).toBe('off')
    expect(stateOf(on(), NOW, { invite: inviteWith({ startsAt: null }) })).toBe('off')
    expect(stateOf(on(), NOW, { status: 'archived' })).toBe('off')
    const suspended = rsvpStateOf(
      on(),
      inviteWith(),
      eventIn('live', { clientSuspendedAt: NOW }),
      NOW,
      {
        yesPeople: 0,
      },
    )
    expect(suspended).toBe('off')
  })

  it('is off once the event is closed, even for a manual closing', () => {
    expect(stateOf(on(), NOW, { status: 'closed' })).toBe('off')
    expect(stateOf(on({ closedAt: NOW }), NOW, { status: 'closed' })).toBe('off')
  })

  it('follows the calendar of the party, not the wall: a wall opened early does not close it', () => {
    expect(stateOf(on(), NOW, { status: 'live' })).toBe('open')
  })

  it('a draft never opened does not keep replies open forever: the start closes them', () => {
    const atStart = new Date('2026-12-13T18:00:00Z')

    expect(stateOf(on(), new Date(atStart.getTime() - 1))).toBe('open')
    expect(stateOf(on(), atStart)).toBe('closed')
    expect(stateOf(on(), new Date('2026-12-20T00:00:00Z'))).toBe('closed')
  })

  it('is closed by hand', () => {
    expect(stateOf(on({ closedAt: NOW }), NOW)).toBe('closed')
  })

  it('stays open the whole deadline day where the party is, and closes when the next day begins', () => {
    const settings = on({ deadline: '2026-12-05' })

    // 5 December 23:59 in Paris is still the deadline day; midnight ends it.
    expect(stateOf(settings, new Date('2026-12-05T22:59:59Z'))).toBe('open')
    expect(stateOf(settings, new Date('2026-12-05T23:00:00Z'))).toBe('closed')
  })

  it('counts the deadline day in the zone of the party across the change of clocks', () => {
    const march = inviteWith({ startsAt: '2027-04-10T18:00:00Z' })
    const settings = on({ deadline: '2027-03-28' })

    // Clocks go forward on 28 March 2027 at 02:00: the deadline day ends at 22:00 UTC.
    expect(stateOf(settings, new Date('2027-03-28T21:59:59Z'), { invite: march })).toBe('open')
    expect(stateOf(settings, new Date('2027-03-28T22:00:00Z'), { invite: march })).toBe('closed')
  })

  it('stops at the start of the party when the deadline is later or unset', () => {
    const settings = on({ deadline: '2026-12-13' })

    expect(stateOf(settings, new Date('2026-12-13T17:59:00Z'))).toBe('open')
    expect(stateOf(settings, new Date('2026-12-13T18:00:00Z'))).toBe('closed')
  })

  it('is full when the places are taken, and open below', () => {
    const limited = on({ form: { ...DEFAULT_RSVP_FORM, capacity: 10 } })

    expect(stateOf(limited, NOW, { yesPeople: 9 })).toBe('open')
    expect(stateOf(limited, NOW, { yesPeople: 10 })).toBe('full')
    expect(stateOf(on(), NOW, { yesPeople: 5000 })).toBe('open')
  })

  it('is closed rather than full once the window has ended', () => {
    const limited = on({ closedAt: NOW, form: { ...DEFAULT_RSVP_FORM, capacity: 1 } })

    expect(stateOf(limited, NOW, { yesPeople: 5 })).toBe('closed')
  })
})

describe('rsvpClosesAt', () => {
  const schedule = {
    startsAt: new Date('2026-12-13T18:00:00Z'),
    endsAt: null,
    timeZone: 'Europe/Paris',
  }

  it('is the earlier of the end of the deadline day and the start', () => {
    expect(rsvpClosesAt(on({ deadline: '2026-12-05' }), schedule).toISOString()).toBe(
      '2026-12-05T23:00:00.000Z',
    )
    expect(rsvpClosesAt(on({ deadline: '2026-12-13' }), schedule)).toBe(schedule.startsAt)
    expect(rsvpClosesAt(on(), schedule)).toBe(schedule.startsAt)
  })
})

describe('what a guest may do', () => {
  it('writes only while open or full', () => {
    expect(guestMayWrite('open')).toBe(true)
    expect(guestMayWrite('full')).toBe(true)
    expect(guestMayWrite('closed')).toBe(false)
    expect(guestMayWrite('off')).toBe(false)
  })

  it('reaches their own reply for as long as the invitation is readable, after the party too', () => {
    expect(guestMayReachOwn('upcoming')).toBe(true)
    expect(guestMayReachOwn('joinable')).toBe(true)
    expect(guestMayReachOwn('over')).toBe(true)
    expect(guestMayReachOwn('unavailable')).toBe(false)
  })
})
