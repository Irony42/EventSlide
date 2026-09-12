import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetTopPhotos, type GetTopPhotos } from './getTopPhotos'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { asEventId } from '../../../domain/shared/ids'
import { aPhoto, aReaction } from '../../testing/builders'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'

const EVENT = asEventId('event-1')

describe('getTopPhotos', () => {
  let photos: FakePhotoRepository
  let reactions: FakeReactionRepository
  let getTopPhotos: GetTopPhotos

  beforeEach(() => {
    photos = new FakePhotoRepository()
    reactions = new FakeReactionRepository()
    getTopPhotos = makeGetTopPhotos({ photos, reactions })
  })

  const seedTwoPublished = (): void => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }),
      aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published' }),
    )
  }

  const rank = (limit = 5): ReturnType<GetTopPhotos> => getTopPhotos({ eventId: EVENT, limit })

  it('ranks the most reacted-to photo first', async () => {
    seedTwoPublished()
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-2', guestId: 'guest-1' }),
      aReaction({ id: 'reaction-3', photoId: 'photo-2', guestId: 'guest-2' }),
    )

    const result = await rank()

    expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['photo-2', 'photo-1'])
  })

  it('breaks a tie by id, so two projectors never disagree about the winner', async () => {
    seedTwoPublished()
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-2', guestId: 'guest-1' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-1', guestId: 'guest-1' }),
    )

    const result = await rank()

    expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['photo-1', 'photo-2'])
  })

  it('carries the counts and the unweighted total for each ranked photo', async () => {
    seedTwoPublished()
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1', kind: 'love' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-1', guestId: 'guest-1', kind: 'clap' }),
    )

    const result = await rank()

    expect(result.ok && result.value[0]?.counts.love).toBe(1)
    expect(result.ok && result.value[0]?.total).toBe(2)
  })

  it('caps the panel at the requested limit', async () => {
    seedTwoPublished()
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-2', guestId: 'guest-1' }),
      aReaction({ id: 'reaction-3', photoId: 'photo-2', guestId: 'guest-2' }),
    )

    const result = await rank(1)

    expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['photo-2'])
  })

  it('leaves out a photo nobody reacted to, rather than ranking silence', async () => {
    seedTwoPublished()
    reactions.seed(aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1' }))

    const result = await rank()

    expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['photo-1'])
  })

  it.each(['hidden', 'rejected', 'pending'] as const)(
    'never crowns a %s photo, which would undo the host decision on screen',
    async (status: PhotoStatus) => {
      photos.seed(
        aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }),
        aPhoto({ id: 'photo-2', eventId: 'event-1', status }),
      )
      reactions.seed(
        aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1' }),
        aReaction({ id: 'reaction-2', photoId: 'photo-2', guestId: 'guest-1' }),
        aReaction({ id: 'reaction-3', photoId: 'photo-2', guestId: 'guest-2' }),
      )

      const result = await rank()

      expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['photo-1'])
    },
  )

  it('drops reactions whose photo is gone', async () => {
    reactions.seed(aReaction({ id: 'reaction-1', photoId: 'photo-9', guestId: 'guest-1' }))

    const result = await rank()

    expect(result.ok && result.value).toEqual([])
  })

  it('never ranks a photo another event holds', async () => {
    photos.seed(aPhoto({ id: 'photo-2', eventId: 'event-2', status: 'published' }))
    reactions.seed(
      aReaction({ id: 'reaction-1', eventId: 'event-2', photoId: 'photo-2', guestId: 'guest-1' }),
    )

    const result = await rank()

    expect(result.ok && result.value).toEqual([])
  })

  it('refuses a limit that would rank nothing', async () => {
    const result = await rank(0)

    expect(!result.ok && result.error.code).toBe('reaction.limitOutOfRange')
  })

  it('refuses a fractional limit', async () => {
    const result = await rank(1.5)

    expect(!result.ok && result.error.code).toBe('reaction.limitNotInteger')
  })
})
