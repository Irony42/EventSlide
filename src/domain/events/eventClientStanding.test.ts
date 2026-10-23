import { describe, expect, it } from 'vitest'
import { AT, anEvent, atPlus } from '../../application/testing/builders'
import { Event } from './event'
import { EVENT_STATUSES } from './eventStatus'

/**
 * What an event says of its client's suspension (roadmap §10.7; G2-14): a fact read from the
 * client and carried for the surfaces that serve an event, never written back, and the one thing
 * that turns a join code, an upload and the wall into the answer an unknown event gets.
 */

const suspended = (status: (typeof EVENT_STATUSES)[number] = 'live'): Event =>
  Event.restore({
    ...anEvent({ status, clientId: 'client-1' }).toProps(),
    clientSuspendedAt: atPlus(5),
  })

describe('an event whose client is suspended', () => {
  it('knows it, and says since when', () => {
    const event = suspended()

    expect(event.isClientSuspended()).toBe(true)
    expect(event.clientSuspendedAt).toEqual(atPlus(5))
  })

  it('is not suspended when nothing says so: an event with no client, or one read by a listing', () => {
    expect(anEvent().isClientSuspended()).toBe(false)
    expect(anEvent({ clientId: 'client-1' }).isClientSuspended()).toBe(false)
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
    const live = anEvent({ status: 'live', clientId: 'client-1' })

    expect(live.acceptsGuests()).toBe(true)
    expect(live.acceptsUploads()).toBe(true)
  })

  it('keeps serving the host everything the status allows: its lifecycle and its wall predicate are the status’s own', () => {
    // Suspension is read at the surfaces, not folded into the lifecycle: a host reads, a closed event
    // stays closed, and resuming has nothing to restore in the entity.
    const event = suspended('closed')

    expect(event.status).toBe('closed')
    expect(event.servesWall()).toBe(anEvent({ status: 'closed' }).servesWall())
    expect(event.createdAt).toEqual(AT)
  })

  it('carries the fact through a copy of its properties, so a restore does not lose it', () => {
    const copy = Event.restore(suspended().toProps())

    expect(copy.isClientSuspended()).toBe(true)
  })
})
