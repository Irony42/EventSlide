import { describe, expect, it } from 'vitest'
import { Event } from '../events/event'
import { EventName } from '../events/eventName'
import { EventSettings } from '../events/eventSettings'
import { EVENT_STATUSES, type EventStatus } from '../events/eventStatus'
import { asEventId, asUserId } from '../shared/ids'
import { JoinCode } from '../shared/joinCode'
import { Slug } from '../shared/slug'
import { GuestInvite } from './guestInvite'
import { GuestInviteToken } from './guestInviteToken'
import { inviteStateOf, scheduleOf, servedInviteOf, type InviteState } from './inviteStateOf'

const NOW = new Date('2026-11-21T10:00:00Z')

const unwrap = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  if (!result.ok) throw new Error('unexpected')
  return result.value
}

const eventIn = (
  status: EventStatus,
  extra: { takenDownAt?: Date; clientSuspendedAt?: Date } = {},
): Event =>
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

const inviteWith = (options: { enabled: boolean; dated: boolean }): GuestInvite => {
  const token = unwrap(GuestInviteToken.fromBytes(new Uint8Array(16).fill(3)))
  let invite = GuestInvite.blank(asEventId('evt-1'), token, 'fr', NOW)
  if (options.dated) {
    invite = unwrap(
      invite.withContent({ startsAt: '2026-12-13T18:00:00Z', timeZone: 'Europe/Paris' }, NOW),
    )
  }
  return options.enabled ? GuestInvite.restore({ ...invite.toProps(), enabled: true }) : invite
}

const ON = inviteWith({ enabled: true, dated: true })

describe('inviteStateOf', () => {
  const byStatus: Record<EventStatus, InviteState> = {
    draft: 'upcoming',
    live: 'joinable',
    closed: 'over',
    archived: 'unavailable',
  }

  for (const status of EVENT_STATUSES) {
    it(`answers ${byStatus[status]} for an enabled, dated invitation on a ${status} event`, () => {
      expect(inviteStateOf(eventIn(status), ON)).toBe(byStatus[status])
    })
  }

  it('is unavailable whatever the event, while the invitation is switched off', () => {
    const off = inviteWith({ enabled: false, dated: true })
    for (const status of EVENT_STATUSES) {
      expect(inviteStateOf(eventIn(status), off), status).toBe('unavailable')
    }
  })

  it('is unavailable without a date, even switched on', () => {
    const undated = inviteWith({ enabled: true, dated: false })

    expect(inviteStateOf(eventIn('live'), undated)).toBe('unavailable')
  })

  it('is unavailable once the operator took the event down, in every status', () => {
    for (const status of EVENT_STATUSES) {
      const event = eventIn(status, { takenDownAt: NOW })
      expect(inviteStateOf(event, ON), status).toBe('unavailable')
    }
  })

  it('is unavailable while the client is suspended, in every status', () => {
    for (const status of EVENT_STATUSES) {
      const event = eventIn(status, { clientSuspendedAt: NOW })
      expect(inviteStateOf(event, ON), status).toBe('unavailable')
    }
  })

  it('does not look at the hour of the party: a draft whose date has passed is still upcoming', () => {
    const past = unwrap(ON.withContent({ startsAt: '2020-01-01T10:00:00Z', timeZone: 'UTC' }, NOW))

    expect(
      inviteStateOf(eventIn('draft'), GuestInvite.restore({ ...past.toProps(), enabled: true })),
    ).toBe('upcoming')
  })
})

describe('servedInviteOf', () => {
  it('carries the schedule with the state, from one decision', () => {
    const served = servedInviteOf(eventIn('live'), ON)

    expect(served?.state).toBe('joinable')
    expect(served?.schedule).toEqual({
      startsAt: new Date('2026-12-13T18:00:00Z'),
      endsAt: null,
      timeZone: 'Europe/Paris',
    })
  })

  it('is null for a page that does not exist', () => {
    expect(servedInviteOf(eventIn('archived'), ON)).toBeNull()
  })
})

describe('scheduleOf', () => {
  it('is absent without a start, and without the zone the start is read in', () => {
    expect(scheduleOf(inviteWith({ enabled: true, dated: false }))).toBeNull()
    const lostZone = GuestInvite.restore({
      ...ON.toProps(),
      content: { ...ON.content, timeZone: null },
    })
    expect(scheduleOf(lostZone)).toBeNull()
  })
})
