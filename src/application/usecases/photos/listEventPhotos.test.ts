import { beforeEach, describe, expect, it } from 'vitest'
import type { PhotoPage } from '../../ports/photoRepository'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import { anEvent, aPhoto, atPlus } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeListEventPhotos, type ListEventPhotos } from './listEventPhotos'

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')

const pageOf = (result: Result<PhotoPage, DomainError>): PhotoPage => {
  if (!result.ok) throw new Error(`expected a page, got ${result.error.code}`)
  return result.value
}

const idsOf = (result: Result<PhotoPage, DomainError>): readonly string[] =>
  pageOf(result).items.map((photo) => photo.id)

describe('listEventPhotos', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let listEventPhotos: ListEventPhotos

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    events.seed(
      anEvent({ id: 'event-1' }),
      anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }),
    )
    listEventPhotos = makeListEventPhotos({ events, photos })
  })

  it('returns every status when no filter is given, newest first', async () => {
    photos.seed(
      aPhoto({ id: 'p1', status: 'pending', createdAt: atPlus(0) }),
      aPhoto({ id: 'p2', status: 'published', createdAt: atPlus(1_000) }),
      aPhoto({ id: 'p3', status: 'rejected', createdAt: atPlus(2_000) }),
    )

    const result = await listEventPhotos({ eventId: EVENT })

    expect(idsOf(result)).toEqual(['p3', 'p2', 'p1'])
  })

  it('returns only the statuses the moderation queue asked for', async () => {
    photos.seed(
      aPhoto({ id: 'p1', status: 'pending' }),
      aPhoto({ id: 'p2', status: 'published' }),
      aPhoto({ id: 'p3', status: 'rejected' }),
    )

    const result = await listEventPhotos({ eventId: EVENT, statuses: ['pending'] })

    expect(idsOf(result)).toEqual(['p1'])
  })

  it('caps the page at the requested limit and hands back a cursor for the rest', async () => {
    photos.seed(
      aPhoto({ id: 'p1', createdAt: atPlus(0) }),
      aPhoto({ id: 'p2', createdAt: atPlus(1_000) }),
      aPhoto({ id: 'p3', createdAt: atPlus(2_000) }),
    )

    const result = await listEventPhotos({ eventId: EVENT, limit: 2 })

    expect(idsOf(result)).toEqual(['p3', 'p2'])
    expect(pageOf(result).nextCursor).not.toBeNull()
  })

  it('resumes at the cursor instead of repeating a photo the host already saw', async () => {
    photos.seed(
      aPhoto({ id: 'p1', createdAt: atPlus(0) }),
      aPhoto({ id: 'p2', createdAt: atPlus(1_000) }),
      aPhoto({ id: 'p3', createdAt: atPlus(2_000) }),
    )
    const first = await listEventPhotos({ eventId: EVENT, limit: 2 })

    const second = await listEventPhotos({
      eventId: EVENT,
      limit: 2,
      cursor: pageOf(first).nextCursor,
    })

    expect(idsOf(second)).toEqual(['p1'])
  })

  it('never returns a photo that belongs to another event', async () => {
    photos.seed(
      aPhoto({ id: 'ours', eventId: 'event-1' }),
      aPhoto({ id: 'theirs', eventId: 'event-2' }),
    )

    const result = await listEventPhotos({ eventId: EVENT })

    expect(idsOf(result)).toEqual(['ours'])
  })

  it('does not reach another event photo through a status filter', async () => {
    photos.seed(aPhoto({ id: 'theirs', eventId: 'event-2', status: 'published' }))

    const result = await listEventPhotos({ eventId: EVENT, statuses: ['published'] })

    expect(idsOf(result)).toEqual([])
  })

  it('answers an empty page for an event with no photos yet', async () => {
    const result = await listEventPhotos({ eventId: EVENT })

    expect(pageOf(result)).toEqual({ items: [], nextCursor: null })
  })

  it('refuses to list an event that does not exist', async () => {
    const result = await listEventPhotos({ eventId: asEventId('event-404') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('treats an explicit absence of filters as no filter at all', async () => {
    photos.seed(aPhoto({ id: 'p1', eventId: 'event-1' }))

    const result = await listEventPhotos({
      eventId: EVENT,
      statuses: null,
      limit: null,
      cursor: null,
    })

    expect(idsOf(result)).toEqual(['p1'])
  })

  it('scopes the query to the event even when both events hold the same photo id', async () => {
    photos.seed(
      aPhoto({ id: 'shared', eventId: 'event-1' }),
      aPhoto({ id: 'shared', eventId: 'event-2' }),
    )

    const result = await listEventPhotos({ eventId: OTHER_EVENT })

    expect(pageOf(result).items.map((photo) => photo.eventId)).toEqual(['event-2'])
  })
})
