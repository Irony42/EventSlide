import type { EventRole } from '../../../domain/events/eventRole'
import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { EventRepository, EventSummary } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host's dashboard.
 *
 * Summaries, not aggregates: listing twenty events must not hydrate twenty `Event`s
 * plus their settings, and the row carries the counts the aggregate does not know.
 * Scoping is the repository's — it returns what this user owns or moderates, so the
 * dashboard has no way to ask for someone else's events.
 *
 * Each row also says **what the caller is in that event** (`role`), so the dashboard can leave
 * out the buttons that a moderator's request would only have answered `403`. The role is the
 * caller's own membership of that event, read through `listForUser`, every row of which is
 * `(eventId, caller)`: a membership of another event, or of another account, cannot colour a
 * row. A row the caller reaches by the `owner_id` column alone, with no membership row (a
 * fixture, or an account that predates memberships), is the owner's: that is how the
 * repository admitted it to the list.
 */

/** A dashboard row and the caller's role in it. */
export interface HostEventSummary extends EventSummary {
  readonly role: EventRole
}

export interface ListEventsForHostInput {
  readonly userId: UserId
}

export interface ListEventsForHostDeps {
  readonly events: EventRepository
  readonly memberships: Pick<MembershipRepository, 'listForUser'>
}

export type ListEventsForHost = (
  input: ListEventsForHostInput,
) => Promise<Result<readonly HostEventSummary[], DomainError>>

export const makeListEventsForHost =
  ({ events, memberships }: ListEventsForHostDeps): ListEventsForHost =>
  async ({ userId }) => {
    // A `Result` although nothing here can fail: the HTTP layer narrows every use case
    // the same way, and a listing that later grows a rule must not change its shape to
    // say so. An empty dashboard is a success, never a 404.
    const summaries = await events.listForUser(userId)
    const roles = new Map<EventId, EventRole>()
    for (const membership of await memberships.listForUser(userId)) {
      roles.set(membership.eventId, membership.role)
    }
    return ok(summaries.map((summary) => ({ ...summary, role: roles.get(summary.id) ?? 'owner' })))
  }
