import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeGetModerationQueue, type GetModerationQueue } from './getModerationQueue'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asUserId } from '../../../domain/shared/ids'
import { anEvent, aGuest, aPhoto, atPlus, AT } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
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
  let guests: FakeGuestRepository
  let memberships: FakeMembershipRepository
  let getModerationQueue: GetModerationQueue

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    guests = new FakeGuestRepository()
    memberships = new FakeMembershipRepository()
    getModerationQueue = makeGetModerationQueue({ events, photos, guests, memberships })

    events.seed(anEvent({ id: 'event-1' }))
    memberships.seed({ eventId: EVENT, userId: MODERATOR, role: 'moderator', grantedAt: AT })
  })

  /** The whole queue for the pending tab, with the domain's own default order. */
  const pendingQueue = () =>
    getModerationQueue({
      eventId: EVENT,
      filter: 'pending',
      order: null,
      limit: null,
      actor: moderator,
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

  // ------------------------------------------------------- what the card renders --

  it('carries the caption text, because a badge is not something a host can read', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending', caption: 'Les confettis' }),
    )

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => item.caption)).toEqual(['Les confettis'])
  })

  it('leaves the caption null when the guest attached none', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending', caption: null }))

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => item.caption)).toEqual([null])
  })

  it('carries the photo dimensions, so the grid is laid out before the thumbnails arrive', async () => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'pending', width: 2560, height: 1707 }),
    )

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => [item.width, item.height])).toEqual([
      [2560, 1707],
    ])
  })

  it('names the guest who sent the photo', async () => {
    guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'pending',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
    )

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => item.authorName)).toEqual(['Léa'])
  })

  it('leaves the name null for a guest who stayed anonymous, instead of inventing one', async () => {
    // "Invité anonyme" is French UI copy. It belongs to the client, which is free to
    // word it differently on the console and on the wall.
    guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: null }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'pending',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
    )

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => item.authorName)).toEqual([null])
  })

  it('leaves the name null for a photo the host uploaded themselves', async () => {
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'pending',
        author: { kind: 'host', id: 'user-2' },
      }),
    )

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => item.authorName)).toEqual([null])
  })

  it('never names a guest of another event, even when the photo names their id', async () => {
    // The name read is scoped by event like every other read. A guest row that belongs
    // to another party must not surface on this host's console.
    guests.seed(aGuest({ id: 'guest-sam', eventId: 'event-2', displayName: 'Sam' }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'pending',
        author: { kind: 'guest', id: 'guest-sam' },
      }),
    )

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => item.authorName)).toEqual([null])
  })

  it('reads every sender in one batched call, never one per photo', async () => {
    // The console refetches on every arriving photo, all evening. A `findById` per row
    // would be an N+1 on the laptop with the least time to spare — so the property is
    // asserted, not left to a comment. The spy wraps the real fake and changes nothing.
    guests.seed(
      aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }),
      aGuest({ id: 'guest-nils', eventId: 'event-1', displayName: 'Nils' }),
    )
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'pending',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
      aPhoto({
        id: 'photo-2',
        eventId: 'event-1',
        status: 'pending',
        createdAt: atPlus(MINUTE),
        author: { kind: 'guest', id: 'guest-lea' },
      }),
      aPhoto({
        id: 'photo-3',
        eventId: 'event-1',
        status: 'pending',
        createdAt: atPlus(2 * MINUTE),
        author: { kind: 'guest', id: 'guest-nils' },
      }),
    )
    const lookup = vi.spyOn(guests, 'findNamesByIds')

    const result = await pendingQueue()

    expect(result.ok && result.value.items.map((item) => item.authorName)).toEqual([
      'Léa',
      'Léa',
      'Nils',
    ])
    expect(lookup).toHaveBeenCalledTimes(1)
    const call = lookup.mock.calls[0]
    expect(call?.[0]).toBe(EVENT)
    // Distinct senders, not one entry per photo: a queue is many photos by few guests.
    expect([...(call?.[1] ?? [])].sort()).toEqual(['guest-lea', 'guest-nils'])
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
