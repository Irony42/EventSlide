import { describe, expect, it } from 'vitest'
import { asClientId, asEventId, asUserId } from '../shared/ids'
import { JoinCode } from '../shared/joinCode'
import { Slug } from '../shared/slug'
import { Event, type EventProps } from './event'
import { EventName } from './eventName'
import { EventSettings } from './eventSettings'
import { EVENT_STATUSES, type EventStatus } from './eventStatus'

/**
 * What an event says of its client's suspension (roadmap §10.7; G2-14): a fact read from the
 * client and carried for the surfaces that serve an event, never written back, and the one thing
 * that turns a join code, an upload and the wall into the answer an unknown event gets.
 */

const CREATED_AT = new Date('2026-06-20T09:00:00.000Z')
const SUSPENDED_AT = new Date('2026-06-22T09:00:00.000Z')

const part = <T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
  if (!result.ok) throw new Error('fixture: ' + result.error.code)
  return result.value
}

const anEvent = (overrides: Partial<EventProps> = {}): Event =>
  Event.restore({
    id: asEventId('evt-1'),
    ownerId: asUserId('usr-1'),
    name: part(EventName.create('Camille & Sacha')),
    slug: part(Slug.create('camille-et-sacha')),
    joinCode: part(JoinCode.create('H7K2QM')),
    status: 'live',
    settings: EventSettings.default(),
    quotaBytes: 1_000,
    createdAt: CREATED_AT,
    startsAt: null,
    clientId: null,
    closedAt: null,
    openedAt: CREATED_AT,
    scheduledOpenAt: null,
    scheduledCloseAt: null,
    scheduleDiscardedAt: null,
    ...overrides,
  })

const suspended = (status: EventStatus = 'live'): Event =>
  Event.restore({
    ...anEvent({ status, clientId: asClientId('client-1') }).toProps(),
    clientSuspendedAt: SUSPENDED_AT,
  })

describe('an event whose client is suspended', () => {
  it('knows it, and says since when', () => {
    const event = suspended()

    expect(event.isClientSuspended()).toBe(true)
    expect(event.clientSuspendedAt).toEqual(SUSPENDED_AT)
  })

  it('is not suspended when nothing says so: an event with no client, or one read by a listing', () => {
    expect(anEvent().isClientSuspended()).toBe(false)
    expect(anEvent({ clientId: asClientId('client-1') }).isClientSuspended()).toBe(false)
    expect(anEvent().clientSuspendedAt).toBeNull()
  })

  it.each(EVENT_STATUSES)(
    'admits no guest by its join code, whatever its status (%s)',
    (status) => {
      expect(suspended(status).acceptsGuests()).toBe(false)
    },
  )

  it.each(EVENT_STATUSES)('takes no upload, whatever its status (%s)', (status) => {
    expect(suspended(status).acceptsUploads()).toBe(false)
  })

  it('does the same for a live event of a client in good standing, so the predicates only ever say no more', () => {
    const live = anEvent({ status: 'live', clientId: asClientId('client-1') })

    expect(live.acceptsGuests()).toBe(true)
    expect(live.acceptsUploads()).toBe(true)
  })

  it('keeps serving the host everything the status allows: its lifecycle and its wall predicate are the status’s own', () => {
    // Suspension is read at the surfaces, not folded into the lifecycle: a host reads, a closed event
    // stays closed, and resuming has nothing to restore in the entity.
    const event = suspended('closed')

    expect(event.status).toBe('closed')
    expect(event.servesWall()).toBe(anEvent({ status: 'closed' }).servesWall())
    expect(event.createdAt).toEqual(CREATED_AT)
  })

  it('carries the fact through a copy of its properties, so a restore does not lose it', () => {
    const copy = Event.restore(suspended().toProps())

    expect(copy.isClientSuspended()).toBe(true)
  })
})
