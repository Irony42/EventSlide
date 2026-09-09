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
    })
  })
})
