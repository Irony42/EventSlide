import type { EventId } from '../../../domain/shared/ids'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { MediaStore } from '../../ports/mediaStore'

/**
 * The retention job: delete the events whose retention deadline has passed.
 *
 * There is no actor and no authorization. This is the scheduler, not a host, which is
 * why it is a separate use case from `purgeEvent` rather than a loop over it — an
 * owner check would have to be faked with an owner who never asked.
 *
 * The deadline itself is the entity's arithmetic (`Event.isDueForPurge`), reached
 * through the repository, so "keep the album forever" — the default — is honoured in
 * one place.
 */

export interface PurgeExpiredEventsReport {
  readonly purged: readonly EventId[]
  /** Left on disk for the next run. An operator needs the ids to know what to look at. */
  readonly failed: readonly EventId[]
}

export interface PurgeExpiredEventsDeps {
  readonly events: EventRepository
  readonly media: MediaStore
  readonly clock: Clock
}

/**
 * Not a `Result`. A failure on one event is data the operator needs, not the job's
 * outcome: the sweep has done its work once it has tried every candidate, and a job
 * that reported a whole-run error because one disk was busy would stop purging the
 * other forty.
 */
export type PurgeExpiredEvents = () => Promise<PurgeExpiredEventsReport>

export const makePurgeExpiredEvents =
  ({ events, media, clock }: PurgeExpiredEventsDeps): PurgeExpiredEvents =>
  async () => {
    const due = await events.listDueForPurge(clock.now())

    const purged: EventId[] = []
    const failed: EventId[] = []

    // Sequentially, on purpose. This runs on the same box that may be serving a live
    // event, and forty concurrent recursive directory deletions would take the disk
    // away from the party in progress.
    for (const event of due) {
      try {
        // Media first, row second — same reason as `purgeEvent`: the row is the only
        // record that these bytes exist, so it is what must outlive a failure.
        await media.deleteEvent(event.id)
        await events.delete(event.id)
        purged.push(event.id)
      } catch {
        failed.push(event.id)
      }
    }

    return { purged, failed }
  }
