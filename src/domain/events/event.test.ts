import { describe, expect, it } from 'vitest'
import type { DomainError } from '../shared/errors'
import { asEventId, asUserId } from '../shared/ids'
import { JoinCode } from '../shared/joinCode'
import type { Result } from '../shared/result'
import { Slug } from '../shared/slug'
import { Event, type EventProps, type NewEvent } from './event'
import { EventName } from './eventName'
import { EventSettings } from './eventSettings'
import type { EventStatus } from './eventStatus'

const unwrap = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`unexpected domain error: ${result.error.code}`)
  return result.value
}

const EVENT_ID = asEventId('evt-1')
const OTHER_EVENT_ID = asEventId('evt-2')
const OWNER_ID = asUserId('usr-1')
const NAME = unwrap(EventName.create('Camille & Sacha'))
const OTHER_NAME = unwrap(EventName.create('Anniversaire de Jean'))
const SLUG = unwrap(Slug.create('camille-et-sacha'))
const JOIN_CODE = unwrap(JoinCode.create('H7K2QM'))
const OTHER_JOIN_CODE = unwrap(JoinCode.create('Z3N9PT'))

const CREATED_AT = new Date('2026-06-20T09:00:00.000Z')
const STARTS_AT = new Date('2026-06-20T17:00:00.000Z')
const WENT_LIVE_AT = new Date('2026-06-20T18:00:00.000Z')
const ENDED_AT = new Date('2026-06-21T02:00:00.000Z')
/** The party restarted after the speeches and ended for good two hours later. */
const REALLY_ENDED_AT = new Date('2026-06-21T04:00:00.000Z')
const QUOTA_BYTES = 1_000

const RETAINED_30_DAYS = unwrap(EventSettings.create({ retentionDays: 30 }))
/** ENDED_AT plus the 30 days of {@link RETAINED_30_DAYS}. */
const PURGE_DUE_AT = new Date('2026-07-21T02:00:00.000Z')

const newEvent = (overrides: Partial<NewEvent> = {}): NewEvent => ({
  ownerId: OWNER_ID,
  name: NAME,
  slug: SLUG,
  joinCode: JOIN_CODE,
  settings: EventSettings.default(),
  quotaBytes: QUOTA_BYTES,
  startsAt: null,
  ...overrides,
})

const anEvent = (overrides: Partial<EventProps> = {}): Event =>
  Event.restore({
    id: EVENT_ID,
    ownerId: OWNER_ID,
    name: NAME,
    slug: SLUG,
    joinCode: JOIN_CODE,
    status: 'draft',
    settings: EventSettings.default(),
    quotaBytes: QUOTA_BYTES,
    createdAt: CREATED_AT,
    startsAt: null,
    closedAt: null,
    scheduledOpenAt: null,
    scheduledCloseAt: null,
    scheduleDiscardedAt: null,
    ...overrides,
  })

describe('Event.create', () => {
  it('starts in draft, so a printed join card resolves to nothing until the host opens', () => {
    const event = unwrap(Event.create(newEvent(), EVENT_ID, CREATED_AT))

    expect(event.status).toBe('draft')
  })

  it('stamps the creation time from the injected clock and nothing else', () => {
    const event = unwrap(Event.create(newEvent(), EVENT_ID, CREATED_AT))

    expect(event.createdAt).toBe(CREATED_AT)
    expect(event.closedAt).toBeNull()
  })

  it('carries the identity the host chose', () => {
    const event = unwrap(Event.create(newEvent(), EVENT_ID, CREATED_AT))

    expect(event.id).toBe(EVENT_ID)
    expect(event.ownerId).toBe(OWNER_ID)
    expect(event.name).toBe(NAME)
    expect(event.slug).toBe(SLUG)
    expect(event.joinCode).toBe(JOIN_CODE)
  })

  it('carries the quota and the settings it was given', () => {
    const event = unwrap(
      Event.create(newEvent({ settings: RETAINED_30_DAYS }), EVENT_ID, CREATED_AT),
    )

    expect(event.quotaBytes).toBe(QUOTA_BYTES)
    expect(event.settings).toBe(RETAINED_30_DAYS)
  })

  it('keeps a start date the host scheduled ahead of the party', () => {
    const event = unwrap(Event.create(newEvent({ startsAt: STARTS_AT }), EVENT_ID, CREATED_AT))

    expect(event.startsAt).toBe(STARTS_AT)
  })

  it.each([[0], [-1], [1.5]])('refuses a quota of %p bytes', (quotaBytes: number) => {
    const result = Event.create(newEvent({ quotaBytes }), EVENT_ID, CREATED_AT)

    expect(!result.ok && result.error.code).toBe('event.quotaBytesInvalid')
  })

  it('reports a bad quota as a parse failure, not a conflict', () => {
    const result = Event.create(newEvent({ quotaBytes: 0 }), EVENT_ID, CREATED_AT)

    expect(!result.ok && result.error.kind).toBe('invalid')
  })
})

describe('Event lifecycle', () => {
  it.each<[EventStatus, EventStatus]>([
    ['draft', 'live'],
    ['draft', 'archived'],
    ['live', 'closed'],
    ['live', 'archived'],
    ['closed', 'live'],
    ['closed', 'archived'],
  ])('moves a %s event to %s', (from, to) => {
    const moved = unwrap(anEvent({ status: from }).transitionTo(to, WENT_LIVE_AT))

    expect(moved.status).toBe(to)
  })

  it.each<[EventStatus, EventStatus]>([
    ['draft', 'closed'],
    ['live', 'draft'],
    ['closed', 'draft'],
    ['archived', 'draft'],
    ['archived', 'live'],
    ['archived', 'closed'],
  ])('refuses to move a %s event to %s', (from, to) => {
    const result = anEvent({ status: from }).transitionTo(to, WENT_LIVE_AT)

    expect(!result.ok && result.error.code).toBe('event.illegalTransition')
  })

  it('reports an illegal transition as a conflict, so the API answers 409', () => {
    const result = anEvent({ status: 'archived' }).goLive(WENT_LIVE_AT)

    expect(!result.ok && result.error.kind).toBe('conflict')
  })

  it('names the transition it refused', () => {
    const result = anEvent({ status: 'archived' }).goLive(WENT_LIVE_AT)

    expect(!result.ok && result.error.details).toEqual({ from: 'archived', to: 'live' })
  })

  it('opens the doors with goLive', () => {
    const event = unwrap(anEvent().goLive(WENT_LIVE_AT))

    expect(event.status).toBe('live')
  })

  it('stamps the closing time, which is what starts the retention clock', () => {
    const event = unwrap(anEvent({ status: 'live' }).close(ENDED_AT))

    expect(event.closedAt).toBe(ENDED_AT)
  })

  it('starts the retention clock even when an event is archived straight from live', () => {
    const event = unwrap(anEvent({ status: 'live' }).archive(ENDED_AT))

    expect(event.closedAt).toBe(ENDED_AT)
  })

  it('keeps the original closing time when a closed event is archived later', () => {
    const closed = anEvent({ status: 'closed', closedAt: ENDED_AT })

    const archived = unwrap(closed.archive(new Date('2026-06-30T12:00:00.000Z')))

    expect(archived.closedAt).toBe(ENDED_AT)
  })

  it('clears the closing time when the party restarts after the speeches', () => {
    const closed = anEvent({ status: 'closed', closedAt: ENDED_AT })

    const reopened = unwrap(closed.goLive(new Date('2026-06-21T02:30:00.000Z')))

    expect(reopened.closedAt).toBeNull()
  })

  it('restarts the retention clock at the second ending when a party reopens', () => {
    const closed = anEvent({ status: 'closed', closedAt: ENDED_AT })
    const reopened = unwrap(closed.goLive(new Date('2026-06-21T02:30:00.000Z')))

    const closedAgain = unwrap(reopened.close(REALLY_ENDED_AT))

    expect(closedAgain.closedAt).toBe(REALLY_ENDED_AT)
  })

  it('does not move the purge date when a host closes an event twice', () => {
    const closed = anEvent({ status: 'closed', closedAt: ENDED_AT })

    const again = unwrap(closed.close(new Date('2026-06-21T03:00:00.000Z')))

    expect(again.closedAt).toBe(ENDED_AT)
  })

  it('leaves a draft event without a closing time when the transition is a no-op', () => {
    const again = unwrap(anEvent().transitionTo('draft', WENT_LIVE_AT))

    expect(again.closedAt).toBeNull()
  })

  it('returns a new instance and leaves the original untouched', () => {
    const draft = anEvent()

    const live = unwrap(draft.goLive(WENT_LIVE_AT))

    expect(draft.status).toBe('draft')
    expect(live.status).toBe('live')
  })
})

describe('Event editing', () => {
  it('renames an event', () => {
    const renamed = unwrap(anEvent().rename(OTHER_NAME))

    expect(renamed.name).toBe(OTHER_NAME)
  })

  it('replaces the settings wholesale', () => {
    const updated = unwrap(anEvent().withSettings(RETAINED_30_DAYS))

    expect(updated.settings).toBe(RETAINED_30_DAYS)
  })

  it('rotates the join code when the link escapes the venue', () => {
    const rotated = unwrap(anEvent({ status: 'live' }).rotateJoinCode(OTHER_JOIN_CODE))

    expect(rotated.joinCode).toBe(OTHER_JOIN_CODE)
  })

  it('leaves the original untouched when renaming', () => {
    const event = anEvent()

    unwrap(event.rename(OTHER_NAME))

    expect(event.name).toBe(NAME)
  })

  it.each<[string, (event: Event) => Result<Event, DomainError>]>([
    ['rename', (event) => event.rename(OTHER_NAME)],
    ['settings change', (event) => event.withSettings(RETAINED_30_DAYS)],
    ['join code rotation', (event) => event.rotateJoinCode(OTHER_JOIN_CODE)],
  ])('refuses a %s on an archived event', (_label, edit) => {
    const result = edit(anEvent({ status: 'archived', closedAt: ENDED_AT }))

    expect(!result.ok && result.error.code).toBe('event.immutable')
  })

  it('reports an edit of an archived event as a conflict, so the API answers 409', () => {
    const result = anEvent({ status: 'archived' }).rename(OTHER_NAME)

    expect(!result.ok && result.error.kind).toBe('conflict')
  })
})

describe('Event capabilities', () => {
  it('accepts uploads only while live', () => {
    expect(anEvent({ status: 'live' }).acceptsUploads()).toBe(true)
    expect(anEvent({ status: 'draft' }).acceptsUploads()).toBe(false)
  })

  it('accepts new guests only while live', () => {
    expect(anEvent({ status: 'live' }).acceptsGuests()).toBe(true)
    expect(anEvent({ status: 'closed' }).acceptsGuests()).toBe(false)
  })

  it('keeps serving the wall after closing, but not once archived', () => {
    expect(anEvent({ status: 'closed' }).servesWall()).toBe(true)
    expect(anEvent({ status: 'archived' }).servesWall()).toBe(false)
  })

  it('allows moderation until the event is archived', () => {
    expect(anEvent({ status: 'closed' }).allowsModeration()).toBe(true)
    expect(anEvent({ status: 'archived' }).allowsModeration()).toBe(false)
  })
})

describe('Event quota', () => {
  it('accepts a photo that fills the quota exactly', () => {
    const event = anEvent()

    expect(event.hasQuotaFor(100, 900)).toBe(true)
  })

  it('refuses a photo one byte past the quota', () => {
    const event = anEvent()

    expect(event.hasQuotaFor(101, 900)).toBe(false)
  })

  it('reports how many bytes are left', () => {
    expect(anEvent().remainingQuota(900)).toBe(100)
  })

  it('clamps a usage that already drifted past the quota at zero', () => {
    expect(anEvent().remainingQuota(1_200)).toBe(0)
  })
})

describe('Event retention', () => {
  it.each<[EventStatus, Date | null]>([
    ['draft', null],
    ['live', null],
    ['closed', PURGE_DUE_AT],
    ['archived', PURGE_DUE_AT],
  ])('gives a %s event the deadline %p', (status, expected) => {
    const event = anEvent({ status, settings: RETAINED_30_DAYS, closedAt: ENDED_AT })

    expect(event.retentionDeadline()).toEqual(expected)
  })

  it('has no deadline when the host asked to keep the album forever', () => {
    const event = anEvent({ status: 'closed', closedAt: ENDED_AT })

    expect(event.retentionDeadline()).toBeNull()
  })

  it('has no deadline when a stored row has no closing time', () => {
    const event = anEvent({ status: 'closed', settings: RETAINED_30_DAYS, closedAt: null })

    expect(event.retentionDeadline()).toBeNull()
  })

  it('is not due for purge the day before its deadline', () => {
    const event = anEvent({ status: 'closed', settings: RETAINED_30_DAYS, closedAt: ENDED_AT })

    expect(event.isDueForPurge(new Date('2026-07-20T02:00:00.000Z'))).toBe(false)
  })

  it('is due for purge on the deadline itself', () => {
    const event = anEvent({ status: 'closed', settings: RETAINED_30_DAYS, closedAt: ENDED_AT })

    expect(event.isDueForPurge(PURGE_DUE_AT)).toBe(true)
  })

  it('is due for purge after its deadline', () => {
    const event = anEvent({ status: 'closed', settings: RETAINED_30_DAYS, closedAt: ENDED_AT })

    expect(event.isDueForPurge(new Date('2026-08-01T00:00:00.000Z'))).toBe(true)
  })

  it('is never due for purge without a retention policy', () => {
    const event = anEvent({ status: 'archived', closedAt: ENDED_AT })

    expect(event.isDueForPurge(new Date('2030-01-01T00:00:00.000Z'))).toBe(false)
  })
})

describe('Event identity', () => {
  it('stays the same event after a rename', () => {
    const event = anEvent()

    const renamed = unwrap(event.rename(OTHER_NAME))

    expect(renamed.equals(event)).toBe(true)
  })

  it('is not equal to another event that happens to share a slug', () => {
    expect(anEvent().equals(anEvent({ id: OTHER_EVENT_ID }))).toBe(false)
  })

  it('hands the repository every stored field', () => {
    const settings = EventSettings.default()

    const props = anEvent({ status: 'closed', settings, closedAt: ENDED_AT }).toProps()

    expect(props).toEqual({
      id: EVENT_ID,
      ownerId: OWNER_ID,
      name: NAME,
      slug: SLUG,
      joinCode: JOIN_CODE,
      status: 'closed',
      settings,
      quotaBytes: QUOTA_BYTES,
      createdAt: CREATED_AT,
      startsAt: null,
      closedAt: ENDED_AT,
      scheduledOpenAt: null,
      scheduledCloseAt: null,
      scheduleDiscardedAt: null,
    })
  })
})

describe('Event schedule', () => {
  /** 18:00 at the venue, resolved to an instant long before it reached the domain. */
  const OPEN_AT = WENT_LIVE_AT
  /** 02:00 the following morning. */
  const CLOSE_AT = ENDED_AT
  /** The sweep that should have run at 18:00 and did not, because the box was down. */
  const SEVEN_MINUTES_LATE = new Date('2026-06-20T18:07:00.000Z')

  /** When the host is at the settings form: the morning of, both instants still ahead. */
  const ARMED_AT = CREATED_AT

  const scheduled = (overrides: Partial<EventProps> = {}): Event =>
    anEvent({ scheduledOpenAt: OPEN_AT, scheduledCloseAt: CLOSE_AT, ...overrides })

  describe('reschedule', () => {
    it('is empty on a new event, so nothing moves on its own until a host asks for it', () => {
      const event = unwrap(Event.create(newEvent({ startsAt: STARTS_AT }), EVENT_ID, CREATED_AT))

      expect(event.scheduledOpenAt).toBeNull()
      expect(event.scheduledCloseAt).toBeNull()
    })

    it('keeps the two instants the host chose', () => {
      const event = unwrap(
        anEvent().reschedule({ scheduledOpenAt: OPEN_AT, scheduledCloseAt: CLOSE_AT }, ARMED_AT),
      )

      expect(event.scheduledOpenAt).toBe(OPEN_AT)
      expect(event.scheduledCloseAt).toBe(CLOSE_AT)
    })

    it('accepts an opening with no closing, for a host who will close it themselves', () => {
      const event = unwrap(
        anEvent().reschedule({ scheduledOpenAt: OPEN_AT, scheduledCloseAt: null }, ARMED_AT),
      )

      expect(event.scheduledOpenAt).toBe(OPEN_AT)
      expect(event.scheduledCloseAt).toBeNull()
    })

    it('accepts a closing with no opening, for a host who opens the doors by hand', () => {
      const event = unwrap(
        anEvent().reschedule({ scheduledOpenAt: null, scheduledCloseAt: CLOSE_AT }, ARMED_AT),
      )

      expect(event.scheduledOpenAt).toBeNull()
      expect(event.scheduledCloseAt).toBe(CLOSE_AT)
    })

    it('clears both halves, which is how a host turns the schedule off', () => {
      const event = unwrap(
        scheduled().reschedule({ scheduledOpenAt: null, scheduledCloseAt: null }, ARMED_AT),
      )

      expect(event.scheduledOpenAt).toBeNull()
      expect(event.scheduledCloseAt).toBeNull()
    })

    it('refuses a closing before the opening', () => {
      const result = anEvent().reschedule(
        { scheduledOpenAt: CLOSE_AT, scheduledCloseAt: OPEN_AT },
        ARMED_AT,
      )

      expect(!result.ok && result.error.code).toBe('event.scheduleOutOfOrder')
    })

    it('refuses a closing at the same instant as the opening', () => {
      const result = anEvent().reschedule(
        { scheduledOpenAt: OPEN_AT, scheduledCloseAt: OPEN_AT },
        ARMED_AT,
      )

      expect(!result.ok && result.error.code).toBe('event.scheduleOutOfOrder')
    })

    it('refuses an unreadable opening rather than storing an invalid date', () => {
      const result = anEvent().reschedule(
        { scheduledOpenAt: new Date('pas une date'), scheduledCloseAt: null },
        ARMED_AT,
      )

      expect(!result.ok && result.error.code).toBe('event.scheduleInvalid')
    })

    it('refuses an unreadable closing even when the opening is fine', () => {
      const result = anEvent().reschedule(
        { scheduledOpenAt: OPEN_AT, scheduledCloseAt: new Date('pas une date') },
        ARMED_AT,
      )

      expect(!result.ok && result.error.code).toBe('event.scheduleInvalid')
    })

    it('refuses to arm a timer on an archived event', () => {
      const result = anEvent({ status: 'archived' }).reschedule(
        { scheduledOpenAt: OPEN_AT, scheduledCloseAt: CLOSE_AT },
        ARMED_AT,
      )

      expect(!result.ok && result.error.code).toBe('event.immutable')
    })
  })

  /**
   * The likeliest host error with this feature, and the one every layer used to accept:
   * it is 21:30, the party is running, the host arms the closing and picks 02:00 with
   * today's date still in the field.
   */
  describe('an instant that has already gone by', () => {
    const HALF_PAST_NINE = new Date('2026-06-20T21:30:00.000Z')
    /** 02:00 **today**, which is what the date picker offers before it is advanced. */
    const TWO_AM_TODAY = new Date('2026-06-20T02:00:00.000Z')

    it('refuses a closing the host meant for tomorrow morning', () => {
      const result = anEvent({ status: 'live' }).reschedule(
        { scheduledOpenAt: null, scheduledCloseAt: TWO_AM_TODAY },
        HALF_PAST_NINE,
      )

      expect(!result.ok && result.error.code).toBe('event.scheduleInPast')
    })

    it('refuses an opening in the past, which would let guests in before the host meant to', () => {
      const result = anEvent().reschedule(
        { scheduledOpenAt: TWO_AM_TODAY, scheduledCloseAt: null },
        HALF_PAST_NINE,
      )

      expect(!result.ok && result.error.code).toBe('event.scheduleInPast')
    })

    it('reports it as a parse failure, so the API answers 400', () => {
      const result = anEvent({ status: 'live' }).reschedule(
        { scheduledOpenAt: null, scheduledCloseAt: TWO_AM_TODAY },
        HALF_PAST_NINE,
      )

      expect(!result.ok && result.error.kind).toBe('invalid')
    })

    it('accepts the minute the host is standing in', () => {
      // Judged to the minute: they picked 21:30 at 21:29:55 and the request landed at
      // 21:30:40. Refusing that would be an error message for a correct instruction.
      const result = anEvent({ status: 'live' }).reschedule(
        { scheduledOpenAt: null, scheduledCloseAt: HALF_PAST_NINE },
        new Date('2026-06-20T21:30:40.000Z'),
      )

      expect(result.ok).toBe(true)
    })

    it('refuses the minute before that one', () => {
      const result = anEvent({ status: 'live' }).reschedule(
        { scheduledOpenAt: null, scheduledCloseAt: new Date('2026-06-20T21:29:00.000Z') },
        new Date('2026-06-20T21:30:40.000Z'),
      )

      expect(!result.ok && result.error.code).toBe('event.scheduleInPast')
    })

    it('still lets a stored instant age past, which is what a missed window is', () => {
      // The guard judges once, when the host sets it. Nothing re-validates a stored
      // instant, so an 18:00 opening the server slept through is still due at 18:07.
      const armed = unwrap(
        anEvent().reschedule({ scheduledOpenAt: OPEN_AT, scheduledCloseAt: null }, ARMED_AT),
      )

      expect(armed.applySchedule(SEVEN_MINUTES_LATE).applied).toEqual(['open'])
    })
  })

  describe('what is due', () => {
    it('has nothing due when no schedule was ever set', () => {
      expect(anEvent().hasDueSchedule(CLOSE_AT)).toBe(false)
    })

    it('is not due before the instant', () => {
      expect(scheduled().isDueToOpen(STARTS_AT)).toBe(false)
      expect(scheduled().isDueToClose(OPEN_AT)).toBe(false)
    })

    it('is due at the instant itself', () => {
      expect(scheduled().isDueToOpen(OPEN_AT)).toBe(true)
      expect(scheduled().isDueToClose(CLOSE_AT)).toBe(true)
    })

    it('is still due long after a missed instant, because a deadline does not expire', () => {
      expect(scheduled().isDueToOpen(SEVEN_MINUTES_LATE)).toBe(true)
    })

    it('has something due as soon as either half has passed', () => {
      const openOnly = anEvent({ scheduledOpenAt: OPEN_AT })
      const closeOnly = anEvent({ scheduledCloseAt: CLOSE_AT })

      expect(openOnly.hasDueSchedule(OPEN_AT)).toBe(true)
      expect(closeOnly.hasDueSchedule(CLOSE_AT)).toBe(true)
      expect(closeOnly.hasDueSchedule(OPEN_AT)).toBe(false)
    })
  })

  describe('applySchedule', () => {
    it('changes nothing while both instants are still ahead', () => {
      const outcome = scheduled().applySchedule(STARTS_AT)

      expect(outcome.applied).toEqual([])
      expect(outcome.refused).toEqual([])
      expect(outcome.event.status).toBe('draft')
      expect(outcome.event.scheduledOpenAt).toBe(OPEN_AT)
    })

    it('opens the doors when the opening instant has passed', () => {
      const outcome = scheduled().applySchedule(OPEN_AT)

      expect(outcome.applied).toEqual(['open'])
      expect(outcome.event.status).toBe('live')
    })

    it('opens an event whose instant was missed while the server was down', () => {
      // The reason this is a sweep and not a timer per event: nobody was listening at
      // 18:00, and the party must still be open when something next looks at 18:07.
      const outcome = scheduled().applySchedule(SEVEN_MINUTES_LATE)

      expect(outcome.applied).toEqual(['open'])
      expect(outcome.event.status).toBe('live')
    })

    it('spends the opening instant and leaves the closing one alone', () => {
      const outcome = scheduled().applySchedule(OPEN_AT)

      expect(outcome.event.scheduledOpenAt).toBeNull()
      expect(outcome.event.scheduledCloseAt).toBe(CLOSE_AT)
    })

    it('closes the event when the closing instant has passed', () => {
      const event = anEvent({ status: 'live', scheduledCloseAt: CLOSE_AT })

      const outcome = event.applySchedule(CLOSE_AT)

      expect(outcome.applied).toEqual(['close'])
      expect(outcome.event.status).toBe('closed')
      expect(outcome.event.scheduledCloseAt).toBeNull()
    })

    it('starts the retention clock at the moment the sweep closed it', () => {
      const event = anEvent({ status: 'live', scheduledCloseAt: CLOSE_AT })

      const outcome = event.applySchedule(REALLY_ENDED_AT)

      expect(outcome.event.closedAt).toBe(REALLY_ENDED_AT)
    })

    it('catches up on a whole evening in one pass and lands closed, not open', () => {
      // The box was off from before the party until after it. Opening an event that
      // finished two hours ago and leaving it open is worse than never opening it.
      const outcome = scheduled().applySchedule(REALLY_ENDED_AT)

      expect(outcome.applied).toEqual(['open', 'close'])
      expect(outcome.event.status).toBe('closed')
      expect(outcome.event.scheduledOpenAt).toBeNull()
      expect(outcome.event.scheduledCloseAt).toBeNull()
    })

    it('does not reopen an archived event because a timestamp passed', () => {
      const event = anEvent({ status: 'archived', scheduledOpenAt: OPEN_AT })

      const outcome = event.applySchedule(OPEN_AT)

      expect(outcome.applied).toEqual([])
      expect(outcome.refused).toEqual(['open'])
      expect(outcome.event.status).toBe('archived')
    })

    it('drops a schedule the lifecycle will never accept instead of retrying it forever', () => {
      const event = anEvent({ status: 'archived', scheduledOpenAt: OPEN_AT })

      const outcome = event.applySchedule(OPEN_AT)

      expect(outcome.event.scheduledOpenAt).toBeNull()
    })

    it('refuses to close an event that never opened, because draft has no way there', () => {
      const event = anEvent({ status: 'draft', scheduledCloseAt: CLOSE_AT })

      const outcome = event.applySchedule(CLOSE_AT)

      expect(outcome.refused).toEqual(['close'])
      expect(outcome.event.status).toBe('draft')
    })

    it('reports an already-live event as opened rather than dropping the instant', () => {
      const event = anEvent({ status: 'live', scheduledOpenAt: OPEN_AT })

      const outcome = event.applySchedule(OPEN_AT)

      expect(outcome.applied).toEqual(['open'])
      expect(outcome.event.status).toBe('live')
    })

    it('changes nothing the second time it runs', () => {
      const once = scheduled().applySchedule(REALLY_ENDED_AT)

      const twice = once.event.applySchedule(REALLY_ENDED_AT)

      expect(twice.applied).toEqual([])
      expect(twice.refused).toEqual([])
      expect(twice.event.toProps()).toEqual(once.event.toProps())
    })
  })

  /**
   * Discarding a refused instant is right — retrying an impossible transition every few
   * minutes forever is worse — but it deletes something the host typed while they are
   * not looking, so it has to leave a mark they can read.
   */
  describe('a schedule the lifecycle threw away', () => {
    it('records when it happened, so the host is not left with an unexplained blank', () => {
      const event = anEvent({ status: 'archived', scheduledOpenAt: OPEN_AT })

      const outcome = event.applySchedule(SEVEN_MINUTES_LATE)

      expect(outcome.event.scheduleDiscardedAt).toBe(SEVEN_MINUTES_LATE)
    })

    it('records the close a draft event could never have honoured', () => {
      const event = anEvent({ status: 'draft', scheduledCloseAt: CLOSE_AT })

      const outcome = event.applySchedule(REALLY_ENDED_AT)

      expect(outcome.event.scheduleDiscardedAt).toBe(REALLY_ENDED_AT)
    })

    it('leaves no mark when every due instant was honoured', () => {
      const outcome = scheduled().applySchedule(REALLY_ENDED_AT)

      expect(outcome.event.scheduleDiscardedAt).toBeNull()
    })

    it('is cleared when the host saves a schedule, which is them answering the notice', () => {
      const discarded = anEvent({ status: 'live', scheduleDiscardedAt: SEVEN_MINUTES_LATE })

      const rearmed = unwrap(
        discarded.reschedule({ scheduledOpenAt: null, scheduledCloseAt: CLOSE_AT }, ARMED_AT),
      )

      expect(rearmed.scheduleDiscardedAt).toBeNull()
    })

    it('is cleared by saving an empty schedule, so the notice can be dismissed', () => {
      const discarded = anEvent({ status: 'live', scheduleDiscardedAt: SEVEN_MINUTES_LATE })

      const cleared = unwrap(
        discarded.reschedule({ scheduledOpenAt: null, scheduledCloseAt: null }, ARMED_AT),
      )

      expect(cleared.scheduleDiscardedAt).toBeNull()
    })

    it('survives a refusal, so a rejected save does not swallow the notice', () => {
      const discarded = anEvent({ status: 'live', scheduleDiscardedAt: SEVEN_MINUTES_LATE })

      const refused = discarded.reschedule(
        { scheduledOpenAt: CLOSE_AT, scheduledCloseAt: OPEN_AT },
        ARMED_AT,
      )

      expect(refused.ok).toBe(false)
      expect(discarded.scheduleDiscardedAt).toBe(SEVEN_MINUTES_LATE)
    })
  })
})
