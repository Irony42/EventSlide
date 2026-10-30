import type { ContentHash } from '../../../domain/photos/contentHash'
import type { Photo } from '../../../domain/photos/photo'
import type { EventId } from '../../../domain/shared/ids'
import type { Clock } from '../../ports/clock'
import { SERVED_VARIANTS, type MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * How long bytes are treated as somebody's work in progress rather than as an orphan.
 *
 * **The same rule `sweepOrphanedMedia` applies, at the other site that deletes by
 * digest**, and it is here for the same reason: every write path in the product is bytes
 * first, row second, so there is always a window in which a file is on the disk and the
 * row naming it has not committed. A check against the table cannot see inside that
 * window — the row is not there to be found — so age is the only evidence there is.
 *
 * The number is smaller than the sweep's (`MEDIA_SWEEP_MIN_AGE_MS`, fifteen minutes)
 * because the two cover different gaps. The sweep has to survive any write path on a box
 * that may be swapping; this one only has to cover another clip's `media.put` of a poster
 * and the `photos.save` that follows it — two awaits in `transcodeNextClip`, milliseconds
 * on a healthy box and seconds on a bad one.
 *
 * The cost of being generous is a leak the sweep collects; the cost of being mean is a
 * clip on the wall whose poster is a broken tile, permanently, because nothing in the
 * product rebuilds one. That is the whole of the trade.
 */
const CONCURRENT_WRITE_GRACE_MS = 60_000

export interface RemovePhotoRecordDeps {
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly clock: Clock
}

/**
 * Take one photograph or clip out of an event: its bytes, then its row.
 *
 * The one implementation shared by `deletePhoto` (a host, or a guest inside the grace window)
 * and `eraseGuestContribution` (a guest taking back everything), so the two cannot disagree
 * about which files are theirs to delete. Permission is the caller's business; this only
 * knows how to remove without leaving an orphan and without taking a neighbour's bytes.
 */
export interface RemoveOptions {
  /**
   * Skip the recency guard. For the author erasing their own clip: the poster was written
   * moments before the row, by this very guest, and the guard exists for **another** writer's
   * uncommitted bytes. Committed holders are still asked (`findIdsReferencing`), so a poster
   * another clip's row names survives either way.
   */
  readonly ignoreRecency?: boolean
}

export type RemovePhotoRecord = (
  eventId: EventId,
  photo: Photo,
  options?: RemoveOptions,
) => Promise<void>

export const makeRemovePhotoRecord =
  ({ photos, media, clock }: RemovePhotoRecordDeps): RemovePhotoRecord =>
  async (eventId, photo, options = {}) => {
    const photoId = photo.id

    // Media first: the row is the only record of the file's address, so removing it
    // first would strand bytes nobody can name — neither this use case nor the
    // retention purge could ever find them again. A crash between the two leaves a row
    // whose file is gone, which the media endpoint already answers as a 404.
    //
    // **Every digest the row owns, not just `contentHash`.** A clip owns two: the mp4
    // under its own and the poster under a second, because the store's invariant is that
    // a file's name is that file's hash. Deleting `contentHash` alone removed the video
    // and left the poster behind on every guest self-delete and every host delete.
    //
    // **And only the digests nothing else names.** The same reasoning as the unwind in
    // `uploadPhotos`: the store is content-addressed, so a file belongs to whatever
    // hashes to it. `contentHash` is protected by a unique index and cannot be shared,
    // but a **poster** can be and routinely is — it is a deterministic 640-max-edge JPEG
    // of a frame taken one second in, or the midpoint of a shorter clip, so two clips
    // whose opening second looks the same produce identical bytes. A clip's `thumbUrl`
    // and `displayUrl` both point at it, so deleting clip A without asking turned clip B
    // into a broken tile on the wall, in the grid and in the album, while its mp4 still
    // played.
    //
    // **And the age check the sweep makes, for the holder that cannot be read yet.**
    // `findIdsReferencing` answers about rows that exist. Clip B writing its poster and
    // inserting its row is two operations, and between them nothing in the database names
    // those bytes — so a clip A deleted in that window was told the poster was
    // unreferenced, unlinked it, and B committed pointing at a file that is gone. There
    // is no repair: `sweepOrphanedMedia` only deletes, and no path rebuilds a poster.
    // Recency is the only evidence of a writer that has not committed, which is why the
    // collector refuses to collect anything recent and why this refuses to delete it.
    const collectableBefore = clock.now().getTime() - CONCURRENT_WRITE_GRACE_MS

    /** Both rules, asked with nothing between them and the unlink. */
    const isOursAlone = async (hash: ContentHash): Promise<boolean> => {
      const holders = await photos.findIdsReferencing(eventId, hash)
      // This row is still in the table — media goes first, deliberately — so its own id
      // is expected here and is not a reason to keep the file.
      if (holders.some((holder) => holder !== photoId)) return false

      for (const variant of SERVED_VARIANTS) {
        if (!photo.hasVariant(variant)) continue
        if (photo.hashFor(variant).value !== hash.value) continue
        const object = await media.stat(eventId, hash, variant)
        if (
          options.ignoreRecency !== true &&
          object !== null &&
          object.modifiedAt.getTime() > collectableBefore
        ) {
          return false
        }
      }
      return true
    }

    for (const hash of photo.storageHashes) {
      if (await isOursAlone(hash)) await media.delete(eventId, hash)
    }
    await photos.delete(eventId, photoId)
  }
