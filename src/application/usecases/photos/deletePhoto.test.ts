import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { PhotoActor } from '../../../domain/photos/photo'
import { asEventId, asGuestId, asPhotoId, asUserId, type EventId } from '../../../domain/shared/ids'
import {
  MEDIA_VARIANTS,
  type MediaMetadata,
  type MediaStore,
  type MediaVariant,
} from '../../ports/mediaStore'
import { anEvent, aPhoto, type EventInput, type PhotoInput } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeDeletePhoto, type DeletePhoto } from './deletePhoto'

/** Byte buffers keyed by `(eventId, hash, variant)`, as the filesystem store is. */
class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

  variantsOf(eventId: EventId, hash: ContentHash): readonly MediaVariant[] {
    return MEDIA_VARIANTS.filter((variant) => this.objects.has(this.key(eventId, hash, variant)))
  }

  private key(eventId: EventId, hash: ContentHash, variant: MediaVariant): string {
    return `${eventId}|${hash.value}|${variant}`
  }

  async put(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
    bytes: Uint8Array,
  ): Promise<void> {
    this.objects.set(this.key(eventId, hash, variant), bytes)
  }

  async exists(eventId: EventId, hash: ContentHash, variant: MediaVariant): Promise<boolean> {
    return this.objects.has(this.key(eventId, hash, variant))
  }

  async stat(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<MediaMetadata | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    return bytes === undefined ? null : { byteSize: bytes.length, contentType: 'image/jpeg' }
  }

  async openRead(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const bytes = this.objects.get(this.key(eventId, hash, variant))
    if (bytes === undefined) return null
    return (async function* () {
      yield bytes
    })()
  }

  async read(
    eventId: EventId,
    hash: ContentHash,
    variant: MediaVariant,
  ): Promise<Uint8Array | null> {
    return this.objects.get(this.key(eventId, hash, variant)) ?? null
  }

  async delete(eventId: EventId, hash: ContentHash): Promise<void> {
    for (const variant of MEDIA_VARIANTS) this.objects.delete(this.key(eventId, hash, variant))
  }

  async deleteEvent(eventId: EventId): Promise<void> {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(`${eventId}|`)) this.objects.delete(key)
    }
  }

  async usedBytes(eventId: EventId): Promise<number> {
    let total = 0
    for (const [key, bytes] of this.objects) {
      if (key.startsWith(`${eventId}|`)) total += bytes.length
    }
    return total
  }
}

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

  it('removes the files as well as the row, so nothing is left on the disk', async () => {
    seedEvent()
    const hash = await seedPhoto({ status: 'pending' })

    await deletePhoto({ eventId: EVENT, photoId: PHOTO, actor: HOST })

    expect(await media.usedBytes(EVENT)).toBe(0)
    expect(media.variantsOf(EVENT, hash)).toEqual([])
  })
})
