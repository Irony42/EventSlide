import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetTopPhotos, type GetTopPhotos } from './getTopPhotos'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { asEventId } from '../../../domain/shared/ids'
import { AT, anEvent, aPhoto, aReaction } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'

const EVENT = asEventId('event-1')

describe('getTopPhotos', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let reactions: FakeReactionRepository
  let getTopPhotos: GetTopPhotos

  beforeEach(() => {
    events = new FakeEventRepository().seed(anEvent({ id: 'event-1', slug: 'event-1' }))
    photos = new FakePhotoRepository()
    reactions = new FakeReactionRepository()
    getTopPhotos = makeGetTopPhotos({ events, photos, reactions })
  })

  const seedTwoPublished = (): void => {
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }),
      aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published' }),
    )
  }

  const rank = (limit = 5): ReturnType<GetTopPhotos> => getTopPhotos({ eventId: EVENT, limit })

  it('reads nothing of an event that is not there, is taken down, or whose client is suspended', async () => {
    seedTwoPublished()
    reactions.seed(aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1' }))

    const unknown = await getTopPhotos({ eventId: asEventId('ghost'), limit: 5 })
    await events.setTakenDown(EVENT, AT)
    const down = await rank()
    await events.setTakenDown(EVENT, null)
    const frozen = await makeGetTopPhotos({
      events: new FakeEventRepository().seed(
        anEvent({ id: 'event-1', slug: 'event-1', clientSuspendedAt: AT }),
      ),
      photos,
      reactions,
    })({ eventId: EVENT, limit: 5 })

    expect(!unknown.ok && unknown.error.code).toBe('event.notFound')
    expect(!down.ok && down.error.code).toBe('event.notFound')
    expect(!frozen.ok && frozen.error.code).toBe('client.suspended')
  })

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

  // ----------------------------------------------- the limit counts what is shown --

  /**
   * The limit used to cut the ranking and the wall's filter ran afterwards, so a photo taken
   * off the wall that kept its reactions used up a slot and was then removed: a panel asked for
   * one photo answered none while a published photo had a reaction.
   */
  it.each(['hidden', 'rejected', 'pending'] as const)(
    'gives the slot of a %s photo to the next photo on the wall',
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

      const result = await rank(1)

      expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['photo-1'])
    },
  )

  it('fills the whole panel with photos on the wall however many ranked above them were not', async () => {
    photos.seed(
      aPhoto({ id: 'gone-1', eventId: 'event-1', status: 'rejected' }),
      aPhoto({ id: 'gone-2', eventId: 'event-1', status: 'hidden' }),
      aPhoto({ id: 'gone-3', eventId: 'event-1', status: 'rejected' }),
      aPhoto({ id: 'shown-1', eventId: 'event-1', status: 'published' }),
      aPhoto({ id: 'shown-2', eventId: 'event-1', status: 'published' }),
      aPhoto({ id: 'shown-3', eventId: 'event-1', status: 'published' }),
    )
    reactions.seed(
      aReaction({ id: 'r1', photoId: 'gone-1', guestId: 'guest-1' }),
      aReaction({ id: 'r2', photoId: 'gone-1', guestId: 'guest-2' }),
      aReaction({ id: 'r3', photoId: 'gone-1', guestId: 'guest-3' }),
      aReaction({ id: 'r4', photoId: 'gone-2', guestId: 'guest-1' }),
      aReaction({ id: 'r5', photoId: 'gone-2', guestId: 'guest-2' }),
      aReaction({ id: 'r6', photoId: 'gone-3', guestId: 'guest-1' }),
      aReaction({ id: 'r7', photoId: 'gone-3', guestId: 'guest-2' }),
      aReaction({ id: 'r8', photoId: 'shown-3', guestId: 'guest-1' }),
      aReaction({ id: 'r9', photoId: 'shown-3', guestId: 'guest-2' }),
      aReaction({ id: 'r10', photoId: 'shown-1', guestId: 'guest-1' }),
    )

    const result = await rank(2)

    expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['shown-3', 'shown-1'])
  })

  it('answers fewer photos than it was asked for when fewer are on the wall', async () => {
    photos.seed(
      aPhoto({ id: 'gone', eventId: 'event-1', status: 'rejected' }),
      aPhoto({ id: 'shown', eventId: 'event-1', status: 'published' }),
    )
    reactions.seed(
      aReaction({ id: 'r1', photoId: 'gone', guestId: 'guest-1' }),
      aReaction({ id: 'r2', photoId: 'shown', guestId: 'guest-1' }),
    )

    const result = await rank(5)

    expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['shown'])
  })

  it('does not read a photo it does not need, once the panel is full', async () => {
    seedTwoPublished()
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-1', guestId: 'guest-2' }),
      aReaction({ id: 'reaction-3', photoId: 'photo-2', guestId: 'guest-1' }),
    )
    const read: string[] = []
    const findById = photos.findById.bind(photos)
    photos.findById = async (eventId, photoId) => {
      read.push(photoId)
      return findById(eventId, photoId)
    }

    await rank(1)

    expect(read).toEqual(['photo-1'])
  })

  it('skips a reacted photo that is gone and still fills the panel from the ones behind it', async () => {
    seedTwoPublished()
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-9', guestId: 'guest-1' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-9', guestId: 'guest-2' }),
      aReaction({ id: 'reaction-3', photoId: 'photo-1', guestId: 'guest-1' }),
    )

    const result = await rank(1)

    expect(result.ok && result.value.map((entry) => entry.photo.id)).toEqual(['photo-1'])
  })

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
