import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetModerationQueue, type GetModerationQueue } from './getModerationQueue'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { anEvent, aPhoto, atPlus, AT } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'

const EVENT = asEventId('event-1')
const MODERATOR = asUserId('user-2')

const moderator: PhotoActor = { kind: 'host', userId: MODERATOR }
const guest: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-1') }

const MINUTE = 60_000

describe('getModerationQueue', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let memberships: FakeMembershipRepository
  let getModerationQueue: GetModerationQueue

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    memberships = new FakeMembershipRepository()
    getModerationQueue = makeGetModerationQueue({ events, photos, memberships })

    events.seed(anEvent({ id: 'event-1' }))
    memberships.seed({ eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT })
  })

  /** Three arrivals a minute apart, so an ordering assertion cannot pass by accident. */
  const seedThreePending = (): void => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending', createdAt: AT }),
      aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'pending', createdAt: atPlus(MINUTE) }),
      aPhoto({
        id: 'photo-3',
        eventId: 'event-1',
        status: 'pending',
        createdAt: atPlus(2 * MINUTE),
      }),
    )
  }

  it('shows the pending tab oldest first, so the longest wait is decided next', async () => {
    seedThreePending()

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: null,
      actor: moderator,
    })

    expect(result.ok && result.value.items.map((item) => item.id)).toEqual([
      'photo-1',
      'photo-2',
      'photo-3',
    ])
  })

  it('honours an explicit newest-first order over the tab default', async () => {
    seedThreePending()

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: 'newestFirst',
      limit: null,
      actor: moderator,
    })

    expect(result.ok && result.value.items.map((item) => item.id)).toEqual([
      'photo-3',
      'photo-2',
      'photo-1',
    ])
  })

  it('shows the album tab newest first, because the host is looking at what just happened', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published', createdAt: AT }),
      aPhoto({
        id: 'photo-2',
        eventId: 'event-1',
        status: 'rejected',
        createdAt: atPlus(MINUTE),
      }),
    )

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'all',
      order: null,
      limit: null,
      actor: moderator,
    })

    expect(result.ok && result.value.items.map((item) => item.id)).toEqual(['photo-2', 'photo-1'])
  })

  it('returns only the requested status', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }),
      aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published', createdAt: atPlus(MINUTE) }),
    )

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'published',
      order: null,
      limit: null,
      actor: moderator,
    })

    expect(result.ok && result.value.items.map((item) => item.id)).toEqual(['photo-2'])
  })

  it('caps the page at the requested limit, keeping the oldest pending photos', async () => {
    seedThreePending()

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: 2,
      actor: moderator,
    })

    expect(result.ok && result.value.items.map((item) => item.id)).toEqual(['photo-1', 'photo-2'])
  })

  it('counts the badge over the whole event, not over the page the host is looking at', async () => {
    seedThreePending()

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: 1,
      actor: moderator,
    })

    expect(result.ok && result.value.pendingCount).toBe(3)
  })

  it('carries the caption badge, because a caption is read before it is projected', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending', caption: 'Les confettis' }),
    )

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: null,
      actor: moderator,
    })

    expect(result.ok && result.value.items.map((item) => item.hasCaption)).toEqual([true])
  })

  it('refuses a page size the console could not render', async () => {
    seedThreePending()

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: 0,
      actor: moderator,
    })

    expect(!result.ok && result.error.code).toBe('moderation.limitInvalid')
  })

  it('never shows a photo from another event', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending' }),
      aPhoto({ id: 'photo-2', eventId: 'event-2', status: 'pending' }),
    )

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: null,
      actor: moderator,
    })

    expect(result.ok && result.value.items.map((item) => item.id)).toEqual(['photo-1'])
  })

  it('never counts another event in the badge', async () => {
    photos.seed(aPhoto({ id: 'photo-2', eventId: 'event-2', status: 'pending' }))

    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: null,
      actor: moderator,
    })

    expect(result.ok && result.value.pendingCount).toBe(0)
  })

  it('refuses a guest actor', async () => {
    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: null,
      actor: guest,
    })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('refuses a signed-in user with no part in the event, as if it did not exist', async () => {
    const result = await getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: null,
      actor: { kind: 'host', userId: asUserId('user-99') },
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a queue for an event that does not exist', async () => {
    const result = await getModerationQueue({
      eventId: asEventId('event-404'),
      filter: 'pending',
      order: null,
      limit: null,
      actor: moderator,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
