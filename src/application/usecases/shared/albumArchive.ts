import type { Event } from '../../../domain/events/event'
import { renderGuestbookText } from '../../../domain/guestbook/guestbookExport'
import { MAX_ENTRIES_PER_EVENT } from '../../../domain/guestbook/guestbookLimits'
import {
  MANIFEST_NAME,
  renderManifest,
  type ManifestLine,
} from '../../../domain/photos/albumManifest'
import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import type { Photo } from '../../../domain/photos/photo'
import { isInAlbum, PHOTO_STATUSES, type PhotoStatus } from '../../../domain/photos/photoStatus'
import { digestVouchesForVariant } from '../../../domain/photos/storedDigest'
import { DomainError } from '../../../domain/shared/errors'
import type { ArchiveEntry } from '../../ports/archiveWriter'
import type { Clock } from '../../ports/clock'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { StreamHasher } from '../../ports/streamHasher'
import { albumEntries } from './albumEntries'

/**
 * The entries of the host's album archive: the photographs and clips, `guestbook.txt` and, last,
 * `MANIFEST.sha256`. **One loop for the two ways the archive is made**: the ZIP streamed to the
 * host's browser (`exportAlbum`) and the verified archive the box writes to its own disk
 * (`buildNextAlbumExport`, spec 22). They are the same album, in the same order, with the same
 * checks, and a copy of this function would drift the way the two loops `albumEntries` replaced
 * had.
 *
 * What is in it. Only the statuses `isInAlbum` accepts, published and hidden. Photographs as their
 * stored `original` and clips as their transcode (`albumEntries`). The guestbook as one entry,
 * after the photographs, read in one go (a book holds at most 500 short messages).
 *
 * **A file that is not what its digest says aborts the stream** (`export.corrupt`) rather than being
 * handed over. It can only be checked where the digest vouches for the bytes (`storedDigest`): a
 * photograph's digest is taken over its *display* rendition, so its `original` is listed in the
 * manifest but cannot be held against the name; a clip's two files can. Each file is hashed **as it
 * passes**, one chunk at a time, and the manifest lists what went by.
 *
 * **A missing file is skipped, and counted.** The manifest says how many (`# missing: N`) and
 * `report()` hands the number to a caller that keeps a record of it.
 *
 * Nothing is materialised: rows arrive a page at a time, bytes a chunk at a time.
 */

/** Asked of the domain once, rather than restated as a list of statuses. */
export const ALBUM_STATUSES: readonly PhotoStatus[] = PHOTO_STATUSES.filter(isInAlbum)

/** The guestbook's messages follow the same rule as the photographs: the same predicate. */
const GUESTBOOK_ALBUM_STATUSES = ALBUM_STATUSES

async function* oneChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes
}

export interface AlbumArchiveDeps {
  readonly photos: PhotoRepository
  readonly guestbook: GuestbookRepository
  readonly guests: GuestRepository
  readonly media: MediaStore
  readonly streamHasher: StreamHasher
  /** The manifest's own modification time. */
  readonly clock: Clock
  readonly logger: Logger
}

/** What a finished walk of the entries found. Only complete once `entries` has been consumed. */
export interface AlbumArchiveReport {
  /** Files written, the guestbook included and the manifest not. */
  readonly written: number
  /** Of those, the photographs and clips: one per row of the album that had its file. */
  readonly photos: number
  /** Rows of the album whose file was not on the disk. */
  readonly missing: number
}

export interface AlbumArchive {
  readonly entries: AsyncIterable<ArchiveEntry>
  readonly report: () => AlbumArchiveReport
}

export const albumArchiveOf = (
  { photos, guestbook, guests, media, streamHasher, clock, logger }: AlbumArchiveDeps,
  event: Event,
): AlbumArchive => {
  const eventId = event.id
  const slug = event.slug.value
  /** What the manifest lists, in the order the files went by, and the rows that had no file. */
  const manifest: ManifestLine[] = []
  let missing = 0
  let guestbookWritten = false

  /** An entry's name as the manifest, which sits in the same folder, reads it. */
  const manifestName = (entry: ArchiveEntry): string => entry.name.slice(slug.length + 1)

  /**
   * The entry's bytes, hashed as they pass. At the end of the file the digest is listed in the
   * manifest, or, for a file that has a digest to answer to, held against it first: a mismatch
   * fails the stream here, and the file is never listed.
   */
  const hashed = (
    entry: ArchiveEntry,
    expected: string | null,
    row: string,
    listed?: () => void,
  ): ArchiveEntry => ({
    ...entry,
    bytes: (async function* () {
      const hash = streamHasher.start()
      for await (const chunk of entry.bytes) {
        hash.update(chunk)
        yield chunk
      }
      const digest = hash.digestHex()
      if (expected !== null && digest !== expected) {
        logger.error('album export aborted: a stored file is not what its digest says', {
          eventId,
          row,
        })
        throw DomainError.unexpected('export.corrupt')
      }
      manifest.push({ digest, name: manifestName(entry) })
      listed?.()
    })(),
  })

  /**
   * One row's bytes, or `null` when the file is not there.
   *
   * One call says both: `openRead` answers `null` for a missing file instead of throwing, and the
   * `archiver` adapter streams the bytes without knowing their length, so there is nothing to ask
   * the store beforehand. A file the retention purge removed while a host is downloading is simply
   * absent when its turn comes.
   */
  const open = (_photo: Photo, hash: ContentHash, variant: ServedVariant) =>
    media.openRead(eventId, hash, variant)

  const photoEntries = albumEntries({
    photos,
    eventId,
    slug,
    statuses: ALBUM_STATUSES,
    open,
    skipped: (photo) => {
      missing += 1
      logger.warn('album export skipped a photo with no stored file', {
        eventId,
        photoId: photo.id,
      })
    },
    decorate: (entry, { photo, hash, variant }) =>
      hashed(entry, digestVouchesForVariant(photo.kind, variant) ? hash.value : null, photo.id),
  })

  /** The book, as one entry, or nothing when no message is in the album. */
  const guestbookEntry = async (): Promise<ArchiveEntry | null> => {
    // Written messages only: a voice message has its own block in this file and its own file in
    // the archive, which a later change brings (spec 25, PR 5). Until then it is not listed here.
    const entries = await guestbook.listWrittenByStatuses(
      eventId,
      GUESTBOOK_ALBUM_STATUSES,
      MAX_ENTRIES_PER_EVENT,
    )
    if (entries.length === 0) return null
    const names = await guests.findNamesByIds(eventId, [
      ...new Set(entries.map((entry) => entry.guestId)),
    ])
    const text = renderGuestbookText(
      event.name.value,
      entries.map((entry) => ({
        author: names.get(entry.guestId) ?? null,
        at: entry.createdAt,
        text: entry.text.value,
      })),
    )
    return hashed(
      {
        name: `${slug}/guestbook.txt`,
        bytes: oneChunk(new TextEncoder().encode(text)),
        modifiedAt: new Date(Math.max(...entries.map((entry) => entry.createdAt.getTime()))),
      },
      null,
      'guestbook',
      () => {
        guestbookWritten = true
      },
    )
  }

  const everything = async function* (): AsyncIterable<ArchiveEntry> {
    yield* photoEntries
    const book = await guestbookEntry()
    if (book !== null) yield book
    // Last, because it lists what went by and counts what did not.
    yield {
      name: `${slug}/${MANIFEST_NAME}`,
      bytes: oneChunk(new TextEncoder().encode(renderManifest(manifest, missing))),
      modifiedAt: clock.now(),
    }
  }

  return {
    entries: everything(),
    report: () => ({
      written: manifest.length,
      photos: manifest.length - (guestbookWritten ? 1 : 0),
      missing,
    }),
  }
}
