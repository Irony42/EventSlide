import { canModerate } from '../../../domain/events/eventRole'
import type { Guest } from '../../../domain/guests/guest'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { GuestRepository } from '../../ports/guestRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * A host cutting off a guest who is uploading things that do not belong on the wall.
 *
 * This is what makes a signed, stateless device token revocable: the token keeps
 * verifying, but the row it names is marked revoked, and every use of the token checks
 * that row. `authenticateGuest` is where that check lives, and the two are tested
 * together — a revocation that did not actually stop the next upload would be the worst
 * possible outcome for a host standing in front of a projector.
 *
 * Idempotent, because the button is on a phone at a party and will be double-tapped.
 * The entity keeps the first timestamp: asked later when the guest was cut off, the
 * answer is the moment the host decided.
 */

export interface RevokeGuestInput {
  readonly eventId: EventId
  /** The host or moderator pressing the button. */
  readonly actorId: UserId
  readonly guestId: GuestId
}

export interface RevokeGuestDeps {
  readonly guests: GuestRepository
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type RevokeGuest = (input: RevokeGuestInput) => Promise<Result<Guest, DomainError>>

export const makeRevokeGuest =
  ({ guests, memberships, clock }: RevokeGuestDeps): RevokeGuest =>
  async ({ eventId, actorId, guestId }) => {
    const role = await memberships.roleFor(eventId, actorId)
    // A caller with no part in this event is answered exactly as one asking about an
    // event that does not exist: 403 would confirm the event is real and make this an
    // enumeration oracle for other people's weddings. `canModerate` is asked rather
    // than the qualifying roles being listed, so a role added later is refused by
    // default instead of silently inheriting moderation.
    if (role === null || !canModerate(role)) return err(DomainError.notFound('event.notFound'))

    const guest = await guests.findById(eventId, guestId)
    if (guest === null) return err(DomainError.notFound('guest.notFound'))

    const revoked = guest.revoke(clock.now())
    await guests.save(revoked)
    return ok(revoked)
  }
