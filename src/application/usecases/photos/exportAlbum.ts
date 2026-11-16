import { exportAllowed } from '../../../domain/clients/exportAllowed'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ArchiveWriter } from '../../ports/archiveWriter'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { StreamHasher } from '../../ports/streamHasher'
import { albumArchiveOf } from '../shared/albumArchive'

/**
 * The album a host downloads after the event, as a ZIP.
 *
 * Two properties matter more than anything else here.
 *
 * **What is in it.** Only the statuses `isInAlbum` accepts — published and hidden. 1.0's
 * download shipped every row regardless of status, so a host who had carefully rejected
 * a photo handed it out anyway in the archive. The predicate lives in the domain and is
 * asked, never reimplemented as a status list here.
 *
 * **Clips are in it.** A host who exports and then purges must not lose their videos. A
 * photograph is archived as its stored `original` and a clip as its transcode (the picture
 * and the sound; a clip's upload is never kept), the same file the shared gallery's download
 * serves, from the same table
 * (`albumEntries`). The host's ZIP used to ask every row for an `original`, which a clip
 * does not have, and skipped every one of them with a warning.
 *
 * **The guestbook is in it** (spec 01): one `guestbook.txt` of the messages `isInAlbum` accepts,
 * published and hidden, signed with the guest's first name. It is the host's archive only: the shared
 * gallery shows photographs and stays as it is. A book holds at most 500 short messages, so it is
 * read in one go and written as one entry after the photographs.
 *
 * **A manifest closes it** (spec 22): `MANIFEST.sha256`, the last entry, one line per file in the
 * format `sha256sum -c` reads, and a comment line saying how many rows had no file on the disk. The
 * host can check the archive at home without trusting us, and a ZIP that is short of photographs
 * says so. Each file is hashed **as it passes**, one chunk at a time.
 *
 * **A file that is not what its digest says aborts the stream** (`export.corrupt`) rather than being
 * handed over. It can only be checked where the digest vouches for the bytes (`storedDigest`): a
 * photograph's digest is taken over its *display* rendition, so its `original` is listed in the
 * manifest but cannot be held against the name; a clip's two files can.
 *
 * **Who may** is `exportAllowed`, one function for every path that hands the album over: a client
 * being offboarded may export despite the suspension that comes with it, a suspension on its own
 * still refuses, and an event the operator took down is never there.
 *
 * **Nothing is materialised.** Rows arrive a page at a time from the repository, bytes one
 * chunk at a time from the media store, and the archive is emitted as chunks. A
 * four-thousand-photo wedding is several gigabytes; buffering it is how a self-hosted
 * box with 2 GB of RAM dies at 80% of a download.
 */

export interface ExportAlbumInput {
  readonly eventId: EventId
}

export interface ExportAlbumDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly guestbook: GuestbookRepository
  readonly guests: GuestRepository
  readonly media: MediaStore
  readonly archive: ArchiveWriter
  /** Only the client of a suspended event is read, for `exportAllowed`. */
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly streamHasher: StreamHasher
  /** The manifest's own modification time. */
  readonly clock: Clock
  readonly logger: Logger
}

export type ExportAlbum = (
  input: ExportAlbumInput,
) => Promise<Result<AsyncIterable<Uint8Array>, DomainError>>

export const makeExportAlbum = ({
  events,
  photos,
  guestbook,
  guests,
  media,
  archive,
  clients,
  streamHasher,
  clock,
  logger,
}: ExportAlbumDeps): ExportAlbum => {
  return async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // The client is read only when it can change the answer: a suspended client's event.
    const client =
      event.isClientSuspended() && event.clientId !== null
        ? await clients.findById(event.clientId)
        : null
    const allowed = exportAllowed(event, client)
    if (!allowed.ok) return allowed

    // The entries are the same loop the box's own verified archive is written from.
    const { entries } = albumArchiveOf(
      { photos, guestbook, guests, media, streamHasher, clock, logger },
      event,
    )

    return ok(archive.stream(entries))
  }
}
