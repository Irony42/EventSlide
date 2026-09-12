import type { EventStatus } from '../../../domain/events/eventStatus'
import type { ScheduledTransition } from '../../../domain/events/event'
import type { EventId } from '../../../domain/shared/ids'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'

/**
 * The scheduling job: open the events that were due to open, close the ones that were
 * due to close.
 *
 * There is no actor and no authorization. This is the sweep, not a host — which is why
 * it is a separate use case from `scheduleEvent` rather than a loop over
 * `changeEventStatus`, whose owner check would have to be faked with an owner who never
 * asked for this particular transition.
 *
 * Every decision is the aggregate's: which instants have come due, whether the
 * lifecycle accepts the transition, and what happens to an instant that has been acted
 * on (`Event.applySchedule`). This orchestrates, persists and announces.
 *
 * Two properties the sweep depends on, both owned by the entity:
 *
 * - **A missed window is still honoured.** The instants are deadlines, not
 *   appointments, so the run at 18:07 opens the event that was due at 18:00.
 * - **Running it twice changes nothing.** A due instant is cleared once it has been
 *   acted on, so the second run finds no candidates at all.
 *
 * ## The concurrency this relies on, stated rather than assumed
 *
 * The loop below is a read-modify-write — `listDueForSchedule`, `applySchedule`, `save`
 * — and `EventRepository.save` writes the whole row, so a sweep working from a stale
 * snapshot would overwrite a rename or a settings change made in between. There is no
 * compare-and-set here, and that is a **decision, not an oversight**: it relies on the
 * production adapter, `SqliteEventRepository` over `better-sqlite3`, being synchronous
 * and single-process. Its `save` completes inside one tick, so no other writer in this
 * process can interleave between the read and the write, and there is no second process
 * — the deployment unit is one box (docs/ARCHITECTURE.md §10).
 *
 * That assumption is the adapter's, not the port's: `EventRepository` returns promises
 * precisely so a different implementation is allowed, and a genuinely asynchronous or
 * multi-writer one — Postgres, a replicated store, a second process running
 * `npm run purge` against the same database — would have to carry a version column and a
 * `save` that refuses on a stale one. Anyone writing that adapter has to revisit this
 * loop; that is what this paragraph is for.
 */

export interface ApplyEventSchedulesReport {
  readonly opened: readonly EventId[]
  readonly closed: readonly EventId[]
  /** Due, but the lifecycle refused — an archived event does not quietly reopen. */
  readonly refused: readonly EventId[]
  /** Could not be written. The row keeps its schedule, so the next run retries it. */
  readonly failed: readonly EventId[]
}

export interface ApplyEventSchedulesDeps {
  readonly events: EventRepository
  readonly bus: EventBus
  readonly clock: Clock
}

/**
 * Not a `Result`. A failure on one event is data the operator needs, not the job's
 * outcome: the sweep has done its work once it has tried every candidate, and a job
 * that reported a whole-run error because one write failed would leave the other
 * thirty-nine parties shut.
 */
export type ApplyEventSchedules = () => Promise<ApplyEventSchedulesReport>

/** What the bus is told a scheduled transition arrived at. */
const STATUS_AFTER: Readonly<Record<ScheduledTransition, EventStatus>> = {
  open: 'live',
  close: 'closed',
}

export const makeApplyEventSchedules =
  ({ events, bus, clock }: ApplyEventSchedulesDeps): ApplyEventSchedules =>
  async () => {
    // Read once, so every event in one pass is judged against the same instant. Two
    // events a millisecond apart being treated differently would be invisible and
    // untestable.
    const now = clock.now()
    const due = await events.listDueForSchedule(now)

    const opened: EventId[] = []
    const closed: EventId[] = []
    const refused: EventId[] = []
    const failed: EventId[] = []

    // Sequentially, like the retention sweep: this runs on the same box that may be
    // serving a live event, and the work is tiny — one row each.
    for (const event of due) {
      const outcome = event.applySchedule(now)

      try {
        // Persist first. A projector told an event is live before the row says so would
        // refetch and see it shut, and then never hear again.
        await events.save(outcome.event)
      } catch {
        failed.push(event.id)
        continue
      }

      for (const transition of outcome.applied) {
        ;(transition === 'open' ? opened : closed).push(event.id)
        // The wall listens for this: a projector left running unattended has to notice
        // on its own that the event it is playing has opened or closed.
        bus.publish({
          type: 'event.statusChanged',
          eventId: event.id,
          status: STATUS_AFTER[transition],
        })
      }

      if (outcome.refused.length > 0) refused.push(event.id)
    }

    return { opened, closed, refused, failed }
  }
