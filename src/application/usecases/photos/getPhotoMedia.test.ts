import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import { PHOTO_STATUSES } from '../../../domain/photos/photoStatus'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId, asPhotoId, asUserId, type EventId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import {
  MEDIA_VARIANTS,
  type MediaMetadata,
  type MediaStore,
  type MediaVariant,
} from '../../ports/mediaStore'
import { aPhoto, type PhotoInput } from '../../testing/builders'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import {
  makeGetPhotoMedia,
  type GetPhotoMedia,
  type MediaViewer,
  type PhotoMedia,
} from './getPhotoMedia'

class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

  /** Keys whose size is still known but whose bytes have gone. */
  private readonly unreadable = new Set<string>()

  /**
   * Models the retention purge deleting a file between the size check and the open —
   * the one window in which a media read can fail after it has already succeeded.
   */
  vanishAfterStat(eventId: EventId, hash: ContentHash): this {
    for (const variant of MEDIA_VARIANTS) this.unreadable.add(this.key(eventId, hash, variant))
    return this
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
    const key = this.key(eventId, hash, variant)
    const bytes = this.objects.get(key)
    if (bytes === undefined || this.unreadable.has(key)) return null
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
const OTHER_EVENT = asEventId('event-2')
const PHOTO = asPhotoId('photo-1')

const WALL: MediaViewer = { kind: 'public' }
const AUTHOR: MediaViewer = { kind: 'guest', guestId: asGuestId('guest-1') }
const ANOTHER_GUEST: MediaViewer = { kind: 'guest', guestId: asGuestId('guest-2') }
const MODERATOR: MediaViewer = { kind: 'moderator', userId: asUserId('user-1') }

const bytesOf = async (result: Result<PhotoMedia, DomainError>): Promise<number> => {
  if (!result.ok) throw new Error(`expected media, got ${result.error.code}`)
  let total = 0
  for await (const chunk of result.value.bytes) total += chunk.length
  return total
}

describe('getPhotoMedia', () => {
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let getPhotoMedia: GetPhotoMedia

  beforeEach(() => {
    photos = new FakePhotoRepository()
    media = new InMemoryMediaStore()
    getPhotoMedia = makeGetPhotoMedia({ photos, media })
  })

  /** A photo with all three files present, which is what ingest guarantees. */
  const seedPhoto = async (input: PhotoInput = {}): Promise<ContentHash> => {
    const photo = aPhoto({
      id: 'photo-1',
      eventId: 'event-1',
      author: { kind: 'guest', id: 'guest-1' },
      ...input,
    })
    photos.seed(photo)
    for (const variant of MEDIA_VARIANTS) {
      await media.put(photo.eventId, photo.contentHash, variant, Uint8Array.of(1, 2, 3))
    }
    return photo.contentHash
  }

  // ------------------------------------------------------------------- the wall --

  it.each(['display', 'thumb'] as const)(
    'serves the %s variant of a published photo to anyone holding the wall URL',
    async (variant) => {
      await seedPhoto({ status: 'published' })

      const result = await getPhotoMedia({
        eventId: EVENT,
        photoId: PHOTO,
        variant,
        viewer: WALL,
      })

      expect(result.ok && result.value.variant).toBe(variant)
    },
  )

  it('does not serve the rendered original to the wall', async () => {
    await seedPhoto({ status: 'published' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'original',
      viewer: WALL,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it.each(['pending', 'rejected', 'hidden'] as const)(
    'does not serve a %s photo to the wall',
    async (status) => {
      await seedPhoto({ status })

      const result = await getPhotoMedia({
        eventId: EVENT,
        photoId: PHOTO,
        variant: 'display',
        viewer: WALL,
      })

      expect(!result.ok && result.error.code).toBe('photo.notFound')
    },
  )

  // ------------------------------------------------------------------ the guest --

  it('serves a guest their own photo while it is still awaiting moderation', async () => {
    await seedPhoto({ status: 'pending' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: AUTHOR,
    })

    expect(result.ok).toBe(true)
  })

  it('does not serve a guest another guest pending photo', async () => {
    await seedPhoto({ status: 'pending' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: ANOTHER_GUEST,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('does not serve a guest the original of even their own photo', async () => {
    await seedPhoto({ status: 'pending' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'original',
      viewer: AUTHOR,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('serves a guest a published photo they did not send, as the wall does', async () => {
    await seedPhoto({ status: 'published' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'thumb',
      viewer: ANOTHER_GUEST,
    })

    expect(result.ok).toBe(true)
  })

  it('does not serve a guest a photo a host uploaded and has not published', async () => {
    await seedPhoto({ status: 'pending', author: { kind: 'host', id: 'user-1' } })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: AUTHOR,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  // -------------------------------------------------------------- the moderator --

  it.each(MEDIA_VARIANTS)('serves the %s variant to a moderator of the event', async (variant) => {
    await seedPhoto({ status: 'pending' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant,
      viewer: MODERATOR,
    })

    expect(result.ok && result.value.variant).toBe(variant)
  })

  it.each(PHOTO_STATUSES)('serves a %s photo to a moderator of the event', async (status) => {
    await seedPhoto({ status })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'original',
      viewer: MODERATOR,
    })

    expect(result.ok).toBe(true)
  })

  // ------------------------------------------------------------------- scoping --

  it('cannot read a photo through another event, even as a moderator', async () => {
    await seedPhoto({ eventId: 'event-2', status: 'published' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: MODERATOR,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  it('answers a photo outside the caller scope as notFound, never as forbidden', async () => {
    await seedPhoto({ status: 'pending' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: ANOTHER_GUEST,
    })

    expect(!result.ok && result.error.kind).toBe('notFound')
  })

  it('reads the photo of the event it was asked for when both events hold the id', async () => {
    await seedPhoto({ status: 'published' })
    const theirs = await seedPhoto({
      eventId: 'event-2',
      status: 'published',
      contentHash: 'b'.repeat(64),
    })

    const result = await getPhotoMedia({
      eventId: OTHER_EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: WALL,
    })

    expect(result.ok && result.value.contentHash.value).toBe(theirs.value)
  })

  it('refuses a photo id that does not exist in the event', async () => {
    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: asPhotoId('photo-404'),
      variant: 'display',
      viewer: MODERATOR,
    })

    expect(!result.ok && result.error.code).toBe('photo.notFound')
  })

  // -------------------------------------------------------------------- the file --

  it('hands back the size, the content type, the hash and a readable stream', async () => {
    const hash = await seedPhoto({ status: 'published' })

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: WALL,
    })

    expect(result.ok && result.value.byteSize).toBe(3)
    expect(result.ok && result.value.contentType).toBe('image/jpeg')
    expect(result.ok && result.value.contentHash.value).toBe(hash.value)
    expect(await bytesOf(result)).toBe(3)
  })

  it('reports a row whose file was never written as a missing file, not as a missing photo', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: WALL,
    })

    expect(!result.ok && result.error.code).toBe('photo.mediaMissing')
  })

  it('reports a file that disappeared between the size check and the open as missing', async () => {
    const hash = await seedPhoto({ status: 'published' })
    media.vanishAfterStat(EVENT, hash)

    const result = await getPhotoMedia({
      eventId: EVENT,
      photoId: PHOTO,
      variant: 'display',
      viewer: WALL,
    })

    expect(!result.ok && result.error.code).toBe('photo.mediaMissing')
  })
})
