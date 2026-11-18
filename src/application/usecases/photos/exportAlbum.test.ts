import { beforeEach, describe, expect, it } from 'vitest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestbookEntryId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import { MEDIA_VARIANTS, type PhotoVariant } from '../../../domain/photos/mediaVariant'
import { Event } from '../../../domain/events/event'
import {
  AT,
  aClip,
  aGuest,
  aGuestbookEntry,
  aVoiceEntry,
  anEvent,
  aPhoto,
  atPlus,
  type PhotoInput,
} from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { CapturingLogger } from '../../testing/capturingLogger'
import { makeExportAlbum, type ExportAlbum } from './exportAlbum'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { FakeArchiveWriter } from '../../testing/fakeArchiveWriter'
import { MANIFEST_NAME } from '../../../domain/photos/albumManifest'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeContentHasher } from '../../testing/fakeContentHasher'
import { FakeStreamHasher } from '../../testing/fakeStreamHasher'

/** One byte per unit of length, so a test can tell the variants apart by size. */
const BYTES_PER_VARIANT: Readonly<Record<PhotoVariant, number>> = {
  original: 9,
  display: 3,
  thumb: 1,
}

/** A clip's two files. Distinct sizes, so a test can tell the transcode from the poster by length. */
const BYTES_PER_CLIP_FILE = { video: 20, poster: 2 } as const

const EVENT = asEventId('event-1')

describe('exportAlbum', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let guestbook: FakeGuestbookRepository
  let guests: FakeGuestRepository
  let media: InMemoryMediaStore
  let archive: FakeArchiveWriter
  let logger: CapturingLogger
  let clients: FakeClientRepository
  let exportAlbum: ExportAlbum

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    guestbook = new FakeGuestbookRepository()
    guests = new FakeGuestRepository(photos)
    media = new InMemoryMediaStore().forbidEnumeration('an album export')
    archive = new FakeArchiveWriter()
    logger = new CapturingLogger()
    clients = new FakeClientRepository()
    events.seed(
      anEvent({ id: 'event-1', slug: 'camille-et-sacha' }),
      anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }),
    )
    exportAlbum = makeExportAlbum({
      events,
      photos,
      guestbook,
      guests,
      media,
      archive,
      clients,
      streamHasher: new FakeStreamHasher(),
      clock: new FakeClock(AT),
      logger,
    })
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
    const hasher = new FakeContentHasher()
    // Bytes of their own, so that two clips never share a digest (they would be one row).
    const id = input.id ?? 'photo-1'
    const bytesOf = (kind: string, length: number): Uint8Array =>
      Uint8Array.from({ length }, (_, index) => (`${id}/${kind}`.charCodeAt(index % 8) + index) % 256)
    const video = bytesOf('video', BYTES_PER_CLIP_FILE.video)
    const poster = bytesOf('poster', BYTES_PER_CLIP_FILE.poster)
    const clip = aClip({
      eventId: 'event-1',
      contentHash: hasher.sha256Hex(video),
      clip: { posterHash: hasher.sha256Hex(poster) },
      ...input,
    })
    photos.seed(clip)
    await media.put(clip.eventId, clip.contentHash, 'video', video)
    await media.put(clip.eventId, clip.hashFor('poster'), 'poster', poster)
    return clip.contentHash
  }

  /** Consumes the archive, as the HTTP layer piping it to the response would. */
  const drain = async (result: Result<AsyncIterable<Uint8Array>, DomainError>): Promise<number> => {
    if (!result.ok) throw new Error(`expected an archive, got ${result.error.code}`)
    let bytes = 0
    for await (const chunk of result.value) bytes += chunk.length
    return bytes
  }

  /** The manifest closes every archive; the tests about contents look at what precedes it. */
  const files = () => archive.entries.filter((entry) => !entry.name.endsWith(`/${MANIFEST_NAME}`))

  const namesInArchive = (): readonly string[] => files().map((entry) => entry.name)

  it('includes the photos that are on the wall and the ones taken off it', async () => {
    await seedPhoto({ id: 'shown', status: 'published', createdAt: atPlus(1_000) })
    await seedPhoto({ id: 'taken-down', status: 'hidden', createdAt: atPlus(0) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(files()).toHaveLength(2)
  })

  it('leaves a rejected photo out of the album the host hands over', async () => {
    await seedPhoto({ id: 'turned-down', status: 'rejected' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(files()).toEqual([])
  })

  it('leaves a photo still awaiting moderation out of the album', async () => {
    await seedPhoto({ id: 'waiting', status: 'pending' })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(files()).toEqual([])
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

    expect(files().map((entry) => entry.bytesRead)).toEqual([BYTES_PER_VARIANT.original])
  })

  it('stamps each entry with the moment the photo was taken in', async () => {
    await seedPhoto({ id: 'p1', status: 'published', createdAt: atPlus(5_000) })

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(files().map((entry) => entry.modifiedAt)).toEqual([atPlus(5_000)])
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

    expect(files().map((entry) => entry.bytesRead)).toEqual([BYTES_PER_CLIP_FILE.video])
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

    expect(files()).toEqual([])
    expect(logger.lines.map((line) => line.level)).toEqual(['warn'])
  })

  it('emits the archive as chunks rather than one buffer', async () => {
    await seedPhoto({ id: 'p1', status: 'published', createdAt: atPlus(1_000) })
    await seedPhoto({ id: 'p2', status: 'published', createdAt: atPlus(0) })

    const bytes = await drain(await exportAlbum({ eventId: EVENT }))

    // One marker byte per entry in the fake writer: the two photographs and the manifest.
    expect(bytes).toBe(3)
  })

  it('never puts another event photo in this album', async () => {
    await seedPhoto({ id: 'ours', status: 'published' })
    const theirs = aPhoto({ id: 'theirs', eventId: 'event-2', status: 'published' })
    photos.seed(theirs)
    await media.put(theirs.eventId, theirs.contentHash, 'original', new Uint8Array(9))

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(files()).toHaveLength(1)
  })

  it('skips a row whose file was never written instead of failing the download', async () => {
    await seedPhoto({ id: 'complete', status: 'published', createdAt: atPlus(1_000) })
    photos.seed(aPhoto({ id: 'orphan', eventId: 'event-1', status: 'published' }))

    await drain(await exportAlbum({ eventId: EVENT }))

    expect(files()).toHaveLength(1)
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
    await drain(await exportAlbum({ eventId: EVENT }))

    expect(files()).toEqual([])
    expect(archive.names).toEqual([`camille-et-sacha/${MANIFEST_NAME}`])
  })

  it('exports nothing of an event the operator took down, or of a suspended client (launch review S5)', async () => {
    await events.setTakenDown(asEventId('event-1'), AT)
    const down = await exportAlbum({ eventId: asEventId('event-1') })
    await events.setTakenDown(asEventId('event-1'), null)
    const frozen = await makeExportAlbum({
      events: new FakeEventRepository().seed(
        Event.restore({ ...anEvent({ id: 'event-1' }).toProps(), clientSuspendedAt: AT }),
      ),
      photos,
      guestbook,
      guests,
      media,
      archive,
      clients,
      streamHasher: new FakeStreamHasher(),
      clock: new FakeClock(AT),
      logger,
    })({ eventId: asEventId('event-1') })

    expect(!down.ok && down.error.code).toBe('event.notFound')
    expect(!frozen.ok && frozen.error.code).toBe('client.suspended')
  })
})

describe('exportAlbum: the guestbook', () => {
  const GUEST_EVENT = asEventId('event-1')

  const build = () => {
    const events = new FakeEventRepository().seed(
      anEvent({ id: 'event-1', slug: 'camille-et-sacha', name: 'Camille et Sacha' }),
      anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }),
    )
    const photos = new FakePhotoRepository()
    const guestbook = new FakeGuestbookRepository()
    const guests = new FakeGuestRepository(photos)
    guests.seed(
      aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }),
      aGuest({ id: 'guest-sam', eventId: 'event-1', displayName: null }),
    )
    const archive = new FakeArchiveWriter({ emits: 'content' })
    const run = makeExportAlbum({
      events,
      photos,
      guestbook,
      guests,
      media: new InMemoryMediaStore().forbidEnumeration('an album export'),
      archive,
      clients: new FakeClientRepository(),
      streamHasher: new FakeStreamHasher(),
      clock: new FakeClock(AT),
      logger: new CapturingLogger(),
    })
    const text = async (): Promise<string> => {
      const result = await run({ eventId: GUEST_EVENT })
      if (!result.ok) throw new Error(result.error.code)
      const chunks: Uint8Array[] = []
      for await (const chunk of result.value) chunks.push(chunk)
      return new TextDecoder().decode(Buffer.concat(chunks))
    }
    return { guestbook, archive, text }
  }

  const entry = (id: string, guest: string, moderation: 'manual' | 'auto', eventId = 'event-1') =>
    aGuestbookEntry({ id, guestId: guest, eventId, text: `texte ${id}`, moderation })

  it('adds one guestbook.txt with the published and hidden messages, signed, and nothing else', async () => {
    const { guestbook, archive, text } = build()
    const moved = entry('m-hidden', 'guest-sam', 'auto').hide({ kind: 'automatic' }, AT)
    if (!moved.ok) throw new Error('setup')
    guestbook.seed(
      entry('m-pub', 'guest-lea', 'auto'),
      moved.value,
      entry('m-pending', 'guest-lea', 'manual'),
      entry('m-other', 'guest-lea', 'auto', 'event-2'),
    )

    const written = await text()

    expect(archive.names).toEqual(['camille-et-sacha/guestbook.txt', `camille-et-sacha/${MANIFEST_NAME}`])
    expect(written).toContain('Camille et Sacha\n\n')
    expect(written).toContain('Léa, ')
    expect(written).toContain('texte m-pub')
    expect(written).toContain('Un invité, ')
    expect(written).toContain('texte m-hidden')
    expect(written).not.toContain('m-pending')
    expect(written).not.toContain('m-other')
  })

  it('does not carry a voice message yet: guestbook.txt has no block for one, and an all-voice book writes no file', async () => {
    const { guestbook, archive, text } = build()
    guestbook.seed(
      aVoiceEntry({ id: 'v1', state: 'ready', guestId: 'guest-lea', eventId: 'event-1', moderation: 'auto' }),
    )

    await text()

    expect(archive.names).toEqual([`camille-et-sacha/${MANIFEST_NAME}`])
  })

  it('writes the words of a book that holds voices too, and none of their captions', async () => {
    const { guestbook, text } = build()
    guestbook.seed(
      entry('m-pub', 'guest-lea', 'auto'),
      aVoiceEntry({
        id: 'v1',
        state: 'ready',
        guestId: 'guest-lea',
        eventId: 'event-1',
        moderation: 'auto',
        caption: 'une voix, pas un texte',
      }),
    )

    const written = await text()

    expect(written).toContain('texte m-pub')
    expect(written).not.toContain('une voix')
  })

  it('leaves out a message the operator took down, and writes no file for an empty book', async () => {
    const { guestbook, archive, text } = build()
    guestbook.seed(entry('m1', 'guest-lea', 'auto'))
    guestbook.takeDown(GUEST_EVENT, asGuestbookEntryId('m1'), AT)

    await text()

    expect(archive.names).toEqual([`camille-et-sacha/${MANIFEST_NAME}`])
  })
})
