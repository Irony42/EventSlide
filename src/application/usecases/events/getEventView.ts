import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import type { PurgeNoticeLevel } from '../../../domain/clients/purgeNotice'
import type { Event } from '../../../domain/events/event'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventCounts, EventRepository } from '../../ports/eventRepository'
import type { PurgeNoticeLedger } from '../../ports/purgeNoticeLedger'
import type { EventLimits, GetEventLimits } from './getEventLimits'

/**
 * Everything a host's answer about **one** event carries besides the event itself: what it
 * holds, counted, the limits it is under (HTTP-M-06), and when it will be deleted.
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
 *
 * **`purge` (spec 22) is the date the album will be deleted**, the one the sweep acts on
 * (`purgeDeadline`, with the event's client in the picture), or `null` when the album is not on a
 * clock; and the last warning its owners were sent (`notice`). It says nothing about the
 * operator's hold on the purge: that is invisible to a host, who may be the person concerned,
 * and the date is shown whether or not it is held.
 */

export interface EventPurgeView {
  readonly at: Date | null
  /** The threshold of the last e-mail sent, or `null`: none yet, or no date. */
  readonly notice: PurgeNoticeLevel | null
  /**
   * The event's client is being offboarded (it has a `purge_after`): the album's date is the grace
   * period the client was told, and the host's page shows the deletion band however far it is.
   */
  readonly offboarding: boolean
}

export interface EventView {
  readonly event: Event
  readonly counts: EventCounts
  readonly limits: EventLimits
  readonly purge: EventPurgeView
}

export interface GetEventViewInput {
  readonly event: Event
}

export interface GetEventViewDeps {
  readonly events: Pick<EventRepository, 'countsOf'>
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly notices: Pick<PurgeNoticeLedger, 'lastLevel'>
  readonly getEventLimits: GetEventLimits
  /** `RETENTION_CAP_NOTICE_DAYS`, the number the purge itself lists with. */
  readonly capNoticeDays: number
}

export type GetEventView = (input: GetEventViewInput) => Promise<EventView>

export const makeGetEventView =
  ({ events, clients, notices, getEventLimits, capNoticeDays }: GetEventViewDeps): GetEventView =>
  async ({ event }) => {
    // An event with no client asks nothing of the clients table, as everywhere else.
    const client = event.clientId === null ? null : await clients.findById(event.clientId)
    const at = purgeDeadline(event, client, capNoticeDays)

    return {
      event,
      counts: await events.countsOf(event.id),
      limits: await getEventLimits({ event }),
      purge: {
        at,
        notice: at === null ? null : await notices.lastLevel(event.id),
        offboarding: client?.purgeAfter != null,
      },
    }
  }
