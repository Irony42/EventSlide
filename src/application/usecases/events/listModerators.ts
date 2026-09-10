import { canManageEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { MembershipRepository, MembershipWithUser } from '../../ports/userRepository'

/**
 * Who has the console for this event.
 *
 * Owner only. A moderator is someone handed a laptop for the evening; the list of who
 * else holds that laptop, with their addresses, is the host's own view of their event
 * and not part of moderating photos.
 *
 * Scoped to one event by the port itself, so an owner of the corporate gala cannot read
 * the wedding's memberships even by guessing its id.
 */

export interface ListModeratorsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface ListModeratorsDeps {
  readonly memberships: MembershipRepository
}

export type ListModerators = (
  input: ListModeratorsInput,
) => Promise<Result<readonly MembershipWithUser[], DomainError>>

export const makeListModerators =
  ({ memberships }: ListModeratorsDeps): ListModerators =>
  async ({ eventId, actorId }) => {
    const role = await memberships.roleFor(eventId, actorId)
    // No membership answers exactly as an event that does not exist: confirming the
    // event to someone with no part in it turns this into an enumeration oracle.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    // A moderator of this event is genuinely in scope, so `forbidden` is honest here
    // and reveals nothing they did not already know.
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    return ok(await memberships.listForEvent(eventId))
  }
