import { describe, expect, it } from 'vitest'
import type { Event } from '../../../domain/events/event'
import { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { MANIFEST_NAME } from '../../../domain/photos/albumManifest'
import { asEventId, asGuestbookEntryId } from '../../../domain/shared/ids'
import {
  AT,
  aGuest,
  aGuestbookEntry,
  aPhoto,
  aVoiceEntry,
  anEvent,
  atPlus,
} from '../../testing/builders'
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
import { albumArchiveOf } from '../shared/albumArchive'
import { makeExportAlbum } from './exportAlbum'

/**
 * The voice messages in the host's archive (spec 25, section 8), through the one loop the streamed
 * ZIP and the verified archive share: which recordings are in it, what is kept secret, what a
 * wrong digest or a lost file does, and what the report says.
 */

const EVENT = asEventId('event-1')
const SLUG = 'camille-et-sacha'
const MANIFEST = `${SLUG}/${MANIFEST_NAME}`
const hasher = new FakeContentHasher()

const aClosedEvent = (): Event =>
  anEvent({
    id: 'event-1',
    slug: SLUG,
    name: 'Camille et Sacha',
    status: 'closed',
    settings: { allowGuestbook: true, guestbookVoice: { enabled: true, sealed: true } },
  })

/** The same event, still running: the secret is not lifted. */
const aSealedLiveEvent = (): Event =>
  anEvent({
    id: 'event-1',
    slug: SLUG,
    name: 'Camille et Sacha',
    status: 'live',
    settings: { allowGuestbook: true, guestbookVoice: { enabled: true, sealed: true } },
  })

const build = (event: Event = aClosedEvent()) => {
  const events = new FakeEventRepository().seed(event)
  const photos = new FakePhotoRepository()
  const guestbook = new FakeGuestbookRepository()
  const guests = new FakeGuestRepository(photos)
  guests.seed(
    aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }),
    aGuest({ id: 'guest-sam', eventId: 'event-1', displayName: 'Sam' }),
  )
  const media = new InMemoryMediaStore().forbidEnumeration('an album export')
  const logger = new CapturingLogger()
  const archive = new FakeArchiveWriter({ emits: 'content' })
  const clock = new FakeClock(atPlus(86_400_000))
  const deps = {
    photos,
    guestbook,
    guests,
    media,
    streamHasher: new FakeStreamHasher(),
    clock,
    logger,
  }
  const run = makeExportAlbum({ events, archive, clients: new FakeClientRepository(), ...deps })
  const drainText = async (): Promise<string> => {
    const result = await run({ eventId: EVENT })
    if (!result.ok) throw new Error(result.error.code)
    const chunks: Uint8Array[] = []
    for await (const chunk of result.value) chunks.push(chunk)
    return new TextDecoder().decode(Buffer.concat(chunks))
  }
  return { event, photos, guestbook, media, logger, archive, clock, deps, drainText }
}

type World = ReturnType<typeof build>

/**
 * A recording the box finished: ready, with its output on the disk under the digest of its own
 * bytes (a finished transcode stores it so), or under another one for a disk that went bad.
 */
const seedVoice = async (
  world: World,
  input: {
    readonly id: string
    readonly guest?: string
    readonly moderation?: 'manual' | 'auto'
    readonly state?: 'ready' | 'queued' | 'failed'
    readonly caption?: string | null
    readonly createdAt?: Date
    readonly bytes?: Uint8Array
    readonly storedAs?: string
    readonly onDisk?: boolean
    readonly durationMs?: number
  },
): Promise<GuestbookEntry> => {
  const bytes = input.bytes ?? Uint8Array.of(7, 7, 7, input.id.length)
  const entry = aVoiceEntry({
    id: input.id,
    eventId: 'event-1',
    guestId: input.guest ?? 'guest-lea',
    state: input.state ?? 'ready',
    moderation: input.moderation ?? 'auto',
    caption: input.caption ?? null,
    createdAt: input.createdAt ?? AT,
    audioHash: input.storedAs ?? hasher.sha256Hex(bytes),
    durationMs: input.durationMs ?? 23_400,
  })
  world.guestbook.seed(entry)
  const hash = entry.voice?.audioHash
  if (hash !== null && hash !== undefined && input.onDisk !== false) {
    await world.media.put(entry.eventId, hash, 'voice', bytes)
  }
  return entry
}

describe('the archive and the voice messages', () => {
  it('carries a published recording as voice/0001-<digest>.m4a, listed in the manifest with the digest of its bytes', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, name: 'Camille et Sacha', status: 'closed' }))
    const bytes = Uint8Array.of(4, 5, 6, 7, 8)
    const voice = await seedVoice(world, { id: 'v1', bytes })
    const hash = voice.voice?.audioHash
    if (hash === null || hash === undefined) throw new Error('fixture')

    const text = await world.drainText()

    expect(world.archive.names).toContain(`${SLUG}/voice/0001-${hash.short}.m4a`)
    expect(text).toContain(`${hasher.sha256Hex(bytes)}  voice/0001-${hash.short}.m4a`)
  })

  it('puts the recordings after the photographs and before guestbook.txt, which refers to them', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
    const photo = aPhoto({ id: 'p1', eventId: 'event-1', status: 'published' })
    world.photos.seed(photo)
    await world.media.put(photo.eventId, photo.contentHash, 'original', Uint8Array.of(1))
    await seedVoice(world, { id: 'v1' })

    await world.drainText()

    expect(world.archive.names.map((name) => name.slice(SLUG.length + 1).replace(/-.*/, ''))).toEqual([
      '0001',
      'voice/0001',
      'guestbook.txt',
      MANIFEST_NAME,
    ])
  })

  it('says in guestbook.txt what it is, how long it is, which file holds it and what the guest wrote', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, name: 'Camille et Sacha', status: 'closed' }))
    const voice = await seedVoice(world, { id: 'v1', caption: 'Pour vous deux', durationMs: 23_400 })

    const text = await world.drainText()

    expect(text).toContain(
      `Léa, 2026-06-20 21:00 UTC\n[message vocal, 0:23, voice/0001-${voice.voice?.audioHash?.short}.m4a]\nPour vous deux\n`,
    )
  })

  it('writes the written messages and the recordings in one book, oldest first', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
    world.guestbook.seed(
      aGuestbookEntry({
        id: 'w1',
        eventId: 'event-1',
        guestId: 'guest-sam',
        text: 'un mot',
        moderation: 'auto',
        createdAt: atPlus(2_000),
      }),
    )
    await seedVoice(world, { id: 'v1', createdAt: atPlus(1_000) })

    const text = await world.drainText()

    expect(text.indexOf('[message vocal')).toBeLessThan(text.indexOf('un mot'))
  })

  it('includes a published recording and a hidden one, as it does for a photograph', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
    await seedVoice(world, { id: 'v-pub', createdAt: atPlus(1_000) })
    const hidden = await seedVoice(world, { id: 'v-hidden', createdAt: atPlus(2_000) })
    // A voice cannot be hidden through the entity any more; a row that was is read back as it is.
    world.guestbook.seed(GuestbookEntry.restore({ ...hidden.toProps(), status: 'hidden' }))

    await world.drainText()

    expect(world.archive.names.filter((name) => name.includes('/voice/'))).toHaveLength(2)
  })

  it('leaves out a recording that is pending, one that was refused, one still being processed and one that failed', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
    await seedVoice(world, { id: 'v-pending', moderation: 'manual' })
    const refused = await seedVoice(world, { id: 'v-refused', moderation: 'manual' })
    world.guestbook.seed(GuestbookEntry.restore({ ...refused.toProps(), status: 'rejected' }))
    await seedVoice(world, { id: 'v-queued', state: 'queued' })
    await seedVoice(world, { id: 'v-failed', state: 'failed' })

    const text = await world.drainText()

    expect(world.archive.names.filter((name) => name.includes('/voice/'))).toEqual([])
    expect(text).not.toContain('[message vocal')
  })

  it('leaves out a recording the operator took down, and another event’s', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
    await seedVoice(world, { id: 'v-down' })
    world.guestbook.takeDown(EVENT, asGuestbookEntryId('v-down'), AT)
    const stranger = aVoiceEntry({ id: 'v-other', eventId: 'event-2', state: 'ready', moderation: 'auto' })
    world.guestbook.seed(stranger)

    await world.drainText()

    expect(world.archive.names.filter((name) => name.includes('/voice/'))).toEqual([])
  })

  it('names the file from the slug, a counter and the digest, never from what the guest wrote', async () => {
    const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
    await seedVoice(world, { id: 'v1', caption: '../../etc/passwd' })

    await world.drainText()

    for (const name of world.archive.names.filter((entry) => entry.includes('/voice/'))) {
      expect(name).toMatch(/^camille-et-sacha\/voice\/\d{4}-[0-9a-f]{12}\.m4a$/)
    }
  })

  describe('kept secret', () => {
    it('is not in the archive while the secret holds: no file, and no line in the manifest', async () => {
      const world = build(aSealedLiveEvent())
      await seedVoice(world, { id: 'v1' })
      await seedVoice(world, { id: 'v2', createdAt: atPlus(1_000), bytes: Uint8Array.of(9, 9) })

      const text = await world.drainText()

      expect(world.archive.names.filter((name) => name.includes('/voice/'))).toEqual([])
      expect(text).not.toContain('.m4a')
    })

    it('says in guestbook.txt how many were left out, and nothing else about them', async () => {
      const world = build(aSealedLiveEvent())
      await seedVoice(world, { id: 'v1', caption: 'un secret' })
      await seedVoice(world, { id: 'v2', createdAt: atPlus(1_000), bytes: Uint8Array.of(9, 9) })

      const text = await world.drainText()

      expect(world.archive.names).toContain(`${SLUG}/guestbook.txt`)
      expect(text).toContain('2 messages vocaux scellés, non inclus')
      expect(text).not.toContain('un secret')
      expect(text).not.toContain('Léa, 2026')
    })

    it('counts only the recordings a listener could hear: a refused one is not “kept secret”, it is refused', async () => {
      const world = build(aSealedLiveEvent())
      await seedVoice(world, { id: 'v1' })
      await seedVoice(world, { id: 'v2', moderation: 'manual' })

      const text = await world.drainText()

      expect(text).toContain('1 message vocal scellé, non inclus')
    })

    it('is lifted when the event is closed: the recordings are in', async () => {
      const world = build(aClosedEvent())
      await seedVoice(world, { id: 'v1' })

      await world.drainText()

      expect(world.archive.names.filter((name) => name.includes('/voice/'))).toHaveLength(1)
    })

    it('is lifted by an opening time that has come, the instant included', async () => {
      const world = build(
        anEvent({
          id: 'event-1',
          slug: SLUG,
          status: 'live',
          settings: {
            allowGuestbook: true,
            guestbookVoice: { enabled: true, sealed: true, opensAtMs: atPlus(86_400_000).getTime() },
          },
        }),
      )
      await seedVoice(world, { id: 'v1' })

      await world.drainText()

      expect(world.archive.names.filter((name) => name.includes('/voice/'))).toHaveLength(1)
    })

    it('is held while the opening time is still ahead', async () => {
      const world = build(
        anEvent({
          id: 'event-1',
          slug: SLUG,
          status: 'live',
          settings: {
            allowGuestbook: true,
            guestbookVoice: { enabled: true, sealed: true, opensAtMs: atPlus(86_400_001).getTime() },
          },
        }),
      )
      await seedVoice(world, { id: 'v1' })

      await world.drainText()

      expect(world.archive.names.filter((name) => name.includes('/voice/'))).toEqual([])
    })

    it('writes no book at all when nothing is kept secret and nothing is in the album', async () => {
      const world = build(aSealedLiveEvent())

      await world.drainText()

      expect(world.archive.names).toEqual([MANIFEST])
    })
  })

  describe('a recording that is not what it should be', () => {
    it('aborts the stream, and never lists the file, when its digest does not say its bytes', async () => {
      const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
      await seedVoice(world, {
        id: 'v1',
        bytes: Uint8Array.of(1, 2, 3),
        storedAs: hasher.sha256Hex(Uint8Array.of(9, 9)),
      })

      await expect(world.drainText()).rejects.toMatchObject({ code: 'export.corrupt' })

      expect(world.archive.names).not.toContain(MANIFEST)
      expect(world.logger.lines.map((line) => line.level)).toEqual(['error'])
    })

    it('skips a recording whose file is gone, counts it in “# missing”, and says so in guestbook.txt', async () => {
      const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
      await seedVoice(world, { id: 'v1', onDisk: false })
      await seedVoice(world, { id: 'v2', createdAt: atPlus(1_000), bytes: Uint8Array.of(8, 8, 8) })

      const text = await world.drainText()

      expect(text).toContain('# missing: 1')
      expect(text).toContain('[message vocal, 0:23, fichier absent]')
      expect(world.archive.names.filter((name) => name.includes('/voice/'))).toHaveLength(1)
      expect(world.logger.lines.map((line) => line.level)).toEqual(['warn'])
    })

    it('numbers the files continuously when one is skipped', async () => {
      const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
      await seedVoice(world, { id: 'v1', onDisk: false, createdAt: atPlus(1_000) })
      await seedVoice(world, { id: 'v2', createdAt: atPlus(2_000), bytes: Uint8Array.of(8, 8, 8) })

      await world.drainText()

      expect(world.archive.names.filter((name) => name.includes('/voice/'))).toEqual([
        expect.stringMatching(/\/voice\/0001-/),
      ])
    })
  })

  describe('the report', () => {
    const walk = async (world: World) => {
      const archive = albumArchiveOf(world.deps, world.event)
      for await (const entry of archive.entries) {
        for await (const chunk of entry.bytes) void chunk
      }
      return archive.report()
    }

    it('counts the recordings apart: photographs and clips are photographs, nothing else', async () => {
      const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
      const photo = aPhoto({ id: 'p1', eventId: 'event-1', status: 'published' })
      world.photos.seed(photo)
      await world.media.put(photo.eventId, photo.contentHash, 'original', Uint8Array.of(1))
      await seedVoice(world, { id: 'v1' })
      await seedVoice(world, { id: 'v2', createdAt: atPlus(1_000), bytes: Uint8Array.of(8, 8) })

      const report = await walk(world)

      expect(report).toEqual({
        // The photograph, two recordings and the book; the manifest is not counted.
        written: 4,
        photos: 1,
        voices: 2,
        missing: 0,
        missingPhotos: 0,
      })
    })

    it('keeps a lost recording out of the photographs’ accounting, so the album’s row count still balances', async () => {
      const world = build(anEvent({ id: 'event-1', slug: SLUG, status: 'closed' }))
      const photo = aPhoto({ id: 'p1', eventId: 'event-1', status: 'published' })
      world.photos.seed(photo)
      await world.media.put(photo.eventId, photo.contentHash, 'original', Uint8Array.of(1))
      world.photos.seed(aPhoto({ id: 'ghost', eventId: 'event-1', status: 'published' }))
      await seedVoice(world, { id: 'v1', onDisk: false })

      const report = await walk(world)

      expect(report).toMatchObject({ photos: 1, voices: 0, missing: 2, missingPhotos: 1 })
    })
  })
})
