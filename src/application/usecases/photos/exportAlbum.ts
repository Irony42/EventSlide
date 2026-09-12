import type { Photo } from '../../../domain/photos/photo'
import { isInAlbum, PHOTO_STATUSES, type PhotoStatus } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'

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
 * **Nothing is materialised.** Rows arrive one at a time from the repository, bytes one
 * chunk at a time from the media store, and the archive is emitted as chunks. A
 * four-thousand-photo wedding is several gigabytes; buffering it is how a self-hosted
 * box with 2 GB of RAM dies at 80% of a download.
 */

/** Full quality: the point of the export is that the host keeps their photos. */
const ALBUM_VARIANT = 'original'

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
     * Both the size and the stream, or `null` when the file is not there.
     *
     * The archive needs the size up front to write an entry without buffering it, and
     * the two calls are separate, so the file can legitimately disappear between them:
     * the retention purge is allowed to run while a host is downloading.
     */
    const open = async (photo: Photo): Promise<Omit<ArchiveEntry, 'name'> | null> => {
      const metadata = await media.stat(eventId, photo.contentHash, ALBUM_VARIANT)
      if (metadata === null) return null

      const bytes = await media.openRead(eventId, photo.contentHash, ALBUM_VARIANT)
      if (bytes === null) return null

      return { bytes, byteSize: metadata.byteSize, modifiedAt: photo.createdAt }
    }

    const entries = async function* (): AsyncIterable<ArchiveEntry> {
      let sequence = 0
      for await (const photo of photos.streamForExport(eventId, ALBUM_STATUSES)) {
        const opened = await open(photo)
        if (opened === null) {
          // Skipped rather than fatal: headers are long since sent by the time an entry
          // is read, so one orphaned row must not abort a multi-gigabyte download.
          logger.warn('album export skipped a photo with no stored original', {
            eventId,
            photoId: photo.id,
          })
          continue
        }

        sequence += 1
        // Server-generated throughout — a counter, the digest's first characters and a
        // validated slug. No guest-supplied filename reaches the archive, so no entry
        // name can carry a path.
        const name = `${event.slug.value}/${String(sequence).padStart(4, '0')}-${
          photo.contentHash.short
        }.jpg`
        yield { name, ...opened }
      }
    }

    return ok(archive.stream(entries()))
  }
}
