import type { Event } from '../../../domain/events/event'
import { isVoiceOpen } from '../../../domain/events/eventGuestbookVoiceSettings'
import {
  isVoiceMessage,
  isWritten,
  type GuestbookEntry,
  type VoiceGuestbookEntry,
} from '../../../domain/guestbook/guestbookEntry'
import {
  renderGuestbookText,
  type GuestbookExportLine,
} from '../../../domain/guestbook/guestbookExport'
import type { VoiceOutput } from '../../../domain/guestbook/guestbookVoice'
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
import { digestVouchesForVariant, voiceDigestVouches } from '../../../domain/photos/storedDigest'
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
 * The entries of the host's album archive: the photographs and clips, the voice messages,
 * `guestbook.txt` and, last, `MANIFEST.sha256`. **One loop for the two ways the archive is made**: the ZIP streamed to the
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
 * **The voice messages (spec 25)** come after the photographs and before `guestbook.txt`, which
 * refers to them: one file per voice message that is `ready` and in the album (`isInAlbum`, the
 * photographs' predicate, so a refused one is out and an operator takedown never is), as
 * `voice/0001-<digest>.m4a`, named by a counter, a digest and the validated slug and never by
 * anything a guest sent. **Kept secret, a voice is not in the archive** (`isVoiceOpen`): unzipping
 * it would otherwise lift a secret the console keeps, so `guestbook.txt` says how many were left out
 * and nothing else about them. Unlike a photograph's, a voice's digest is over the very file it
 * names (`voiceDigestVouches`), so a recording that is not what its digest says aborts the stream
 * like a clip does.
 *
 * Nothing is materialised: rows arrive a page at a time, bytes a chunk at a time.
 */

/** Asked of the domain once, rather than restated as a list of statuses. */
export const ALBUM_STATUSES: readonly PhotoStatus[] = PHOTO_STATUSES.filter(isInAlbum)

/** The guestbook's messages follow the same rule as the photographs: the same predicate. */
const GUESTBOOK_ALBUM_STATUSES = ALBUM_STATUSES

/** The recordings' extension in the archive: what `mediaLayout` stores (`audio/mp4`). */
const VOICE_EXTENSION = 'm4a'

/** The digest a file is held against, or `null` where the digest does not vouch for the bytes. */
const heldAgainst = (vouches: boolean, digest: string): string | null => (vouches ? digest : null)

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
  /** Files written, the guestbook and the voice messages included and the manifest not. */
  readonly written: number
  /** Of those, the photographs and clips: one per row of the album that had its file. */
  readonly photos: number
  /** Of those, the voice messages. Not photographs: the album's photograph count stays exact. */
  readonly voices: number
  /** Rows of the album whose file was not on the disk, photographs and voice messages together. */
  readonly missing: number
  /** Of those, the photographs and clips: what the album's row count is held against. */
  readonly missingPhotos: number
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
  let missingVoices = 0
  let voicesWritten = 0
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
      hashed(
        entry,
        heldAgainst(digestVouchesForVariant(photo.kind, variant), hash.value),
        photo.id,
      ),
  })

  /**
   * What the album's guestbook holds, read once: every message `isInAlbum` accepts, written ones
   * and voice messages together and oldest first. A voice whose processing has not finished is not
   * in the album yet (nobody can listen to it, so nobody can have decided on it) and a failed one is
   * not listed by the repository at all.
   */
  let album: Promise<readonly GuestbookEntry[]> | null = null
  const albumBook = (): Promise<readonly GuestbookEntry[]> => {
    album ??= guestbook.listByStatuses(eventId, GUESTBOOK_ALBUM_STATUSES, MAX_ENTRIES_PER_EVENT)
    return album
  }

  /** A recording the album may carry: the entry and what the box stored for it. */
  interface Recording {
    readonly entry: VoiceGuestbookEntry
    readonly output: VoiceOutput
  }

  /** The recordings that are `ready`, oldest first: the only ones that can be heard or archived. */
  const readyRecordings = async (): Promise<readonly Recording[]> =>
    (await albumBook()).flatMap((entry) => {
      if (!isVoiceMessage(entry)) return []
      const output = entry.voice.output()
      return output === null ? [] : [{ entry, output }]
    })
  /**
   * The recordings that went by, with the file each is archived as, or `null` when the disk had
   * lost it: what `guestbook.txt` says about each. Filled while the recordings are walked, which is
   * before the book is written, and left empty while the secret holds.
   */
  const walked: { readonly recording: Recording; readonly file: string | null }[] = []
  let sealedVoices = 0

  /**
   * The recordings, one entry each, **while the secret is lifted**; otherwise none and a count.
   * Asked at the instant the walk reaches them, with the injected clock, so an opening that
   * happens while a long archive is written is seen by the entries that follow it.
   */
  const voiceEntries = async function* (): AsyncIterable<ArchiveEntry> {
    const recordings = await readyRecordings()
    if (!isVoiceOpen(event.settings.guestbookVoice, event, clock.now())) {
      sealedVoices = recordings.length
      return
    }
    let sequence = 0
    for (const recording of recordings) {
      const { entry, output } = recording
      const bytes = await media.openRead(eventId, output.hash, 'voice')
      if (bytes === null) {
        // A recording the disk lost: skipped and counted, never fatal (headers are long gone).
        missing += 1
        missingVoices += 1
        walked.push({ recording, file: null })
        logger.warn('album export skipped a voice message with no stored file', {
          eventId,
          entryId: entry.id,
        })
        continue
      }
      sequence += 1
      const file = `voice/${String(sequence).padStart(4, '0')}-${output.hash.short}.${VOICE_EXTENSION}`
      walked.push({ recording, file })
      yield hashed(
        { name: `${slug}/${file}`, bytes, modifiedAt: entry.createdAt },
        heldAgainst(voiceDigestVouches(), output.hash.value),
        entry.id,
        () => {
          voicesWritten += 1
        },
      )
    }
  }

  /** The book, as one entry, or nothing when no message is in the album and none is kept secret. */
  const guestbookEntry = async (): Promise<ArchiveEntry | null> => {
    const written = (await albumBook()).filter(isWritten)
    if (written.length === 0 && walked.length === 0 && sealedVoices === 0) return null
    const names = await guests.findNamesByIds(eventId, [
      ...new Set([
        ...written.map((entry) => entry.guestId),
        ...walked.map(({ recording }) => recording.entry.guestId),
      ]),
    ])
    // A recording kept secret has no line, only the count at the end; one the disk lost has a line
    // that says so. The two kinds are interleaved by when they were written.
    const lines: GuestbookExportLine[] = [
      ...written.map((entry) => ({
        author: names.get(entry.guestId) ?? null,
        at: entry.createdAt,
        text: entry.text.value,
      })),
      ...walked.map(({ recording, file }) => ({
        author: names.get(recording.entry.guestId) ?? null,
        at: recording.entry.createdAt,
        voice: {
          durationMs: recording.output.durationMs,
          file,
          caption: recording.entry.voice.caption?.value ?? null,
        },
      })),
    ].sort((left, right) => left.at.getTime() - right.at.getTime())
    const text = renderGuestbookText(event.name.value, lines, sealedVoices)
    return hashed(
      {
        name: `${slug}/guestbook.txt`,
        bytes: oneChunk(new TextEncoder().encode(text)),
        // A book of secret voices alone is dated by the box's clock: it says when it was written.
        modifiedAt:
          lines.length === 0
            ? clock.now()
            : new Date(Math.max(...lines.map((line) => line.at.getTime()))),
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
    yield* voiceEntries()
    const guestbookFile = await guestbookEntry()
    if (guestbookFile !== null) yield guestbookFile
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
      photos: manifest.length - voicesWritten - (guestbookWritten ? 1 : 0),
      voices: voicesWritten,
      missing,
      missingPhotos: missing - missingVoices,
    }),
  }
}
