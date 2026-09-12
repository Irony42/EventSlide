import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetPhotoReactions, type GetPhotoReactions } from './getPhotoReactions'
import { asEventId, asGuestId, asPhotoId } from '../../../domain/shared/ids'
import { aPhoto, aReaction } from '../../testing/builders'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')
const GUEST = asGuestId('guest-1')

describe('getPhotoReactions', () => {
  let photos: FakePhotoRepository
  let reactions: FakeReactionRepository
  let getPhotoReactions: GetPhotoReactions

  beforeEach(() => {
    photos = new FakePhotoRepository()
    reactions = new FakeReactionRepository()
    getPhotoReactions = makeGetPhotoReactions({ photos, reactions })

    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))
  })

  const forGuest = (): ReturnType<GetPhotoReactions> =>
    getPhotoReactions({ eventId: EVENT, photoId: PHOTO, guestId: GUEST })

  it('reports every kind at zero, so no client ever renders a missing key', async () => {
    const result = await getPhotoReactions({ eventId: EVENT, photoId: PHOTO, guestId: null })

    expect(result.ok && result.value.counts).toEqual({
      love: 0,
      laugh: 0,
      wow: 0,
      cheers: 0,
      clap: 0,
    })
  })

  it('counts one row per guest per kind', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1', kind: 'love' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-1', guestId: 'guest-2', kind: 'love' }),
      aReaction({ id: 'reaction-3', photoId: 'photo-1', guestId: 'guest-2', kind: 'clap' }),
    )

    const result = await getPhotoReactions({ eventId: EVENT, photoId: PHOTO, guestId: null })

    expect(result.ok && result.value.counts.love).toBe(2)
    expect(result.ok && result.value.counts.clap).toBe(1)
  })

  it('totals reactions unweighted, so the prettiest button does not win the night', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1', kind: 'love' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-1', guestId: 'guest-1', kind: 'clap' }),
    )

    const result = await getPhotoReactions({ eventId: EVENT, photoId: PHOTO, guestId: null })

    expect(result.ok && result.value.total).toBe(2)
  })

  it('lists the kinds this guest already sent, so their buttons show as pressed', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1', kind: 'love' }),
      aReaction({ id: 'reaction-2', photoId: 'photo-1', guestId: 'guest-1', kind: 'wow' }),
    )

    const result = await forGuest()

    expect(result.ok && result.value.mine).toEqual(['love', 'wow'])
  })

  it('never attributes another guest reaction to the caller', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-2', kind: 'love' }),
    )

    const result = await forGuest()

    expect(result.ok && result.value.mine).toEqual([])
  })

  it('scopes the caller kinds to this photo, not to everything they tapped tonight', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-2', guestId: 'guest-1', kind: 'love' }),
    )

    const result = await forGuest()

    expect(result.ok && result.value.mine).toEqual([])
  })

  it('reports no caller kinds at a projector, which has no guest identity', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-1', photoId: 'photo-1', guestId: 'guest-1', kind: 'love' }),
    )

    const result = await getPhotoReactions({ eventId: EVENT, photoId: PHOTO, guestId: null })

    expect(result.ok && result.value.mine).toEqual([])
  })

  it('cannot read the reactions of a photo that belongs to another event', async () => {
    photos = new FakePhotoRepository().seed(
      aPhoto({ id: 'photo-1', eventId: 'event-2', status: 'published' }),
    )
    getPhotoReactions = makeGetPhotoReactions({ photos, reactions })

    const result = await forGuest()

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('never counts a reaction another event holds for the same photo id', async () => {
    reactions.seed(
      aReaction({
        id: 'reaction-1',
        eventId: 'event-2',
        photoId: 'photo-1',
        guestId: 'guest-1',
        kind: 'love',
      }),
    )

    const result = await forGuest()

    expect(result.ok && result.value.counts.love).toBe(0)
  })
})
