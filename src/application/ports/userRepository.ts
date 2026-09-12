import type { User } from '../../domain/users/user'
import type { EmailAddress } from '../../domain/users/emailAddress'
import type { EventRole } from '../../domain/events/eventRole'
import type { EventId, UserId } from '../../domain/shared/ids'

export interface UserRepository {
  findById(id: UserId): Promise<User | null>

  /** The login lookup. A unique index on the normalised address backs it. */
  findByEmail(email: EmailAddress): Promise<User | null>

  save(user: User): Promise<void>

  delete(id: UserId): Promise<void>

  /**
   * Whether any account exists. Drives first-run bootstrap: 2.0 creates an owner from
   * configuration on an empty database instead of shipping 1.0's `admin` / `password`.
   */
  isEmpty(): Promise<boolean>
}

export interface Membership {
  readonly eventId: EventId
  readonly userId: UserId
  readonly role: EventRole
  readonly grantedAt: Date
}

export interface MembershipWithUser extends Membership {
  readonly email: string
  readonly displayName: string | null
}

/**
 * Roles are per event, never global.
 *
 * This is the port the authorization middleware calls on every `/admin` request, and
 * the reason `requireRole('moderator')` means "moderator **of the event in this URL**"
 * rather than "is logged in". 1.0 had a single `partyId` column on the user row, so a
 * user belonged to exactly one party and there was no notion of a role at all.
 */
export interface MembershipRepository {
  /** `null` when the user has no part in this event — which authorization treats as 403. */
  roleFor(eventId: EventId, userId: UserId): Promise<EventRole | null>

  listForEvent(eventId: EventId): Promise<readonly MembershipWithUser[]>

  listForUser(userId: UserId): Promise<readonly Membership[]>

  /** Insert or update the role. */
  grant(membership: Membership): Promise<void>

  revoke(eventId: EventId, userId: UserId): Promise<void>

  /** Guards the last-owner rule: an event must never be left without an owner. */
  countByRole(eventId: EventId, role: EventRole): Promise<number>
}
