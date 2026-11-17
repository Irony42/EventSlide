import { describe, expect, it } from 'vitest'
import { Event } from '../../../domain/events/event'
import { MANIFEST_NAME } from '../../../domain/photos/albumManifest'
import { asEventId } from '../../../domain/shared/ids'
import { AT, aClient, aClip, aGuestbookEntry, anEvent, aPhoto, atPlus } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeArchiveWriter } from '../../testing/fakeArchiveWriter'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeContentHasher } from '../../testing/fakeContentHasher'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeStreamHasher } from '../../testing/fakeStreamHasher'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { makeExportAlbum } from './exportAlbum'

/**
 * Spec 22, the manifest and the digests. The archive is read through the `content` writer, so the
 * manifest's own text can be looked at, and the bytes of a clip are the ones its digests were taken
 * over, which is what a finished transcode leaves.
 */

const EVENT = asEventId('event-1')

describe('exportAlbum: the manifest and the digests', () => {
  const hasher = new FakeContentHasher()
  const MANIFEST = `camille-et-sacha/${MANIFEST_NAME}`

  const build = () => {
    const events = new FakeEventRepository().seed(
      anEvent({ id: 'event-1', slug: 'camille-et-sacha', name: 'Camille et Sacha' }),
    )
    const photos = new FakePhotoRepository()
    const media = new InMemoryMediaStore().forbidEnumeration('an album export')
    const logger = new CapturingLogger()
    const archive = new FakeArchiveWriter({ emits: 'content' })
    const guestbook = new FakeGuestbookRepository()
    const run = makeExportAlbum({
      events,
      photos,
      guestbook,
      guests: new FakeGuestRepository(photos),
      media,
      archive,
      clients: new FakeClientRepository(),
      streamHasher: new FakeStreamHasher(),
      clock: new FakeClock(AT),
      logger,
    })
    const drainText = async (): Promise<string> => {
      const result = await run({ eventId: EVENT })
      if (!result.ok) throw new Error(result.error.code)
      const chunks: Uint8Array[] = []
      for await (const chunk of result.value) chunks.push(chunk)
      return new TextDecoder().decode(Buffer.concat(chunks))
    }
    const manifestOf = async (): Promise<readonly string[]> => {
      const text = await drainText()
      const from = text.lastIndexOf(MANIFEST) + MANIFEST.length
      return text
        .slice(from)
        .split('\n')
        .filter((line) => line !== '')
    }
    return { photos, media, logger, archive, guestbook, run, drainText, manifestOf }
  }

  type World = ReturnType<typeof build>

  const seedClip = async (
    world: World,
    id: string,
    video: Uint8Array,
    storedAs = hasher.sha256Hex(video),
  ) => {
    const poster = Uint8Array.of(1, 2, 3)
    const clip = aClip({
      id,
      eventId: 'event-1',
      status: 'published',
      contentHash: storedAs,
      clip: { posterHash: hasher.sha256Hex(poster) },
    })
    world.photos.seed(clip)
    await world.media.put(clip.eventId, clip.contentHash, 'video', video)
    await world.media.put(clip.eventId, clip.hashFor('poster'), 'poster', poster)
    return clip
  }

  const seedPhoto = async (world: World, id: string, original: Uint8Array) => {
    const photo = aPhoto({ id, eventId: 'event-1', status: 'published' })
    world.photos.seed(photo)
    await world.media.put(photo.eventId, photo.contentHash, 'original', original)
    return photo
  }

  it('lists every file with the digest of the bytes that went by, in the order of the archive', async () => {
    const world = build()
    const original = Uint8Array.from([4, 5, 6, 7])
    const photo = await seedPhoto(world, 'p1', original)

    const lines = await world.manifestOf()

    expect(lines[0]).toBe(`${hasher.sha256Hex(original)}  0001-${photo.contentHash.short}.jpg`)
  })

  it('writes the lines the way sha256sum reads them: 64 hex, two spaces, a name without a folder', async () => {
    const world = build()
    await seedPhoto(world, 'p1', Uint8Array.of(1))

    const [line] = await world.manifestOf()

    expect(line).toMatch(/^[0-9a-f]{64} {2}[^/\s]+\.jpg$/)
  })

  it('puts the manifest last, after the guestbook', async () => {
    const world = build()
    await seedPhoto(world, 'p1', Uint8Array.of(1))
    world.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))

    await world.drainText()

    expect(world.archive.names.at(-1)).toBe(MANIFEST)
    expect(world.archive.names.at(-2)).toBe('camille-et-sacha/guestbook.txt')
  })

  it('lists the guestbook in the manifest, since it is a file of the archive', async () => {
    const world = build()
    world.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))

    const lines = await world.manifestOf()

    expect(lines.some((line) => line.endsWith('  guestbook.txt'))).toBe(true)
  })

  it('says how many rows had no file on the disk, so a short archive is never silent', async () => {
    const world = build()
    await seedPhoto(world, 'p1', Uint8Array.of(1))
    world.photos.seed(aPhoto({ id: 'ghost', eventId: 'event-1', status: 'published' }))

    const lines = await world.manifestOf()

    expect(lines.at(-1)).toBe('# missing: 1')
    expect(lines).toHaveLength(2)
  })

  it('says none are missing when none are, rather than leaving the line out', async () => {
    const world = build()
    await seedPhoto(world, 'p1', Uint8Array.of(1))

    expect((await world.manifestOf()).at(-1)).toBe('# missing: 0')
  })

  it('lists a clip with the digest of its transcode, which is also the one it is stored under', async () => {
    const world = build()
    const video = Uint8Array.from([9, 9, 9, 9, 9])
    const clip = await seedClip(world, 'c1', video)

    const [line] = await world.manifestOf()

    expect(line).toBe(`${clip.contentHash.value}  0001-${clip.contentHash.short}.mp4`)
  })

  it('aborts the stream, and never lists the file, when a clip is not what its digest says', async () => {
    const world = build()
    // Stored under the digest of other bytes: the disk changed the file after the transcode.
    await seedClip(world, 'c1', Uint8Array.of(1, 2, 3), hasher.sha256Hex(Uint8Array.of(9, 9)))

    await expect(world.drainText()).rejects.toMatchObject({ code: 'export.corrupt' })

    expect(world.archive.names).not.toContain(MANIFEST)
    expect(world.logger.lines.map((line) => line.level)).toEqual(['error'])
  })

  it('does not call a healthy photograph corrupt: the digest vouches for its display rendition, not its original', async () => {
    const world = build()
    // `aPhoto`'s digest is arbitrary and the original's bytes are unrelated to it, as in production.
    await seedPhoto(world, 'p1', Uint8Array.of(1, 2, 3))

    await expect(world.drainText()).resolves.toContain('# missing: 0')
  })
})

/** Spec 22, rule 8: who may take the album out, and what a suspension changes. */
describe('exportAlbum: a client in offboarding may still export', () => {
  const CLIENT = 'client-1'

  const run = async (options: {
    readonly suspended: boolean
    readonly offboarding: boolean
    readonly takenDown?: boolean
    readonly knownClient?: boolean
    /** Told of every read of the clients table. */
    readonly onClientRead?: () => void
  }) => {
    const client = aClient({
      id: CLIENT,
      suspendedAt: options.suspended ? AT : null,
      purgeAfter: options.offboarding ? atPlus(30 * 86_400_000) : null,
    })
    // The events fake needs the client to exist; what the use case is handed can be a table that
    // does not have it, which is how a client that cannot be found is reached.
    const seeded = new FakeClientRepository().seed(client)
    const table = options.knownClient === false ? new FakeClientRepository() : seeded
    const clients = {
      findById: async (id: Parameters<typeof table.findById>[0]) => {
        options.onClientRead?.()
        return table.findById(id)
      },
    }
    const event = Event.restore({
      ...anEvent({ id: 'event-1', slug: 'camille-et-sacha', clientId: CLIENT }).toProps(),
      clientSuspendedAt: options.suspended ? AT : null,
    })
    const events = new FakeEventRepository({ clients: seeded }).seed(event)
    if (options.takenDown === true) await events.setTakenDown(event.id, AT)
    const photos = new FakePhotoRepository()
    return makeExportAlbum({
      events,
      photos,
      guestbook: new FakeGuestbookRepository(),
      guests: new FakeGuestRepository(photos),
      media: new InMemoryMediaStore().forbidEnumeration('an album export'),
      archive: new FakeArchiveWriter(),
      clients,
      streamHasher: new FakeStreamHasher(),
      clock: new FakeClock(AT),
      logger: new CapturingLogger(),
    })({ eventId: asEventId('event-1') })
  }

  it('hands the album over to a suspended client whose offboarding has begun', async () => {
    expect((await run({ suspended: true, offboarding: true })).ok).toBe(true)
  })

  it('still refuses a suspended client that is not being offboarded', async () => {
    const result = await run({ suspended: true, offboarding: false })

    expect(!result.ok && result.error.code).toBe('client.suspended')
  })

  it('refuses a suspended event whose client cannot be found, as an abuse suspension would be', async () => {
    const result = await run({ suspended: true, offboarding: true, knownClient: false })

    expect(!result.ok && result.error.code).toBe('client.suspended')
  })

  it('answers as for an event that is not there when the operator took it down, offboarding or not', async () => {
    const result = await run({ suspended: true, offboarding: true, takenDown: true })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('does not read the clients table for an event nobody suspended', async () => {
    let reads = 0
    const result = await run({
      suspended: false,
      offboarding: false,
      onClientRead: () => {
        reads += 1
      },
    })

    expect(result.ok).toBe(true)
    expect(reads).toBe(0)
  })
})
