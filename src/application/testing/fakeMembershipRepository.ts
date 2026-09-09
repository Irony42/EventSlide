import type { EventRole } from '../../domain/events/eventRole'
import type { EventId, UserId } from '../../domain/shared/ids'
import type {
  Membership,
  MembershipRepository,
  MembershipWithUser,
  UserRepository,
} from '../ports/userRepository'

/**
 * In-memory `MembershipRepository`.
 *
 * A role is per event, never global. This is the double behind every
 * `requireRole('moderator')` test, so the composite key matters as much as it does for
 * photos: 1.0 kept a single `partyId` on the user row, and a moderator of one event was
 * therefore a moderator of the box. A membership read for the wrong event must miss.
 */

/** Code-unit order, not locale order: an id sort must not depend on the host's ICU. */
const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)

const key = (eventId: EventId, userId: UserId): string => `${eventId}:${userId}`

/**
 * `listForEvent` is a join over `users` in SQLite, so the email and display name come
 * from there. Passing the user repository in keeps that honest rather than inventing
 * identity; it is optional so a test about roles alone needs no user fixtures.
 */
export interface FakeMembershipRepositoryLinks {
  readonly users?: UserRepository
}

/**
 * A membership whose user is not in the linked repository — or which was seeded with
 * no link at all — reports a placeholder in a reserved TLD, so an assertion written
 * against it fails visibly instead of quietly agreeing with a fabricated address. The
 * adapter cannot reach this state: `event_memberships.user_id` is a foreign key.
 */
const placeholderEmail = (userId: UserId): string => `${userId}@unlinked.invalid`

export class FakeMembershipRepository implements MembershipRepository {
  private readonly rows = new Map<string, Membership>()

  constructor(private readonly links: FakeMembershipRepositoryLinks = {}) {}

  seed(...memberships: readonly Membership[]): this {
    for (const membership of memberships) {
      this.rows.set(key(membership.eventId, membership.userId), membership)
    }
    return this
  }

  /** `null` is what authorization turns into a 403, so the miss is the important case. */
  async roleFor(eventId: EventId, userId: UserId): Promise<EventRole | null> {
    return this.rows.get(key(eventId, userId))?.role ?? null
  }

  async listForEvent(eventId: EventId): Promise<readonly MembershipWithUser[]> {
    const members = [...this.rows.values()]
      .filter((membership) => membership.eventId === eventId)
      .sort(
        (left, right) =>
          right.grantedAt.getTime() - left.grantedAt.getTime() ||
          compareIds(left.userId, right.userId),
      )

    return Promise.all(members.map((membership) => this.withUser(membership)))
  }

  private async withUser(membership: Membership): Promise<MembershipWithUser> {
    const user = (await this.links.users?.findById(membership.userId)) ?? null
    return {
      ...membership,
      email: user === null ? placeholderEmail(membership.userId) : user.email.value,
      displayName: user?.displayName ?? null,
    }
  }

  async listForUser(userId: UserId): Promise<readonly Membership[]> {
    return [...this.rows.values()]
      .filter((membership) => membership.userId === userId)
      .sort(
        (left, right) =>
          right.grantedAt.getTime() - left.grantedAt.getTime() ||
          compareIds(left.eventId, right.eventId),
      )
  }

  /**
   * Upsert on `(event_id, user_id)`. The whole row is replaced, `granted_at` included:
   * re-granting is a fresh decision, and keeping the first timestamp would make an
   * audit of "when was this person given the console" answer with a role they no
   * longer had.
   */
  async grant(membership: Membership): Promise<void> {
    this.rows.set(key(membership.eventId, membership.userId), membership)
  }

  /** Idempotent: revoking a membership that is already gone is not an error. */
  async revoke(eventId: EventId, userId: UserId): Promise<void> {
    this.rows.delete(key(eventId, userId))
  }

  /** Guards the last-owner rule, so it is counted per event and never globally. */
  async countByRole(eventId: EventId, role: EventRole): Promise<number> {
    return [...this.rows.values()].filter(
      (membership) => membership.eventId === eventId && membership.role === role,
    ).length
  }
}
