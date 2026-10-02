import type { EventStatus } from '../../../domain/events/eventStatus'
import type { ScheduledTransition } from '../../../domain/events/event'
import type { EventId } from '../../../domain/shared/ids'
import type { Clock } from '../../ports/clock'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import { clientContextOf } from '../clients/clientContextOf'

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
 * **It also takes down a client's live event whose window has run out** (roadmap §10.5 /
 * G2-05). `closed → live` is a legal transition, so without a bound a host pressing one button
 * a month would keep a public wall for ever; the bound is `max_live_days`, counted from the
 * event's first opening, and `changeEventStatus` and the scheduled opening both refuse to
 * reopen past it. This is the other half: an event that is **still live** when its window ends
 * is closed here, by the sweep, on the next pass. Closed rather than archived — the album stays
 * readable and the host keeps the export — and the retention clock starts at that moment. An
 * event with no client has no window and is never touched by this half.
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
  /**
   * Live events of a client closed because the client's live window ran out
   * (`opened_at + max_live_days <= now`). Not in `closed`, which is the host's own schedule:
   * the two answer different questions — "why did the wall go dark at 02:00" — and the audit
   * entry and the e-mail to the host (roadmap §10.8) hang off this list, not that one.
   */
  readonly autoClosed: readonly EventId[]
}

export interface ApplyEventSchedulesDeps {
  readonly events: EventRepository
  /**
   * For the ceilings of an event's client (roadmap §10.5): `live_allowed` and
   * `max_live_days`, for a scheduled opening and for the window sweep. Read only for an event
   * that has a client — see `clientContextOf`.
   */
  readonly clients: ClientRepository
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
  ({ events, clients, bus, clock }: ApplyEventSchedulesDeps): ApplyEventSchedules =>
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
    const autoClosed: EventId[] = []

    // Sequentially, like the retention sweep: this runs on the same box that may be
    // serving a live event, and the work is tiny — one row each.
    for (const event of due) {
      // The client's ceilings go into the schedule exactly as they go into a manual
      // transition, so a scheduled opening is refused for the reasons a manual one is.
      const ceilings = (await clientContextOf(clients, event))?.ceilings ?? null
      const outcome = event.applySchedule(now, ceilings)

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

    // The window sweep, **after** the schedule above so it reads what that just wrote: an
    // event the schedule closed a moment ago is not live any more and is not closed twice.
    // The same `now`, so one pass judges every event against one instant.
    for (const event of await events.listLiveOfClients()) {
      const ceilings = (await clientContextOf(clients, event))?.ceilings ?? null
      const expired = event.expireLiveWindow(now, ceilings)
      if (expired === null) continue

      try {
        await events.save(expired)
      } catch {
        failed.push(event.id)
        continue
      }

      autoClosed.push(event.id)
      bus.publish({ type: 'event.statusChanged', eventId: event.id, status: 'closed' })
    }

    return { opened, closed, refused, failed, autoClosed }
  }
