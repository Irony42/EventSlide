import { estimateExportBytes } from '../../../domain/exports/exportCaps'
import type { EventId } from '../../../domain/shared/ids'
import type { GuestbookVoiceRepository } from '../../ports/guestbookVoiceRepository'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * What an archive of this album will weigh, estimated before a byte is written (spec 22, section 9),
 * **voice messages included** (spec 25, section 8).
 *
 * One function for the three places that judge `export.tooLarge` and `export.noRoom` on it (the
 * host's request, the box's own build and the copy to a folder), because a recording is a file of
 * the archive like a photograph and a loop that left it out would accept an archive that does not
 * fit. The recordings add their stored bytes (the `ready` outputs: what the archive carries) and
 * one zip entry each. A recording kept secret is counted too: the estimate is conservative, and
 * refusing early is cheap.
 */

export interface AlbumEstimateSource {
  readonly photos: Pick<PhotoRepository, 'totalBytes'>
  readonly voices: Pick<GuestbookVoiceRepository, 'totalBytes' | 'countReady'>
}

/** `rows` is the album's photographs and clips: the recordings are counted here. */
export const albumEstimateOf = async (
  { photos, voices }: AlbumEstimateSource,
  eventId: EventId,
  rows: number,
): Promise<number> =>
  estimateExportBytes(
    (await photos.totalBytes(eventId)) + (await voices.totalBytes(eventId)),
    rows + (await voices.countReady(eventId)),
  )
