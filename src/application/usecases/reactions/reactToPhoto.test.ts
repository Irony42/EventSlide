import { beforeEach, describe, expect, it } from 'vitest'
import { makeReactToPhoto, type ReactToPhoto } from './reactToPhoto'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { asEventId, asGuestId, asPhotoId } from '../../../domain/shared/ids'
import { anEvent, aPhoto, aReaction, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')
const GUEST = asGuestId('guest-1')

const MINUTE = 60_000

/** Generous enough that the budget is not what the other tests are about. */
const BUDGET = { windowMs: MINUTE, maxPerWindow: 10 }

describe('reactToPhoto', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let reactions: FakeReactionRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let ids: SequentialIdGenerator

  const useCase = (budget = BUDGET): ReactToPhoto =>
    makeReactToPhoto({ events, photos, reactions, bus, clock, ids, budget })

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    reactions = new FakeReactionRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    ids = new SequentialIdGenerator()

    events.seed(anEvent({ id: 'event-1' }))
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))
  })

  const react = (kind = 'love'): ReturnType<ReactToPhoto> =>
    useCase()({ eventId: EVENT, photoId: PHOTO, guestId: GUEST, kind })

  it('stores the reaction of a guest tapping a badge on the wall', async () => {
    const result = await react()

    expect(result.ok).toBe(true)
    const stored = await reactions.findOne(EVENT, PHOTO, GUEST, 'love')
    expect(stored?.kind).toBe('love')
  })

  it('announces the reaction so the badge floats up on every projector', async () => {
    await react()

    expect(bus.published).toEqual([
      { type: 'reaction.added', eventId: EVENT, photoId: PHOTO, kind: 'love' },
    ])
  })

  it('refuses a reaction when the host turned reactions off', async () => {
    events = new FakeEventRepository().seed(
      anEvent({ id: 'event-1', settings: { allowReactions: false } }),
    )

    const result = await react()

    expect(!result.ok && result.error.kind).toBe('forbidden')
    expect(!result.ok && result.error.code).toBe('event.reactionsDisabled')
  })

  it.each(['pending', 'rejected', 'hidden'] as const)(
    'refuses a reaction to a %s photo: you react to what is on the wall',
    async (status: PhotoStatus) => {
      photos = new FakePhotoRepository().seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status }))

      const result = await react()

      expect(!result.ok && result.error.kind).toBe('conflict')
      expect(!result.ok && result.error.code).toBe('reaction.notPublished')
    },
  )

  it('refuses a kind outside the closed set', async () => {
    const result = await react('rocket')

    expect(!result.ok && result.error.code).toBe('reaction.kindUnknown')
  })

  it('refuses a second reaction of the same kind from the same guest', async () => {
    reactions.seed(aReaction({ id: 'reaction-9', photoId: 'photo-1', guestId: 'guest-1' }))

    const result = await react('love')

    expect(!result.ok && result.error.kind).toBe('conflict')
    expect(!result.ok && result.error.code).toBe('reaction.alreadyExists')
  })

  it('allows a different kind on a photo the guest already reacted to', async () => {
    reactions.seed(aReaction({ id: 'reaction-9', photoId: 'photo-1', guestId: 'guest-1' }))

    const result = await react('clap')

    expect(result.ok).toBe(true)
  })

  it('slows a guest down once their budget for the window is spent', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-9', photoId: 'photo-2', guestId: 'guest-1', kind: 'clap' }),
    )

    const result = await useCase({ windowMs: MINUTE, maxPerWindow: 1 })({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(!result.ok && result.error.kind).toBe('rateLimited')
    expect(!result.ok && result.error.code).toBe('reaction.rateLimited')
  })

  it('does not count a reaction that has fallen out of the window', async () => {
    reactions.seed(
      aReaction({
        id: 'reaction-9',
        photoId: 'photo-2',
        guestId: 'guest-1',
        kind: 'clap',
        createdAt: atPlus(-2 * MINUTE),
      }),
    )

    const result = await useCase({ windowMs: MINUTE, maxPerWindow: 1 })({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(result.ok).toBe(true)
  })

  it('does not spend another guest budget', async () => {
    reactions.seed(
      aReaction({ id: 'reaction-9', photoId: 'photo-2', guestId: 'guest-2', kind: 'clap' }),
    )

    const result = await useCase({ windowMs: MINUTE, maxPerWindow: 1 })({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(result.ok).toBe(true)
  })

  it('refuses rather than letting a flood through when the budget is misconfigured', async () => {
    const result = await useCase({ windowMs: MINUTE, maxPerWindow: 0 })({
      eventId: EVENT,
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(!result.ok && result.error.code).toBe('reaction.maxPerWindowInvalid')
  })

  it('cannot react to a photo that belongs to another event', async () => {
    photos = new FakePhotoRepository().seed(
      aPhoto({ id: 'photo-1', eventId: 'event-2', status: 'published' }),
    )

    const result = await react()

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('announces nothing when the photo belongs to another event', async () => {
    photos = new FakePhotoRepository().seed(
      aPhoto({ id: 'photo-1', eventId: 'event-2', status: 'published' }),
    )

    await react()

    expect(bus.published).toEqual([])
  })

  it('refuses a reaction for an event that does not exist', async () => {
    const result = await useCase()({
      eventId: asEventId('event-404'),
      photoId: PHOTO,
      guestId: GUEST,
      kind: 'love',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
