import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import { siteEventStateOf, type SiteEventState } from './takedownState'

/** One event's takedown state by its id (`GET /api/site/events/:eventId`): ids and instants only. */
export interface GetSiteEventStateDeps {
  readonly events: Pick<EventRepository, 'findById'>
}

export type GetSiteEventState = (input: {
  readonly eventId: EventId
}) => Promise<Result<SiteEventState, DomainError>>

export const makeGetSiteEventState =
  ({ events }: GetSiteEventStateDeps): GetSiteEventState =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    return event === null
      ? err(DomainError.notFound('event.notFound'))
      : ok(siteEventStateOf(event))
  }
