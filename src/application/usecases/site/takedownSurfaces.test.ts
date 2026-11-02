import { beforeEach, describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent, aPhoto } from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makePurgeEvent } from '../events/purgeEvent'
import { makeDeletePhoto } from '../photos/deletePhoto'
import { makeRemoveEventLogo } from '../brand/removeEventLogo'
import { makeRemoveVenuePhoto } from '../venue/removeVenuePhoto'
import { CapturingLogger } from '../../testing/capturingLogger'
import { requireReadable, requireWritable } from '../shared/eventRole'

/**
 * What the operator's levers mean to the rest of the product (launch review S5): the entity's
 * predicates, the two shared refusals, and the two things a purge hold must stop a host or a guest
 * doing. The surfaces (wall, feed, gallery, media, stream) are held end to end in
 * `takedown.container.test.ts`.
 */

const EVENT = asEventId('event-1')
const OWNER = asUserId('user-owner')

const down = (): Event => Event.restore({ ...anEvent().toProps(), takenDownAt: AT })
const held = (): Event => Event.restore({ ...anEvent().toProps(), purgeHeldAt: AT })
const frozen = (): Event => Event.restore({ ...anEvent().toProps(), clientSuspendedAt: AT })

describe('an event the operator took down', () => {
  it('serves nothing and accepts nobody, whatever its lifecycle says', () => {
    const event = down()

    expect(event.isTakenDown()).toBe(true)
    expect(event.servesWall()).toBe(false)
    expect(event.servesPublicWall()).toBe(false)
    expect(event.acceptsUploads()).toBe(false)
    expect(event.acceptsGuests()).toBe(false)
  })

  it('is an event like any other while it is not taken down', () => {
    const event = anEvent()

    expect(event.isTakenDown()).toBe(false)
    expect(event.isPurgeHeld()).toBe(false)
    expect(event.takenDownAt).toBeNull()
    expect(event.purgeHeldAt).toBeNull()
    expect(event.servesWall() && event.acceptsUploads() && event.acceptsGuests()).toBe(true)
  })

  it('is held without being hidden: a purge hold serves everything it served', () => {
    const event = held()

    expect(event.isPurgeHeld()).toBe(true)
    expect(event.purgeHeldAt).toEqual(AT)
    expect(event.servesPublicWall()).toBe(true)
  })
})

describe('requireReadable and requireWritable', () => {
  it('let an ordinary event through', () => {
    expect(requireReadable(anEvent()).ok).toBe(true)
    expect(requireWritable(anEvent()).ok).toBe(true)
  })

  it('answer a taken-down event as one that is not there, and say nothing of why', () => {
    for (const result of [requireReadable(down()), requireWritable(down())]) {
      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'notFound',
        'event.notFound',
      ])
    }
  })

  it("refuse a suspended client's members the photographs, as they already refuse them the writes", () => {
    for (const result of [requireReadable(frozen()), requireWritable(frozen())]) {
      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'forbidden',
        'client.suspended',
      ])
    }
  })
})

describe('a purge hold', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore

  beforeEach(async () => {
    events = new FakeEventRepository().seed(anEvent({ id: 'event-1', ownerId: 'user-owner' }))
    memberships = new FakeMembershipRepository()
    await memberships.grant({ eventId: EVENT, userId: OWNER, role: 'owner', grantedAt: AT })
    photos = new FakePhotoRepository().seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        author: { kind: 'guest', id: 'guest-1' },
      }),
    )
    media = new InMemoryMediaStore()
    await events.setPurgeHeld(EVENT, AT)
  })

  it('stops the host purging the event, and leaves it and its media where they were', async () => {
    const purge = makePurgeEvent({ events, memberships, media })

    const result = await purge({ eventId: EVENT, actorId: OWNER })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'unexpected',
      'event.mediaPurgeFailed',
    ])
    expect(await events.findById(EVENT)).not.toBeNull()
  })

  it('stops anyone deleting a photograph, the guest who sent it included, and keeps the row', async () => {
    const deletePhoto = makeDeletePhoto({
      events,
      photos,
      clips: new FakeClipJobRepository(),
      media,
      bus: new RecordingEventBus(),
      clock: new FakeClock(),
    })

    for (const actor of [
      { kind: 'host', userId: OWNER },
      { kind: 'guest', guestId: asGuestId('guest-1') },
    ] as const) {
      const result = await deletePhoto({ eventId: EVENT, photoId: asPhotoId('photo-1'), actor })

      expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
        'unexpected',
        'photo.deleteFailed',
      ])
    }
    expect(await photos.findById(EVENT, asPhotoId('photo-1'))).not.toBeNull()
  })

  it('still answers 404 for a photograph that does not exist, hold or not', async () => {
    const deletePhoto = makeDeletePhoto({
      events,
      photos,
      clips: new FakeClipJobRepository(),
      media,
      bus: new RecordingEventBus(),
      clock: new FakeClock(),
    })

    const result = await deletePhoto({
      eventId: EVENT,
      photoId: asPhotoId('ghost'),
      actor: { kind: 'host', userId: OWNER },
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('lets the purge through again once the operator has released it', async () => {
    await events.setPurgeHeld(EVENT, null)

    const result = await makePurgeEvent({ events, memberships, media })({
      eventId: EVENT,
      actorId: OWNER,
    })

    expect(result.ok).toBe(true)
    expect(await events.findById(EVENT)).toBeNull()
  })

  it('stops the host removing the venue photograph, whose bytes it would delete', async () => {
    const remove = makeRemoveVenuePhoto({
      events,
      memberships,
      media,
      bus: new RecordingEventBus(),
      logger: new CapturingLogger(),
    })

    const result = await remove({ eventId: EVENT, actorId: OWNER })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'unexpected',
      'venuePhoto.saveFailed',
    ])
  })

  it('stops the host removing the logo, whose bytes it would delete', async () => {
    const remove = makeRemoveEventLogo({
      events,
      memberships,
      media,
      bus: new RecordingEventBus(),
      logger: new CapturingLogger(),
    })

    const result = await remove({ eventId: EVENT, actorId: OWNER })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'unexpected',
      'logo.saveFailed',
    ])
  })
})
