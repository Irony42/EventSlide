import type { Event } from '../../../domain/events/event'
import type { EventCounts, EventRepository } from '../../ports/eventRepository'
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
}

export interface GetEventViewInput {
  readonly event: Event
}

export interface GetEventViewDeps {
  readonly events: Pick<EventRepository, 'countsOf'>
  readonly getEventLimits: GetEventLimits
}

export type GetEventView = (input: GetEventViewInput) => Promise<EventView>

export const makeGetEventView =
  ({ events, getEventLimits }: GetEventViewDeps): GetEventView =>
  async ({ event }) => ({
    event,
    counts: await events.countsOf(event.id),
    limits: await getEventLimits({ event }),
  })
