import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asPhotoId, asUserId} from '../../../domain/shared/ids'
import { MEDIA_VARIANTS } from '../../ports/mediaStore'
import { anEvent, aClip, aPhoto, type EventInput, type PhotoInput } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeDeletePhoto, type DeletePhoto } from './deletePhoto'

/**
 * The shared in-memory store, not a local one.
 *
 * This file used to carry its own, and it deleted only the three photo renditions — so a
 * clip's poster survived `delete` in the double while the filesystem adapter removed it,
 * and the test that should have caught the production leak could not have. A fake that
 * differs from the adapter on the operation under test is worse than no fake.
 */

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')

const HOST: PhotoActor = { kind: 'host', userId: asUserId('user-1') }
const AUTHOR: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-1') }
const ANOTHER_GUEST: PhotoActor = { kind: 'guest', guestId: asGuestId('guest-2') }

/** The default window from `EventSettings`: fifteen minutes. */
const GRACE_MS = 900_000

describe('deletePhoto', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let bus: RecordingEventBus
  let clock: FakeClock
  let deletePhoto: DeletePhoto

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    media = new InMemoryMediaStore()
    bus = new RecordingEventBus()
    clock = new FakeClock()
    deletePhoto = makeDeletePhoto({ events, photos, media, bus, clock })
  })

  const seedEvent = (input: EventInput = {}): void => {
    events.seed(anEvent({ id: 'event-1', ...input }))
  }

  /** A photo plus its three files, so a test can prove both are gone. */
  const seedPhoto = async (input: PhotoInput = {}): Promise<ContentHash> => {
    const photo = aPhoto({ id: 'photo-1', eventId: 'event-1', ...input })
    photos.seed(photo)
    for (const variant of MEDIA_VARIANTS) {
      await media.put(photo.eventId, photo.contentHash, variant, Uint8Array.of(1))
    }
    return photo.contentHash
  }

  it('lets a host delete a photo at any time, and announces it', async () => {
    seedEvent()
    const hash = await seedPhoto({ status: 'published' })
    clock.advance(GRACE_MS * 10)

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: HOST })

    expect(result.ok).toBe(true)
    expect(await photos.findById(EVENT, PHOTO)).toBeNull()
    expect(media.variantsOf(EVENT, hash)).toEqual([])
    expect(bus.published).toEqual([{ type: 'photo.deleted', eventId: EVENT, photoId: PHOTO }])
  })

  it('lets the author take back their own pending photo inside the grace window', async () => {
    seedEvent()
    await seedPhoto({ status: 'pending', author: { kind: 'guest', id: 'guest-1' } })
    clock.advance(GRACE_MS - 1)

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: AUTHOR })

    expect(result.ok).toBe(true)
    expect(await photos.findById(EVENT, PHOTO)).toBeNull()
  })

  it('refuses the author once the photo is on the wall', async () => {
    seedEvent()
    await seedPhoto({ status: 'published', author: { kind: 'guest', id: 'guest-1' } })

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: AUTHOR })

    expect(!result.ok && result.error.code).toBe('photo.deleteForbidden')
    expect(await photos.findById(EVENT, PHOTO)).not.toBeNull()
  })

  it('refuses the author once the grace window has passed', async () => {
    seedEvent()
    await seedPhoto({ status: 'pending', author: { kind: 'guest', id: 'guest-1' } })
    clock.advance(GRACE_MS + 1)

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: AUTHOR })

    expect(!result.ok && result.error.code).toBe('photo.deleteForbidden')
  })

  it('refuses a guest who did not send the photo', async () => {
    seedEvent()
    await seedPhoto({ status: 'pending', author: { kind: 'guest', id: 'guest-1' } })

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: ANOTHER_GUEST })

    expect(!result.ok && result.error.code).toBe('photo.deleteForbidden')
  })

  it('cannot delete a photo that belongs to another event', async () => {
    seedEvent()
    events.seed(anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }))
    const hash = await seedPhoto({ eventId: 'event-2' })

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: HOST })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
    expect(media.variantsOf(asEventId('event-2'), hash)).toEqual([
      'original',
      'display',
      'thumb',
    ])
  })

  it('refuses a guest when the event has guest self-deletion switched off', async () => {
    seedEvent({ settings: { allowGuestSelfDelete: false } })
    await seedPhoto({ status: 'pending', author: { kind: 'guest', id: 'guest-1' } })

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: AUTHOR })

    expect(!result.ok && result.error.code).toBe('event.guestSelfDeleteDisabled')
  })

  it('still lets the host delete when guest self-deletion is switched off', async () => {
    seedEvent({ settings: { allowGuestSelfDelete: false } })
    await seedPhoto({ status: 'pending' })

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: HOST })

    expect(result.ok).toBe(true)
  })

  it('lets the author take back a rejected photo, which never reached the wall', async () => {
    seedEvent()
    await seedPhoto({ status: 'rejected', author: { kind: 'guest', id: 'guest-1' } })

    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: AUTHOR })

    expect(result.ok).toBe(true)
  })

  it('refuses a photo id that does not exist in the event', async () => {
    seedEvent()

    const result = await deletePhoto({
      eventId: EVENT,
      photoId: asPhotoId('photo-404'),
      actor: HOST,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('refuses a delete against an event that does not exist', async () => {
    const result = await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: HOST })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('announces nothing when the deletion is refused', async () => {
    seedEvent()
    await seedPhoto({ status: 'published', author: { kind: 'guest', id: 'guest-1' } })

    await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: AUTHOR })

    expect(bus.published).toEqual([])
  })

  it('removes both of a clip’s files, not only the one the row is named after', async () => {
    // A clip owns two digests — the mp4 under its own and the poster under a second —
    // and deleting `contentHash` alone left the poster on the disk on every guest
    // self-delete and every host delete. `Photo.storageHashes` exists for exactly this.
    seedEvent()
    const clip = aClip({ id: 'photo-1', eventId: 'event-1', status: 'pending' })
    photos.seed(clip)
    const facet = clip.facet
    expect(facet.kind).toBe('clip')
    if (facet.kind !== 'clip') return
    await media.put(clip.eventId, clip.contentHash, 'video', Uint8Array.of(1, 2, 3))
    await media.put(clip.eventId, facet.posterHash, 'poster', Uint8Array.of(4))

    await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: HOST })

    expect(await media.usedBytes(EVENT)).toBe(0)
    expect(await media.exists(EVENT, facet.posterHash, 'poster')).toBe(false)
  })

  it('removes the files as well as the row, so nothing is left on the disk', async () => {
    seedEvent()
    const hash = await seedPhoto({ status: 'pending' })

    await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: HOST })

    expect(await media.usedBytes(EVENT)).toBe(0)
    expect(media.variantsOf(EVENT, hash)).toEqual([])
  })
})
