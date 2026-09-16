import type { ContentHash } from '../../../domain/photos/contentHash'
import type { PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import { SERVED_VARIANTS, type MediaStore } from '../../ports/mediaStore'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { PhotoRepository } from '../../ports/photoRepository'

/**
 * Remove a photo, for a host at any time or for the guest who regrets it.
 *
 * The permission decision is `Photo.canBeDeletedBy` and is not restated here: hosts
 * always may, a guest may take back their own photo inside the grace window and only
 * while it has not reached the wall. The use case supplies the two things the entity
 * cannot know — the current time and the event's configured window — and owns the two
 * things the entity has no business owning: the event-scoped read, and the order of the
 * two deletions.
 */

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

export interface DeletePhotoInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly actor: PhotoActor
}

export interface DeletePhotoDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  /**
   * The transcode queue, because deleting a clip has to retire the job that made it.
   * A photograph's delete never touches it, and a use case is the right place for that:
   * neither repository can see the other.
   */
  readonly clips: ClipJobRepository
  readonly media: MediaStore
  readonly bus: EventBus
  readonly clock: Clock
}

export type DeletePhoto = (input: DeletePhotoInput) => Promise<Result<void, DomainError>>

export const makeDeletePhoto = ({
  events,
  photos,
  clips,
  media,
  bus,
  clock,
}: DeletePhotoDeps): DeletePhoto => {
  return async ({ eventId, photoId, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // Scoped read: passing `eventId` is what makes a photo of another event a 404
    // rather than a deletion.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    const settings = event.settings

    // The host can switch self-deletion off entirely — a wedding where the album is the
    // point, and a guest changing their mind at midnight is the host's decision to make.
    if (actor.kind === 'guest' && !settings.allowGuestSelfDelete) {
      return err(DomainError.forbidden('event.guestSelfDeleteDisabled'))
    }

    if (!photo.canBeDeletedBy(actor, clock.now(), settings.guestSelfDeleteGraceMs)) {
      return err(DomainError.forbidden('photo.deleteForbidden'))
    }

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
        if (object !== null && object.modifiedAt.getTime() > collectableBefore) return false
      }
      return true
    }

    for (const hash of photo.storageHashes) {
      if (await isOursAlone(hash)) await media.delete(eventId, hash)
    }
    await photos.delete(eventId, photoId)

    // **And the clip job that produced it, if there was one.** A `done` job blocks the
    // dedupe, so a guest who deleted their own clip by mistake and sent it again was
    // answered `duplicate: true`, `status: done`, and the id of a row that no longer
    // existed — their video never came back, and nothing in the product could bring it.
    // A no-op for a photograph, so this path does not have to know which it is holding.
    await clips.deleteForPhoto(eventId, photoId)

    bus.publish({ type: 'photo.deleted', eventId, photoId })
    return ok(undefined)
  }
}
