import { beforeEach, describe, expect, it } from 'vitest'
import type { Photo } from '../../../domain/photos/photo'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { asEventId } from '../../../domain/shared/ids'
import type { ArchiveEntry } from '../../ports/archiveWriter'
import { aClip, aPhoto, atPlus } from '../../testing/builders'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { albumEntries, type AlbumEntriesSource } from './albumEntries'

/**
 * What the host's ZIP and the shared gallery's ZIP are both made of. Their own tests say what
 * differs; these say what is the same, which is the part that drifted when it was written twice.
 */

const EVENT = asEventId('event-1')
const SLUG = 'camille-et-sacha'
const BYTES = Uint8Array.of(1, 2, 3)

describe('albumEntries', () => {
  let photos: FakePhotoRepository
  let asked: { readonly id: string; readonly variant: string; readonly hash: string }[]
  let skippedIds: string[]

  const bytes = async function* (): AsyncIterable<Uint8Array> {
    yield BYTES
  }

  const source = (overrides: Partial<AlbumEntriesSource> = {}): AlbumEntriesSource => ({
    photos,
    eventId: EVENT,
    slug: SLUG,
    statuses: ['published'],
    open: async (photo, hash, variant) => {
      asked.push({ id: photo.id, variant, hash: hash.value })
      return bytes()
    },
    skipped: (photo) => {
      skippedIds.push(photo.id)
    },
    ...overrides,
  })

  const collect = async (entries: AsyncIterable<ArchiveEntry>): Promise<ArchiveEntry[]> => {
    const collected: ArchiveEntry[] = []
    for await (const entry of entries) collected.push(entry)
    return collected
  }

  const seed = (...rows: readonly Photo[]): void => {
    photos.seed(...rows)
  }

  beforeEach(() => {
    photos = new FakePhotoRepository()
    asked = []
    skippedIds = []
  })

  it('asks for a photograph its original, and for a clip its transcode', async () => {
    seed(
      aPhoto({ id: 'p1', eventId: 'event-1', status: 'published', createdAt: atPlus(2) }),
      aClip({ id: 'c1', eventId: 'event-1', status: 'published', createdAt: atPlus(1) }),
    )

    await collect(albumEntries(source()))

    expect(asked.map(({ id, variant }) => [id, variant])).toEqual([
      ['p1', 'original'],
      ['c1', 'video'],
    ])
  })

  it('hands over the digest the file is stored under, which for a clip is not its poster', async () => {
    const clip = aClip({ id: 'c1', eventId: 'event-1', status: 'published' })
    seed(clip)

    await collect(albumEntries(source()))

    expect(asked.map(({ hash }) => hash)).toEqual([clip.hashFor('video').value])
    expect(clip.hashFor('video').value).not.toBe(clip.hashFor('poster').value)
  })

  it('names each entry for what it is: slug, counter, digest and the extension of its kind', async () => {
    const photo = aPhoto({
      id: 'p1',
      eventId: 'event-1',
      status: 'published',
      createdAt: atPlus(2),
    })
    const clip = aClip({ id: 'c1', eventId: 'event-1', status: 'published', createdAt: atPlus(1) })
    seed(photo, clip)

    const entries = await collect(albumEntries(source()))

    expect(entries.map((entry) => entry.name)).toEqual([
      `${SLUG}/0001-${photo.contentHash.short}.jpg`,
      `${SLUG}/0002-${clip.contentHash.short}.mp4`,
    ])
  })

  it('stamps each entry with when the row was taken in', async () => {
    seed(aPhoto({ id: 'p1', eventId: 'event-1', status: 'published', createdAt: atPlus(5_000) }))

    const entries = await collect(albumEntries(source()))

    expect(entries.map((entry) => entry.modifiedAt)).toEqual([atPlus(5_000)])
  })

  it('lists the statuses it was given and no others', async () => {
    seed(
      aPhoto({ id: 'shown', eventId: 'event-1', status: 'published', createdAt: atPlus(2) }),
      aPhoto({ id: 'taken-down', eventId: 'event-1', status: 'hidden', createdAt: atPlus(1) }),
      aPhoto({ id: 'rejected', eventId: 'event-1', status: 'rejected', createdAt: atPlus(0) }),
    )
    const album: readonly PhotoStatus[] = ['published', 'hidden']

    await collect(albumEntries(source({ statuses: album })))

    expect(asked.map(({ id }) => id)).toEqual(['shown', 'taken-down'])
  })

  it('lists one event only', async () => {
    seed(
      aPhoto({ id: 'ours', eventId: 'event-1', status: 'published' }),
      aPhoto({ id: 'theirs', eventId: 'event-2', status: 'published' }),
    )

    await collect(albumEntries(source()))

    expect(asked.map(({ id }) => id)).toEqual(['ours'])
  })

  it('skips a row `open` has no file for, tells the caller, and numbers on without a gap', async () => {
    const last = aPhoto({
      id: 'third',
      eventId: 'event-1',
      status: 'published',
      createdAt: atPlus(0),
    })
    seed(
      aPhoto({ id: 'first', eventId: 'event-1', status: 'published', createdAt: atPlus(2) }),
      aPhoto({ id: 'orphan', eventId: 'event-1', status: 'published', createdAt: atPlus(1) }),
      last,
    )

    const entries = await collect(
      albumEntries(source({ open: async (photo) => (photo.id === 'orphan' ? null : bytes()) })),
    )

    expect(skippedIds).toEqual(['orphan'])
    expect(entries.map((entry) => entry.name)).toContain(
      `${SLUG}/0002-${last.contentHash.short}.jpg`,
    )
    expect(entries).toHaveLength(2)
  })

  it('reads an album longer than one page, every row once and in the listing order', async () => {
    // A row on a page boundary is where an off-by-one in the cursor drops it or writes it twice.
    for (let index = 0; index < 205; index += 1) {
      seed(
        aPhoto({
          id: `bulk-${String(index).padStart(3, '0')}`,
          eventId: 'event-1',
          status: 'published',
          createdAt: atPlus(index),
        }),
      )
    }

    await collect(albumEntries(source()))

    const listed = (await photos.list(EVENT, { statuses: ['published'], limit: 500 })).items
    expect(asked.map(({ id }) => id)).toEqual(listed.map((photo) => photo.id))
    expect(asked).toHaveLength(205)
  })

  it('opens a row only when the consumer pulls its entry, so one file is open at a time', async () => {
    seed(
      aPhoto({ id: 'p1', eventId: 'event-1', status: 'published', createdAt: atPlus(2) }),
      aPhoto({ id: 'p2', eventId: 'event-1', status: 'published', createdAt: atPlus(1) }),
    )
    const pulled = albumEntries(source())[Symbol.asyncIterator]()

    await pulled.next()

    expect(asked.map(({ id }) => id)).toEqual(['p1'])
  })

  it('produces no entries for an album with nothing in it', async () => {
    expect(await collect(albumEntries(source()))).toEqual([])
  })
})
