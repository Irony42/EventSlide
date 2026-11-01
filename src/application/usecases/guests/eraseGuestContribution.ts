import { holdsStagedBytes } from '../../../domain/clips/clipJobStatus'
import type { Photo } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReactionRepository } from '../../ports/reactionRepository'
import type { InvalidateReel } from '../highlights/invalidateReel'
import { makeRemovePhotoRecord } from '../photos/removePhotoRecord'

/**
 * "Delete everything I sent": a guest erasing their own contribution to one event
 * (roadmap §5.2, GDPR art. 17 in practice).
 *
 * **What goes**: every photograph and clip they sent (the files in every rendition, the
 * thumbnails, the rows, the caption and the moderation decision that live on the row), every
 * clip still waiting to be transcoded together with its staged source, every reaction they
 * left on anybody's photograph, and finally the guest row itself, which is where their
 * display name and their device identity live. The phone's token stops verifying (the row is
 * gone), so the guest is a stranger to the event again and can only come back by scanning
 * the code.
 *
 * **What it deliberately ignores**: the moderation state, the self-delete switch
 * (`allowGuestSelfDelete`) and its grace window. Those decide whether a guest may take back
 * **one** photograph the host may already have approved; the right to erasure is not the
 * host's to switch off, and a photo that is on the wall is exactly the one a guest most
 * needs to be able to withdraw. Nor does it look at the event's lifecycle: a closed or
 * archived event is the most likely time somebody asks, and erasing is not uploading.
 *
 * **What it cannot reach**, and the guest-facing copy says so: a copy the host already
 * exported (`exportAlbum` streams an archive and keeps nothing), a screenshot, a download
 * from the shared gallery link, and the hourly backup, which holds a deleted photograph for
 * at most the retention the privacy notice states. There is no audit line: the audit log is
 * about accounts and clients and is content-free by construction (`auditAction.ts`), and a
 * guest has no account to attribute it to.
 *
 * **Ownership is the token, not the URL.** The route has no guest id in its path (`/guests/me`),
 * so there is nobody else to name: `guestId` is the one `requireGuest` proved. Everything is
 * scoped by `eventId`, so the same guest id at another event is not reached.
 *
 * **Order.** Bytes, then rows, photograph by photograph (`removePhotoRecord`: the row is the
 * only record of the file's address, so it goes last), then the staged clips, the reactions
 * and the guest row. Retryable: if the process dies half way the guest row is still there,
 * the token still verifies, and pressing the button again finishes the job. A clip being
 * transcoded at that very moment finishes against a row that is gone, which the worker
 * already treats as "retired under me" (`transcodeNextClip.finish`) and the final sweep removes whatever it inserted.
 */

export interface EraseGuestContributionInput {
  readonly eventId: EventId
  /** The guest the device token proves, never one a request names. */
  readonly guestId: GuestId
}

/** What was removed, so the phone can say it in plain words. */
export interface ErasedContribution {
  readonly photos: number
  readonly clips: number
}

export interface EraseGuestContributionDeps {
  readonly events: EventRepository
  readonly guests: GuestRepository
  readonly photos: PhotoRepository
  readonly reactions: ReactionRepository
  readonly clips: ClipJobRepository
  readonly media: MediaStore
  readonly bus: EventBus
  readonly clock: Clock
  /**
   * Retires the highlight reel that holds any of this guest's photographs (spec 08): one call
   * with all of them, before anything is removed and before the guest's row goes.
   */
  readonly invalidateReel?: InvalidateReel
}

export type EraseGuestContribution = (
  input: EraseGuestContributionInput,
) => Promise<Result<ErasedContribution, DomainError>>

/** Rows read per page: a guest with a few hundred photographs is an ordinary wedding. */
const PAGE_SIZE = 200

export const makeEraseGuestContribution = ({
  events,
  guests,
  photos,
  reactions,
  clips,
  media,
  bus,
  clock,
  invalidateReel,
}: EraseGuestContributionDeps): EraseGuestContribution => {
  const removePhotoRecord = makeRemovePhotoRecord({ photos, media, clock })

  /** Every photograph and clip the guest sent, whatever its status, read before any is removed. */
  const authoredBy = async (eventId: EventId, guestId: GuestId): Promise<readonly Photo[]> => {
    const found: Photo[] = []
    let cursor: string | undefined
    do {
      const page = await photos.list(eventId, {
        authoredBy: guestId,
        limit: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      })
      found.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor !== undefined)
    return found
  }

  return async ({ eventId, guestId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const guest = await guests.findById(eventId, guestId)
    if (guest === null) return err(DomainError.notFound('guest.notFound'))

    // A held event keeps everything it has, a guest's own photographs included (launch review S5).
    // The same generic failure `deletePhoto` answers, so the host is not told there is a hold.
    if (event.isPurgeHeld()) return err(DomainError.unexpected('photo.deleteFailed'))

    let erasedPhotos = 0
    let erasedClips = 0
    const removeAll = async (): Promise<void> => {
      for (const photo of await authoredBy(eventId, guestId)) {
        await removePhotoRecord(eventId, photo, { guardPosterOnly: true })
        bus.publish({ type: 'photo.deleted', eventId, photoId: photo.id })

        if (photo.kind === 'clip') erasedClips += 1
        else erasedPhotos += 1
      }
    }
    // One call, for every photograph of this guest, before anything is removed (spec 08): a montage
    // holding any of them stops being served first, and the guest's row is still there.
    await invalidateReel?.(
      eventId,
      (await authoredBy(eventId, guestId)).map((photo) => photo.id),
    )
    await removeAll()

    // Clips with no photograph yet: reserved, queued or running. Their staged source is the
    // guest's own video on the disk and nothing else names it, so it goes before the row that
    // holds its digest in the dedupe index.
    for (const job of await clips.listByAuthor(eventId, guestId)) {
      if (holdsStagedBytes(job.status)) erasedClips += 1
      // A `failed` job may still hold its source (`recoverClipJobs` abandons without unlinking), so
      // every job but a `done` one (whose bytes are long gone) is asked, unless a row names them.
      if (job.status === 'done') continue
      const holders = await photos.findIdsReferencing(eventId, job.sourceHash)
      if (holders.length === 0) await media.delete(eventId, job.sourceHash)
    }
    // Every job of the guest, `done` ones included: a `done` job blocks a re-upload of the same bytes.
    await clips.deleteForAuthor(eventId, guestId)

    await reactions.deleteByGuest(eventId, guestId)

    // **Again, immediately before the guest row goes.** The first pass is a snapshot, and a transcode
    // or upload of this guest's that was in flight inserts its row while the guest row still exists;
    // deleting the guest first would cascade that row away and leave its files on the disk with no
    // row to name them. With the jobs retired nothing new starts, so this sweep catches what landed.
    // What lands in the instant between this read and the delete is not refused by anything: its
    // files are orphans, which `sweepOrphanedMedia` collects after its minimum age.
    await removeAll()
    // A photograph the operator took down is evidence: every read above skipped it, so it was neither
    // deleted nor counted. Its row hangs from the guest row by a cascading foreign key, so the guest
    // row stays, without its name, until the operator puts the photograph back or the event is purged.
    if ((await photos.countTakenDownBy(eventId, guestId)) > 0) {
      await guests.save(guest.withoutName())
    } else {
      await guests.delete(eventId, guestId)
    }

    // One signal for what no `photo.deleted` says: the name on the wall, a heart on someone
    // else's photograph, a guest on the host's list. Every open screen re-reads on it.
    bus.publish({ type: 'guest.erased', eventId, guestId })

    return ok({ photos: erasedPhotos, clips: erasedClips })
  }
}
