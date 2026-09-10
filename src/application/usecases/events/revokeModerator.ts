import { canManageEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host takes the console back.
 *
 * The membership row goes; the account does not. A moderator invited for one wedding
 * may be an owner of their own events, and deleting the user would take those with it.
 *
 * **An event is never left without an owner.** Removing the last one would leave the
 * album with nobody able to change its settings, rotate its join code, or delete it —
 * and no route through which to appoint a new owner, since inviting is itself an
 * owner's action. So the last owner is refused, and the host has to appoint a co-owner
 * before stepping back.
 */

export interface RevokeModeratorInput {
  readonly eventId: EventId
  /** The signed-in owner doing the revoking. Their role is checked on this event only. */
  readonly actorId: UserId
  /** Whose membership goes. May be the actor's own — an owner may step back. */
  readonly userId: UserId
}

export interface RevokeModeratorDeps {
  readonly memberships: MembershipRepository
}

export type RevokeModerator = (input: RevokeModeratorInput) => Promise<Result<void, DomainError>>

export const makeRevokeModerator =
  ({ memberships }: RevokeModeratorDeps): RevokeModerator =>
  async ({ eventId, actorId, userId }) => {
    const actorRole = await memberships.roleFor(eventId, actorId)
    // No membership answers exactly as an event that does not exist, so this cannot be
    // used to discover other people's events.
    if (actorRole === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(actorRole)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    const targetRole = await memberships.roleFor(eventId, userId)
    // Scoped by `(eventId, userId)`, so a membership this person holds on another event
    // is a miss here rather than a row this owner can delete.
    if (targetRole === null) return err(DomainError.notFound('membership.notFound'))

    if (targetRole === 'owner' && (await memberships.countByRole(eventId, 'owner')) <= 1) {
      return err(DomainError.conflict('membership.lastOwner'))
    }

    await memberships.revoke(eventId, userId)

    return ok(undefined)
  }
