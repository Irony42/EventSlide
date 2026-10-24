import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import type { Photo } from '../../../domain/photos/photo'
import { isInAlbum, PHOTO_STATUSES, type PhotoStatus } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ArchiveWriter } from '../../ports/archiveWriter'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import { albumEntries } from '../shared/albumEntries'

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
 * photograph is archived as its stored `original` and a clip as its transcode, the same
 * full-quality file the shared gallery's download serves, from the same table
 * (`albumEntries`). The host's ZIP used to ask every row for an `original`, which a clip
 * does not have, and skipped every one of them with a warning.
 *
 * **Nothing is materialised.** Rows arrive a page at a time from the repository, bytes one
 * chunk at a time from the media store, and the archive is emitted as chunks. A
 * four-thousand-photo wedding is several gigabytes; buffering it is how a self-hosted
 * box with 2 GB of RAM dies at 80% of a download.
 */

/** Asked of the domain once, rather than restated as a list of statuses. */
const ALBUM_STATUSES: readonly PhotoStatus[] = PHOTO_STATUSES.filter(isInAlbum)

export interface ExportAlbumInput {
  readonly eventId: EventId
}

export interface ExportAlbumDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly archive: ArchiveWriter
  readonly logger: Logger
}

export type ExportAlbum = (
  input: ExportAlbumInput,
) => Promise<Result<AsyncIterable<Uint8Array>, DomainError>>

export const makeExportAlbum = ({
  events,
  photos,
  media,
  archive,
  logger,
}: ExportAlbumDeps): ExportAlbum => {
  return async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    /**
     * One row's bytes, or `null` when the file is not there.
     *
     * One call says both: `openRead` answers `null` for a missing file instead of throwing,
     * and the `archiver` adapter streams the bytes without knowing their length, so there is
     * nothing to ask the store beforehand. A file the retention purge removed while a host
     * is downloading is simply absent when its turn comes.
     */
    const open = (_photo: Photo, hash: ContentHash, variant: ServedVariant) =>
      media.openRead(eventId, hash, variant)

    return ok(
      archive.stream(
        albumEntries({
          photos,
          eventId,
          slug: event.slug.value,
          statuses: ALBUM_STATUSES,
          open,
          skipped: (photo) => {
            logger.warn('album export skipped a photo with no stored file', {
              eventId,
              photoId: photo.id,
            })
          },
        }),
      ),
    )
  }
}
