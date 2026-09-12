import { beforeEach, describe, expect, it } from 'vitest'
import { makeModeratePhoto, type ModeratePhoto } from './moderatePhoto'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import { anEvent, aPhoto, AT } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')
const MODERATOR = asUserId('user-2')

const moderator: PhotoActor = { kind: 'host', userId: MODERATOR }
const guest: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-1') }

describe('moderatePhoto', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let moderatePhoto: ModeratePhoto

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    moderatePhoto = makeModeratePhoto({ events, photos, memberships, bus, clock })

    events.seed(anEvent({ id: 'event-1' }))
    memberships.seed({ eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT })
  })

  it.each([
    { decision: 'publish', from: 'pending', to: 'published' },
    { decision: 'reject', from: 'pending', to: 'rejected' },
    { decision: 'hide', from: 'published', to: 'hidden' },
  ] as const)('moves a $from photo to $to when the host decides $decision', async (row) => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: row.from }))

    const result = await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: row.decision,
      actor: moderator,
    })

    expect(result.ok).toBe(true)
    const stored = await photos.findById(EVENT, PHOTO)
    expect(stored?.status).toBe(row.to)
  })

  it('announces the new status so every projector re-reads its playlist', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: 'publish',
      actor: moderator,
    })

    expect(bus.published).toEqual([
      { type: 'photo.moderated', eventId: EVENT, photoId: PHOTO, status: 'published' },
    ])
  })

  it('records which host decided, so "how did that reach the screen" has an answer', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: 'publish',
      actor: moderator,
    })

    const stored = await photos.findById(EVENT, PHOTO)
    expect(stored?.review).toEqual({ kind: 'host', userId: MODERATOR, at: AT })
  })

  it('refuses a transition the status machine does not allow', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    const result = await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: 'hide',
      actor: moderator,
    })

    expect(!result.ok && result.error.kind).toBe('conflict')
    expect(!result.ok && result.error.code).toBe('photo.illegalTransition')
  })

  it('announces nothing when the transition is refused', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    await moderatePhoto({ eventId: EVENT, photoId: PHOTO, decision: 'hide', actor: moderator })

    expect(bus.published).toEqual([])
  })

  it('cannot moderate a photo that belongs to another event', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-2', status: 'pending' }))

    const result = await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: 'publish',
      actor: moderator,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('leaves a photo from another event untouched when its id is submitted', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-2', status: 'pending' }))

    await moderatePhoto({ eventId: EVENT, photoId: PHOTO, decision: 'publish', actor: moderator })

    const untouched = await photos.findById(asEventId('event-2'), PHOTO)
    expect(untouched?.status).toBe('pending')
  })

  it('refuses a guest actor: what the room sees is never decided by a phone', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    const result = await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: 'publish',
      actor: guest,
    })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('refuses a signed-in user with no part in the event, as if it did not exist', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    const result = await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: 'publish',
      actor: { kind: 'host', userId: asUserId('user-99') },
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a moderator of another event', async () => {
    events.seed(anEvent({ id: 'event-9', slug: 'gala-2026', joinCode: 'H7K2QN' }))
    memberships.seed({
      eventId: asEventId('event-9'),
      userId: asUserId('user-9'),
      role: 'owner',
      grantedAt: AT,
    })
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }))

    const result = await moderatePhoto({
      eventId: EVENT,
      photoId: PHOTO,
      decision: 'publish',
      actor: { kind: 'host', userId: asUserId('user-9') },
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a decision on an archived event, which is a record and not a live object', async () => {
    events.seed(
      anEvent({ id: 'event-9', slug: 'gala-2026', joinCode: 'H7K2QN', status: 'archived' }),
    )
    memberships.seed({
      eventId: asEventId('event-9'),
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    photos.seed(aPhoto({ id: 'photo-9', eventId: 'event-9', status: 'pending' }))

    const result = await moderatePhoto({
      eventId: asEventId('event-9'),
      photoId: asPhotoId('photo-9'),
      decision: 'publish',
      actor: moderator,
    })

    expect(!result.ok && result.error.kind).toBe('conflict')
    expect(!result.ok && result.error.code).toBe('event.notModeratable')
  })

  it('refuses a decision on an event that does not exist', async () => {
    const result = await moderatePhoto({
      eventId: asEventId('event-404'),
      photoId: PHOTO,
      decision: 'publish',
      actor: moderator,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
