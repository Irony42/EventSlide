import type { ArchiveState } from '../../../domain/clients/archiveState'
import type { EventId } from '../../../domain/shared/ids'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { BookFileStore } from '../../ports/bookFileStore'
import type { MediaStore } from '../../ports/mediaStore'

/**
 * The retention job: delete the events whose retention deadline has passed.
 *
 * There is no actor and no authorization. This is the scheduler, not a host, which is
 * why it is a separate use case from `purgeEvent` rather than a loop over it — an
 * owner check would have to be faked with an owner who never asked.
 *
 * The deadline itself is `purgeDeadline`, reached through the repository, so "keep the
 * album forever" — the default — is honoured in one place. For an event that belongs to a
 * client it also answers to that client's ceilings: an album kept "for ever" under a
 * retention ceiling is purged at the ceiling, and a ceiling lowered recently is given
 * {@link PurgeExpiredEventsDeps.capNoticeDays} days' notice first.
 */

export interface PurgeExpiredEventsReport {
  readonly purged: readonly EventId[]
  /** Left on disk for the next run. An operator needs the ids to know what to look at. */
  readonly failed: readonly EventId[]
  /**
   * What the box held for each purged album (spec 22, section 8), read **before** the row went.
   * The purge never waits for an archive and never looks at one to decide: this is only what the log
   * says afterwards, `archive=…`, so that "the album left and nobody had taken it" has a trace.
   */
  readonly archives: Readonly<Record<string, ArchiveState>>
}

export interface PurgeExpiredEventsDeps {
  readonly events: EventRepository
  readonly media: MediaStore
  readonly clock: Clock
  /**
   * `RETENTION_CAP_NOTICE_DAYS`. Meaningful only for an event that belongs to a client whose
   * retention ceiling was lowered; on a box with no clients it is read and changes nothing.
   */
  readonly capNoticeDays: number
  /** The photo book's PDF, outside the event's folder (spec 04): deleted explicitly. */
  readonly bookFiles?: Pick<BookFileStore, 'delete'>
  /**
   * What the box holds for an event, for the log only. Absent, every album is `none`: there is
   * nothing prepared on a box that does not prepare archives. It must not throw; if it does, the
   * album is reported `none` and purged all the same, because the date promised to the guests
   * does not move.
   */
  readonly archiveStateOf?: (eventId: EventId) => Promise<ArchiveState>
}

/**
 * Not a `Result`. A failure on one event is data the operator needs, not the job's
 * outcome: the sweep has done its work once it has tried every candidate, and a job
 * that reported a whole-run error because one disk was busy would stop purging the
 * other forty.
 */
export type PurgeExpiredEvents = () => Promise<PurgeExpiredEventsReport>

export const makePurgeExpiredEvents =
  ({
    events,
    media,
    clock,
    capNoticeDays,
    bookFiles,
    archiveStateOf,
  }: PurgeExpiredEventsDeps): PurgeExpiredEvents =>
  async () => {
    const archiveOf = async (eventId: EventId): Promise<ArchiveState> => {
      try {
        return (await archiveStateOf?.(eventId)) ?? 'none'
      } catch {
        return 'none'
      }
    }

    const due = await events.listDueForPurge(clock.now(), { capNoticeDays })

    const purged: EventId[] = []
    const failed: EventId[] = []
    const archives: Record<string, ArchiveState> = {}

    // Sequentially, on purpose. This runs on the same box that may be serving a live
    // event, and forty concurrent recursive directory deletions would take the disk
    // away from the party in progress.
    for (const event of due) {
      try {
        // What the box holds for it, for the log, read before the row goes (the row's deletion
        // cascades to whatever describes an archive) and never allowed to stop the purge.
        const archive = await archiveOf(event.id)
        // **The row first, conditionally, then the bytes** (launch review S5). The listing above
        // is a snapshot, and the operator may hold this event's purge after it was taken: the
        // delete refuses a held row in the same statement, and the bytes are only touched once it
        // has answered `true`, so the files of a held event can never be removed, whatever
        // happened since. A failure of the second step leaves bytes with no row, which
        // `sweepOrphanedMedia` collects once they are old enough; it is reported as failed.
        if (!(await events.deleteUnlessHeld(event.id))) continue
        await bookFiles?.delete(event.id).catch(() => undefined)
        try {
          await media.deleteEvent(event.id)
        } catch {
          failed.push(event.id)
          continue
        }
        purged.push(event.id)
        archives[event.id] = archive
      } catch {
        failed.push(event.id)
      }
    }

    return { purged, failed, archives }
  }
