import type { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { EventRepository, EventSummary } from '../../ports/eventRepository'

/**
 * The host's dashboard.
 *
 * Summaries, not aggregates: listing twenty events must not hydrate twenty `Event`s
 * plus their settings, and the row carries the counts the aggregate does not know.
 * Scoping is the repository's — it returns what this user owns or moderates, so the
 * dashboard has no way to ask for someone else's events.
 */

export interface ListEventsForHostInput {
  readonly userId: UserId
}

export interface ListEventsForHostDeps {
  readonly events: EventRepository
}

export type ListEventsForHost = (
  input: ListEventsForHostInput,
) => Promise<Result<readonly EventSummary[], DomainError>>

export const makeListEventsForHost =
  ({ events }: ListEventsForHostDeps): ListEventsForHost =>
  async ({ userId }) => {
    // A `Result` although nothing here can fail: the HTTP layer narrows every use case
    // the same way, and a listing that later grows a rule must not change its shape to
    // say so. An empty dashboard is a success, never a 404.
    return ok(await events.listForUser(userId))
  }
