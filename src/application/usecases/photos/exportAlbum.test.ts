import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, type EventId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'
import {
  MEDIA_VARIANTS,
  type MediaMetadata,
  type MediaStore,
  type MediaVariant,
  type StoredObject,
  type PhotoVariant,
} from '../../ports/mediaStore'
import { aClip, anEvent, aPhoto, atPlus, type PhotoInput } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { CapturingLogger } from '../../testing/galleryWorld'
import { makeExportAlbum, type ExportAlbum } from './exportAlbum'

/** One byte per unit of length, so a test can tell the variants apart by size. */
const BYTES_PER_VARIANT: Readonly<Record<PhotoVariant, number>> = {
  original: 9,
  display: 3,
  thumb: 1,
}

class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

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
    return bytes === undefined ? null : {
            byteSize: bytes.length,
            contentType: 'image/jpeg',
            // Not a fact any of these tests depends on; the sweep is the only reader.
            modifiedAt: new Date(0),
          }
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

  // Reconciliation only. A use case that started enumerating the store would fail
  // loudly here rather than pass against a permissive stub.
  async listEvents(): Promise<readonly EventId[]> {
    throw new Error(`listEvents is not part of an album export`)
  }

  async list(): Promise<readonly StoredObject[]> {
    throw new Error(`list is not part of an album export`)
  }

  async usedBytes(eventId: EventId): Promise<number> {
    let total = 0
    for (const [key, bytes] of this.objects) {
      if (key.startsWith(`${eventId}|`)) total += bytes.length
    }
    return total
  }
}

/** A clip's two files. Distinct sizes, so a test can tell the transcode from the poster by length. */
const BYTES_PER_CLIP_FILE = { video: 20, poster: 2 } as const

interface RecordedEntry {
  readonly name: string
  readonly modifiedAt: Date
  /** Bytes actually pulled from the store, so a test can prove which variant it got. */
  readonly bytesRead: number
}

/**
 * Records what it was asked to archive and emits one chunk per entry, so a test can
 * assert on the album's contents without a real ZIP.
 */
class FakeArchiveWriter implements ArchiveWriter {
  readonly entries: RecordedEntry[] = []

  stream(entries: AsyncIterable<ArchiveEntry>): AsyncIterable<Uint8Array> {
    const recorded = this.entries
    return (async function* () {
      for await (const entry of entries) {
        let bytesRead = 0
        for await (const chunk of entry.bytes) bytesRead += chunk.length

        recorded.push({
          name: entry.name,
          modifiedAt: entry.modifiedAt,
          bytesRead,
        })
        yield Uint8Array.of(recorded.length)
      }
    })()
  }
}

const EVENT = asEventId('event-1')

describe('exportAlbum', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let archive: FakeArchiveWriter
  let logger: CapturingLogger
  let exportAlbum: ExportAlbum

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    media = new InMemoryMediaStore()
    archive = new FakeArchiveWriter()
    logger = new CapturingLogger()
    events.seed(
      anEvent({ id: 'event-1', slug: 'camille-et-sacha' }),
      anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }),
    )
    exportAlbum = makeExportAlbum({ events, photos, media, archive, logger })
  })

  /** A row with every variant on the disk, which is what ingest guarantees. */
  const seedPhoto = async (input: PhotoInput): Promise<ContentHash> => {
    const photo = aPhoto({ eventId: 'event-1', ...input })
    photos.seed(photo)
    for (const variant of MEDIA_VARIANTS) {
      await media.put(
        photo.eventId,
        photo.contentHash,
        variant,
        new Uint8Array(BYTES_PER_VARIANT[variant]),
      )
    }
    return photo.contentHash
  }

  /** A published clip with both of its files on the disk, which is what a finished transcode leaves. */
  const seedClip = async (input: PhotoInput): Promise<ContentHash> => {
    const clip = aClip({ eventId: 'event-1', ...input })
    photos.seed(clip)
    await media.put(clip.eventId, clip.contentHash, 'video', new Uint8Array(BYTES_PER_CLIP_FILE.video))
    await media.put(clip.eventId, clip.hashFor('poster'), 'poster', new Uint8Array(BYTES_PER_CLIP_FILE.poster))
    return clip.contentHash
  }

  /** Consumes the archive, as the HTTP layer piping it to the response would. */
  const drain = async (result: Result<AsyncIterable<Uint8Array>, DomainError>): Promise<number> => {
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)
    let bytes = 0
    for await (const chunk of result.value) bytes += chunk.length
    return bytes
  }

  const namesInArchive = (): readonly string[] => archive.entries.map((entry) => entry.name)

  it('includes the photos that are on the wall and the ones taken off it', async () => {
    await seedPhoto({ id: 'shown', status: 'published', createdAt: atPlus(1_000) })
    await seedPhoto({ id: 'taken-down', status: 'hidden', createdAt: atPlus(0) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries).toHaveLength(2)
  })

  it('leaves a rejected photo out of the album the host hands over', async () => {
    await seedPhoto({ id: 'turned-down', status: 'rejected' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries).toEqual([])
  })

  it('leaves a photo still awaiting moderation out of the album', async () => {
    await seedPhoto({ id: 'waiting', status: 'pending' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries).toEqual([])
  })

  it('names every entry from the slug, a counter and the digest, never from a guest', async () => {
    const first = await seedPhoto({ id: 'p1', status: 'published', createdAt: atPlus(1_000) })
    const second = await seedPhoto({ id: 'p2', status: 'published', createdAt: atPlus(0) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(namesInArchive()).toEqual([
      `camille-et-sacha/0001-${first.short}.jpg`,
      `camille-et-sacha/0002-${second.short}.jpg`,
    ])
  })

  it('archives the full-quality original, not the variant the wall shows', async () => {
    await seedPhoto({ id: 'p1', status: 'published' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries.map((entry) => entry.bytesRead)).toEqual([BYTES_PER_VARIANT.original])
  })

  it('stamps each entry with the moment the photo was taken in', async () => {
    await seedPhoto({ id: 'p1', status: 'published', createdAt: atPlus(5_000) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries.map((entry) => entry.modifiedAt)).toEqual([atPlus(5_000)])
  })

  // ---------------------------------------------------------------- clips --

  /**
   * A clip has no `original` (`mediaVariant.ts`): the file the host keeps is its transcode.
   * The album used to ask every row for an `original`, so every clip was skipped with a
   * warning and a host who exported and then purged lost their videos.
   */
  it('archives a clip, as its transcode, named for what it is', async () => {
    const hash = await seedClip({ id: 'c1', status: 'published' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(namesInArchive()).toEqual([`camille-et-sacha/0001-${hash.short}.mp4`])
  })

  it('archives the clip transcode itself, not its poster', async () => {
    await seedClip({ id: 'c1', status: 'published' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries.map((entry) => entry.bytesRead)).toEqual([BYTES_PER_CLIP_FILE.video])
  })

  it('does not warn that it skipped a clip that is there', async () => {
    await seedClip({ id: 'c1', status: 'published' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(logger.lines).toEqual([])
  })

  it('carries photographs and clips in one album, numbered together', async () => {
    const photo = await seedPhoto({ id: 'p1', status: 'published', createdAt: atPlus(1_000) })
    const clip = await seedClip({ id: 'c1', status: 'published', createdAt: atPlus(0) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(namesInArchive()).toEqual([
      `camille-et-sacha/0001-${photo.short}.jpg`,
      `camille-et-sacha/0002-${clip.short}.mp4`,
    ])
  })

  it('keeps a hidden clip, as it keeps a hidden photograph, and leaves a rejected one out', async () => {
    const hidden = await seedClip({ id: 'c-hidden', status: 'hidden', createdAt: atPlus(1_000) })
    await seedClip({ id: 'c-rejected', status: 'rejected', createdAt: atPlus(0) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(namesInArchive()).toEqual([`camille-et-sacha/0001-${hidden.short}.mp4`])
  })

  it('skips a clip whose transcode is gone, and says so', async () => {
    photos.seed(aClip({ id: 'c-orphan', eventId: 'event-1', status: 'published' }))

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries).toEqual([])
    expect(logger.lines.map((line) => line.level)).toEqual(['warn'])
  })

  it('emits the archive as chunks rather than one buffer', async () => {
    await seedPhoto({ id: 'p1', status: 'published', createdAt: atPlus(1_000) })
    await seedPhoto({ id: 'p2', status: 'published', createdAt: atPlus(0) })

    const bytes = await drain(await exportAlbum({ eventId: EVENT }))

    expect(bytes).toBe(2)
  })

  it('never puts another event photo in this album', async () => {
    await seedPhoto({ id: 'ours', status: 'published' })
    const theirs = aPhoto({ id: 'theirs', eventId: 'event-2', status: 'published' })
    photos.seed(theirs)
    await media.put(theirs.eventId, theirs.contentHash, 'original', new Uint8Array(9))

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries).toHaveLength(1)
  })

  it('skips a row whose file was never written instead of failing the download', async () => {
    await seedPhoto({ id: 'complete', status: 'published', createdAt: atPlus(1_000) })
    photos.seed(aPhoto({ id: 'orphan', eventId: 'event-1', status: 'published' }))

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries).toHaveLength(1)
    expect(logger.lines.map((line) => line.level)).toEqual(['warn'])
  })

  it('names the row it skipped, because that is the only trace the operator has to it', async () => {
    photos.seed(aPhoto({ id: 'orphan', eventId: 'event-1', status: 'published' }))

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(logger.lines.map((line) => line.context)).toEqual([
      { eventId: EVENT, photoId: 'orphan' },
    ])
  })

  it('numbers the entries continuously even when a photo is skipped', async () => {
    await seedPhoto({ id: 'first', status: 'published', createdAt: atPlus(2_000) })
    photos.seed(aPhoto({ id: 'orphan', eventId: 'event-1', status: 'published' }))
    const last = await seedPhoto({ id: 'third', status: 'published', createdAt: atPlus(0) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(namesInArchive()).toContain(`camille-et-sacha/0002-${last.short}.jpg`)
  })

  it('archives an album longer than one page of the listing, every photo once and in order', async () => {
    // The listing is read a page at a time, so a photograph on a page boundary is where an
    // off-by-one in the cursor would drop it or write it twice.
    const hashes: ContentHash[] = []
    for (let index = 0; index < 205; index += 1) {
      hashes.push(
        await seedPhoto({
          id: `bulk-${String(index).padStart(3, '0')}`,
          status: 'published',
          createdAt: atPlus(index),
        }),
      )
    }

    await drain(await exportAlbum({ eventId: EVENT }))

    // Newest first, as the host's console lists it.
    expect(namesInArchive()).toEqual(
      hashes
        .map((hash, index) => `camille-et-sacha/${String(205 - index).padStart(4, '0')}-${hash.short}.jpg`)
        .reverse(),
    )
  })

  it('refuses to export an event that does not exist', async () => {
    const result = await exportAlbum({ eventId: asEventId('event-404') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('produces an empty archive for an event whose album is empty', async () => {
    const bytes = await drain(await exportAlbum({ eventId: EVENT }))

    expect(bytes).toBe(0)
    expect(archive.entries).toEqual([])
  })
})
