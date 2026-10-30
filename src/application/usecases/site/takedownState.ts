import type { Event } from '../../../domain/events/event'
import type { EventStatus } from '../../../domain/events/eventStatus'
import type { ClientId, EventId, PhotoId } from '../../../domain/shared/ids'

/**
 * What the operator reads of an event it is about to take down, hold or restore (launch review
 * S5; `/api/site/events/lookup` and `/api/site/events/:eventId`): **ids, a lifecycle status and two
 * instants, and nothing the client made**. There is deliberately no field for the event's name, its
 * slug or its join code, so a lookup by any of them answers with none of them: the operator types
 * what a report gave it and is told which event that is, never what it is called.
 */
export interface SiteEventState {
  readonly id: EventId
  readonly clientId: ClientId | null
  readonly status: EventStatus
  readonly createdAt: Date
  readonly takenDownAt: Date | null
  readonly purgeHeldAt: Date | null
}

export const siteEventStateOf = (event: Event): SiteEventState => ({
  id: event.id,
  clientId: event.clientId,
  status: event.status,
  createdAt: event.createdAt,
  takenDownAt: event.takenDownAt,
  purgeHeldAt: event.purgeHeldAt,
})

/** What the operator reads of a photograph named by its id: where it is and whether it is down. */
export interface SitePhotoState {
  readonly id: PhotoId
  readonly eventId: EventId
  readonly takenDownAt: Date | null
}
