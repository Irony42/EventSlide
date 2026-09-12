import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, type EventId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'
import type { LogContext, Logger } from '../../ports/logger'
import {
  MEDIA_VARIANTS,
  type MediaMetadata,
  type MediaStore,
  type MediaVariant,
} from '../../ports/mediaStore'
import { anEvent, aPhoto, atPlus, type PhotoInput } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeExportAlbum, type ExportAlbum } from './exportAlbum'

/** One byte per unit of length, so a test can tell the variants apart by size. */
const BYTES_PER_VARIANT: Readonly<Record<MediaVariant, number>> = {
  original: 9,
  display: 3,
  thumb: 1,
}

class InMemoryMediaStore implements MediaStore {
  private readonly objects = new Map<string, Uint8Array>()

  private readonly unreadable = new Set<string>()

  /** Models the retention purge removing a file while a host is downloading. */
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

interface RecordedEntry {
  readonly name: string
  readonly byteSize: number
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
          byteSize: entry.byteSize,
          modifiedAt: entry.modifiedAt,
          bytesRead,
        })
        yield Uint8Array.of(recorded.length)
      }
    })()
  }
}

class CapturingLogger implements Logger {
  readonly lines: { level: string; message: string }[] = []

  debug(message: string): void {
    this.lines.push({ level: 'debug', message })
  }

  info(message: string): void {
    this.lines.push({ level: 'info', message })
  }

  warn(message: string): void {
    this.lines.push({ level: 'warn', message })
  }

  error(message: string): void {
    this.lines.push({ level: 'error', message })
  }

  child(_bindings: LogContext): Logger {
    return this
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

    expect(archive.entries.map((entry) => entry.byteSize)).toEqual([BYTES_PER_VARIANT.original])
    expect(archive.entries.map((entry) => entry.bytesRead)).toEqual([BYTES_PER_VARIANT.original])
  })

  it('stamps each entry with the moment the photo was taken in', async () => {
    await seedPhoto({ id: 'p1', status: 'published', createdAt: atPlus(5_000) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries.map((entry) => entry.modifiedAt)).toEqual([atPlus(5_000)])
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

  it('skips a file that disappears between the size check and the open', async () => {
    const hash = await seedPhoto({ id: 'purged', status: 'published' })
    media.vanishAfterStat(EVENT, hash)

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(archive.entries).toEqual([])
    expect(logger.lines.map((line) => line.level)).toEqual(['warn'])
  })

  it('numbers the entries continuously even when a photo is skipped', async () => {
    await seedPhoto({ id: 'first', status: 'published', createdAt: atPlus(2_000) })
    photos.seed(aPhoto({ id: 'orphan', eventId: 'event-1', status: 'published' }))
    const last = await seedPhoto({ id: 'third', status: 'published', createdAt: atPlus(0) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(namesInArchive()).toContain(`camille-et-sacha/0002-${last.short}.jpg`)
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
