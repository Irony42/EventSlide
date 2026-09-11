import { beforeEach, describe, expect, it } from 'vitest'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import type { PhotoPage } from '../../ports/photoRepository'
import { anEvent, aPhoto, atPlus, type PhotoInput } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeListGuestPhotos, type ListGuestPhotos } from './listGuestPhotos'

const EVENT = asEventId('event-1')
const GUEST = asGuestId('guest-1')

const pageOf = (result: Result<PhotoPage, DomainError>): PhotoPage => {
  if (!result.ok) throw new Error(`expected a page, got ${result.error.code}`)
  return result.value
}

const idsOf = (result: Result<PhotoPage, DomainError>): readonly string[] =>
  pageOf(result).items.map((photo) => photo.id)

describe('listGuestPhotos', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let listGuestPhotos: ListGuestPhotos

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    events.seed(
      anEvent({ id: 'event-1' }),
      anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }),
    )
    listGuestPhotos = makeListGuestPhotos({ events, photos })
  })

  const seedForGuest = (id: string, guestId: string, overrides: PhotoInput = {}): void => {
    photos.seed(
      aPhoto({ id, eventId: 'event-1', author: { kind: 'guest', id: guestId }, ...overrides }),
    )
  }

  it('shows the guest their own photo whatever its status, moderation included', async () => {
    photos.seed(
      aPhoto({
        id: 'waiting',
        author: { kind: 'guest', id: 'guest-1' },
        status: 'pending',
        createdAt: atPlus(0),
      }),
      aPhoto({
        id: 'declined',
        author: { kind: 'guest', id: 'guest-1' },
        status: 'rejected',
        createdAt: atPlus(1_000),
      }),
      aPhoto({
        id: 'on-the-wall',
        author: { kind: 'guest', id: 'guest-1' },
        status: 'published',
        createdAt: atPlus(2_000),
      }),
    )

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual(['on-the-wall', 'declined', 'waiting'])
  })

  it('never shows one guest another guest photo', async () => {
    seedForGuest('mine', 'guest-1')
    seedForGuest('theirs', 'guest-2')

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual(['mine'])
  })

  it('never shows a guest a photo the host uploaded', async () => {
    photos.seed(aPhoto({ id: 'venue-camera', author: { kind: 'host', id: 'user-1' } }))

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual([])
  })

  it('does not reach the same guest id photos in another event', async () => {
    photos.seed(
      aPhoto({ id: 'elsewhere', eventId: 'event-2', author: { kind: 'guest', id: 'guest-1' } }),
    )

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual([])
  })

  it('pages a guest own photos with a cursor', async () => {
    seedForGuest('p1', 'guest-1', { createdAt: atPlus(0) })
    seedForGuest('p2', 'guest-1', { createdAt: atPlus(1_000) })

    const first = await listGuestPhotos({ eventId: EVENT, guestId: GUEST, limit: 1 })
    const second = await listGuestPhotos({
      eventId: EVENT,
      guestId: GUEST,
      limit: 1,
      cursor: pageOf(first).nextCursor,
    })

    expect(idsOf(first)).toEqual(['p2'])
    expect(idsOf(second)).toEqual(['p1'])
  })

  it('treats an explicit absence of paging as no paging at all', async () => {
    seedForGuest('mine', 'guest-1')

    const result = await listGuestPhotos({
      eventId: EVENT,
      guestId: GUEST,
      limit: null,
      cursor: null,
    })

    expect(idsOf(result)).toEqual(['mine'])
  })

  it('refuses to list an event that does not exist', async () => {
    const result = await listGuestPhotos({ eventId: asEventId('event-404'), guestId: GUEST })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
