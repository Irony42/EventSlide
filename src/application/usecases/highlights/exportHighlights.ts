import type { ContentHash } from '../../../domain/photos/contentHash'
import type { ServedVariant } from '../../../domain/photos/mediaVariant'
import type { Photo } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ArchiveWriter } from '../../ports/archiveWriter'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import { albumEntries } from '../shared/albumEntries'
import { requireReadable } from '../shared/eventRole'

/**
 * The host's favourites as a ZIP, oldest first (spec 08).
 *
 * The same streaming as the album export (`albumEntries`, one descriptor at a time), over
 * the favourites only: starred and published, which is what the repository filters on. A
 * host with no favourite is told before any header is sent (`highlight.empty`), by the same
 * count the panel shows. The folder is `<slug>-best-of`, a technical suffix, not text. An
 * archived event is still readable, as for the album; a suspended client or a taken-down
 * event is refused by `requireReadable`.
 */

export interface ExportHighlightsDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly archive: ArchiveWriter
  readonly logger: Logger
}

export type ExportHighlights = (input: {
  readonly eventId: EventId
}) => Promise<Result<AsyncIterable<Uint8Array>, DomainError>>

export const makeExportHighlights =
  ({ events, photos, media, archive, logger }: ExportHighlightsDeps): ExportHighlights =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable

    if ((await photos.countHighlighted(eventId)) === 0) {
      return err(DomainError.conflict('highlight.empty'))
    }

    const open = (_photo: Photo, hash: ContentHash, variant: ServedVariant) =>
      media.openRead(eventId, hash, variant)

    return ok(
      archive.stream(
        albumEntries({
          photos,
          eventId,
          slug: `${event.slug.value}-best-of`,
          statuses: ['published'],
          filter: { highlightedOnly: true, oldestFirst: true },
          open,
          skipped: (photo) => {
            logger.warn('best-of export skipped a photo with no stored file', {
              eventId,
              photoId: photo.id,
            })
          },
        }),
      ),
    )
  }
