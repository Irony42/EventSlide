import type { Event } from '../../../domain/events/event'
import { isRevealed } from '../../../domain/events/eventRevealSettings'
import type { Clock } from '../../ports/clock'
import type { EventCounts, EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { EventLimits, GetEventLimits } from './getEventLimits'

/**
 * Everything a host's answer about **one** event carries besides the event itself: what it
 * holds, counted, and the limits it is under (HTTP-M-06).
 *
 * Every route that answers with an `EventDto` (creating, reading, renaming, scheduling, opening,
 * closing, changing the settings) first runs its own use case and is handed an `Event`. What was
 * left, the counts and the limits, used to be fetched from the handler by two more use cases,
 * one of which was the host's **whole dashboard** (`listEventsForHost`: every event they own or
 * moderate, four correlated subqueries each) of which the handler kept a single row. That read
 * grew with every event the host had ever run and blocked the event loop while it did, to
 * answer a question about one event. It is one use case now, and the counts are one event's.
 *
 * It takes the `Event` and not an id: the decision to show this event to this caller was taken
 * by the use case that returned it (and by `requireRole` before that), so this one has nothing
 * to authorise and cannot be asked about an event the caller has not been handed. It cannot
 * fail, so it does not answer with a `Result`.
 */

export interface EventView {
  readonly event: Event
  readonly counts: EventCounts
  readonly limits: EventLimits
  /** The server's clock at this answer: what a console counts the reveal down against. */
  readonly now: Date
  /**
   * Published photographs the reveal gate is holding back, or `null` when nothing is held (mode off,
   * or already revealed). The pending ones are `counts.pendingCount`: they stay hidden after the reveal.
   */
  readonly readyCount: number | null
}

export interface GetEventViewInput {
  readonly event: Event
}

export interface GetEventViewDeps {
  readonly events: Pick<EventRepository, 'countsOf'>
  readonly photos: Pick<PhotoRepository, 'countsByStatus'>
  readonly clock: Clock
  readonly getEventLimits: GetEventLimits
}

export type GetEventView = (input: GetEventViewInput) => Promise<EventView>

export const makeGetEventView =
  ({ events, photos, clock, getEventLimits }: GetEventViewDeps): GetEventView =>
  async ({ event }) => {
    const now = clock.now()
    const held = event.settings.reveal.enabled && !isRevealed(event.settings.reveal, now)
    return {
      event,
      counts: await events.countsOf(event.id),
      limits: await getEventLimits({ event }),
      now,
      readyCount: held ? (await photos.countsByStatus(event.id)).published : null,
    }
  }
