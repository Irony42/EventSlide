import { beforeEach, describe, expect, it } from 'vitest'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import { anEvent, aPhoto, type EventInput, type PhotoInput } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeSetPhotoCaption, type SetPhotoCaption } from './setPhotoCaption'

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')

const HOST: PhotoActor = { kind: 'host', userId: asUserId('user-1') }
const AUTHOR: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-1') }
const ANOTHER_GUEST: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-2') }

/** The default window from `EventSettings`: fifteen minutes. */
const GRACE_MS = 900_000

describe('setPhotoCaption', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let setPhotoCaption: SetPhotoCaption

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    setPhotoCaption = makeSetPhotoCaption({ events, photos, bus, clock })
  })

  const seedEvent = (input: EventInput = {}): void => {
    events.seed(anEvent({ id: 'event-1', ...input }))
  }

  const seedPhoto = (input: PhotoInput = {}): void => {
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        author: { kind: 'guest', id: 'guest-1' },
        ...input,
      }),
    )
  }

  const captionOf = async (): Promise<string | null> =>
    (await photos.findById(EVENT, PHOTO))?.caption?.value ?? null

  it('lets a host caption a photo that is already on the wall, and announces it', async () => {
    seedEvent()
    seedPhoto({ status: 'published' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: HOST,
      caption: 'Le discours du témoin',
    })

    expect(result.ok).toBe(true)
    expect(await captionOf()).toBe('Le discours du témoin')
    expect(bus.published).toEqual([
      { type: 'photo.captionChanged', eventId: EVENT, photoId: PHOTO },
    ])
  })

  it('lets the author caption their own pending photo inside the grace window', async () => {
    seedEvent()
    seedPhoto({ status: 'pending' })
    clock.advance(GRACE_MS - 1)

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: AUTHOR,
      caption: 'Nous deux',
    })

    expect(result.ok).toBe(true)
    expect(await captionOf()).toBe('Nous deux')
  })

  it('normalises what the guest typed before it reaches the wall', async () => {
    seedEvent()
    seedPhoto({ status: 'pending' })

    await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: AUTHOR,
      caption: '   Nous    deux   ',
    })

    expect(await captionOf()).toBe('Nous deux')
  })

  it('refuses the author once the photo is on the wall', async () => {
    seedEvent()
    seedPhoto({ status: 'published' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: AUTHOR,
      caption: 'Nous deux',
    })

    expect(!result.ok && result.error.code).toBe('photo.captionEditForbidden')
    expect(await captionOf()).toBeNull()
  })

  it('refuses the author once the grace window has passed', async () => {
    seedEvent()
    seedPhoto({ status: 'pending' })
    clock.advance(GRACE_MS + 1)

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: AUTHOR,
      caption: 'Nous deux',
    })

    expect(!result.ok && result.error.code).toBe('photo.captionEditForbidden')
  })

  it('refuses a guest who did not send the photo', async () => {
    seedEvent()
    seedPhoto({ status: 'pending' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: ANOTHER_GUEST,
      caption: 'Nous deux',
    })

    expect(!result.ok && result.error.code).toBe('photo.captionEditForbidden')
  })

  it('cannot caption a photo that belongs to another event', async () => {
    seedEvent()
    seedPhoto({ eventId: 'event-2' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: HOST,
      caption: 'Nous deux',
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
    expect(bus.published).toEqual([])
  })

  it('clears a caption when the new one is empty', async () => {
    seedEvent()
    seedPhoto({ status: 'published', caption: 'À refaire' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: HOST,
      caption: null,
    })

    expect(result.ok).toBe(true)
    expect(await captionOf()).toBeNull()
  })

  it('clears a caption even on an event that no longer accepts captions', async () => {
    seedEvent({ settings: { allowCaptions: false } })
    seedPhoto({ status: 'published', caption: 'À refaire' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: HOST,
      caption: '   ',
    })

    expect(result.ok).toBe(true)
    expect(await captionOf()).toBeNull()
  })

  it('refuses a new caption on an event that does not accept captions', async () => {
    seedEvent({ settings: { allowCaptions: false } })
    seedPhoto({ status: 'published' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: HOST,
      caption: 'Nous deux',
    })

    expect(!result.ok && result.error.code).toBe('event.captionsNotAllowed')
  })

  it('refuses a caption longer than the wall can display', async () => {
    seedEvent()
    seedPhoto({ status: 'published' })

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: HOST,
      caption: 'a'.repeat(141),
    })

    expect(!result.ok && result.error.code).toBe('caption.tooLong')
    expect(bus.published).toEqual([])
  })

  it('refuses a photo id that does not exist in the event', async () => {
    seedEvent()

    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: asPhotoId('photo-404'),
      actor: HOST,
      caption: 'Nous deux',
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('refuses a caption change against an event that does not exist', async () => {
    const result = await setPhotoCaption({
      eventId: EVENT,
      photoId: PHOTO,
      actor: HOST,
      caption: 'Nous deux',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
