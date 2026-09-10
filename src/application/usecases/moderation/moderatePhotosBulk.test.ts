import { beforeEach, describe, expect, it } from 'vitest'
import { makeModeratePhotosBulk, type ModeratePhotosBulk } from './moderatePhotosBulk'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asPhotoId, asUserId, type PhotoId } from '../../../domain/shared/ids'
import { anEvent, aPhoto, AT } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'

const EVENT = asEventId('event-1')
const MODERATOR = asUserId('user-2')

const moderator: PhotoActor = { kind: 'host', userId: MODERATOR }
const guest: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-1') }

const ids = (...values: readonly string[]): readonly PhotoId[] =>
  values.map((value) => asPhotoId(value))

describe('moderatePhotosBulk', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let moderatePhotosBulk: ModeratePhotosBulk

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    moderatePhotosBulk = makeModeratePhotosBulk({ events, photos, memberships, bus, clock })

    events.seed(anEvent({ id: 'event-1' }))
    memberships.seed({ eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT })
  })

  it('applies the photos it legally can and skips the rest instead of failing the batch', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }),
      aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published' }),
      aPhoto({ id: 'photo-3', eventId: 'event-1', status: 'rejected' }),
    )

    const result = await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-1', 'photo-2', 'photo-3'),
      decision: 'hide',
      actor: moderator,
    })

    expect(result.ok && result.value).toEqual({
      applied: ids('photo-2'),
      skipped: ids('photo-1', 'photo-3'),
    })
  })

  it('writes only the applied photos', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }),
      aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published' }),
    )

    await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-1', 'photo-2'),
      decision: 'hide',
      actor: moderator,
    })

    const page = await photos.list(EVENT, { statuses: ['hidden'] })
    expect(page.items.map((photo) => photo.id)).toEqual(ids('photo-2'))
  })

  it('announces only the photos whose status actually moved', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }),
      aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published' }),
    )

    await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-1', 'photo-2'),
      decision: 'hide',
      actor: moderator,
    })

    expect(bus.published).toEqual([
      { type: 'photo.moderated', eventId: EVENT, photoId: asPhotoId('photo-2'), status: 'hidden' },
    ])
  })

  it('counts a photo already in the target status as applied and announces nothing for it', async () => {
    photos.seed(aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published' }))

    const result = await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-2'),
      decision: 'publish',
      actor: moderator,
    })

    expect(result.ok && result.value.applied).toEqual(ids('photo-2'))
    expect(bus.published).toEqual([])
  })

  it('neither applies nor reports an id that belongs to another event', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }),
      aPhoto({ id: 'photo-2', eventId: 'event-2', status: 'pending' }),
    )

    const result = await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-1', 'photo-2'),
      decision: 'publish',
      actor: moderator,
    })

    expect(result.ok && result.value).toEqual({ applied: ids('photo-1'), skipped: [] })
  })

  it('leaves a photo from another event untouched when its id is in the batch', async () => {
    photos.seed(aPhoto({ id: 'photo-2', eventId: 'event-2', status: 'pending' }))

    await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-2'),
      decision: 'publish',
      actor: moderator,
    })

    const untouched = await photos.findById(asEventId('event-2'), asPhotoId('photo-2'))
    expect(untouched?.status).toBe('pending')
  })

  it('records which host decided on every applied photo', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-1'),
      decision: 'publish',
      actor: moderator,
    })

    const stored = await photos.findById(EVENT, asPhotoId('photo-1'))
    expect(stored?.review).toEqual({ kind: 'host', userId: MODERATOR, at: AT })
  })

  it('refuses a guest actor', async () => {
    const result = await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-1'),
      decision: 'publish',
      actor: guest,
    })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('refuses a signed-in user with no part in the event, as if it did not exist', async () => {
    const result = await moderatePhotosBulk({
      eventId: EVENT,
      photoIds: ids('photo-1'),
      decision: 'publish',
      actor: { kind: 'host', userId: asUserId('user-99') },
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a batch on an archived event', async () => {
    events.seed(
      anEvent({ id: 'event-9', slug: 'gala-2026', joinCode: 'H7K2QN', status: 'archived' }),
    )
    memberships.seed({
      eventId: asEventId('event-9'),
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })

    const result = await moderatePhotosBulk({
      eventId: asEventId('event-9'),
      photoIds: ids('photo-9'),
      decision: 'publish',
      actor: moderator,
    })

    expect(!result.ok && result.error.code).toBe('event.notModeratable')
  })

  it('refuses a batch on an event that does not exist', async () => {
    const result = await moderatePhotosBulk({
      eventId: asEventId('event-404'),
      photoIds: ids('photo-1'),
      decision: 'publish',
      actor: moderator,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
