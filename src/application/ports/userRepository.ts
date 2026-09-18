import type { User } from '../../domain/users/user'
import type { EmailAddress } from '../../domain/users/emailAddress'
import type { SiteRole } from '../../domain/users/siteRole'
import type { EventRole } from '../../domain/events/eventRole'
import type { EventId, UserId } from '../../domain/shared/ids'

export interface UserRepository {
  findById(id: UserId): Promise<User | null>

  /** The login lookup. A unique index on the normalised address backs it. */
  findByEmail(email: EmailAddress): Promise<User | null>

  /**
   * Whether this account may act at all, right now.
   *
   * The smallest of the three authorization reads on this port, and the one the routes
   * that are **not** event-scoped need: `GET /api/events`, `POST /api/events` and
   * `POST /api/auth/password` ask nothing about an event, so there is no role to fetch
   * and nothing else would notice that the account behind the session has been switched
   * off. Before it existed, `disabled_at` was read on exactly one line in the whole
   * product — inside `authenticateUser` — so a host who was disabled at 19:00 kept
   * creating events from the tab they already had open.
   *
   * Total, like {@link siteRoleFor}, and false for the same two cases: an account that
   * does not exist and one that has been disabled are one answer, because a session
   * outliving its account names nobody. It reads one column rather than hydrating the
   * `User`, so a gate on a request that has no use for a password hash never puts one on
   * the heap.
   */
  isActive(id: UserId): Promise<boolean>

  /**
   * The authority this account has **over the box**, right now.
   *
   * The site-level twin of `MembershipRepository.roleFor`, and it exists for the same
   * reason: authorization is answered from storage on the request that needs it, never
   * from a capability copied into a session at login. An account demoted at 19:00 must
   * not still be operating the box at 23:00 because its cookie says so.
   *
   * Total rather than nullable, because every answer other than `operator` is the same
   * answer. An account that does not exist and one that has been switched off both
   * report `none`: a session outliving its account grants nothing, and a disabled
   * account operates nothing. Reading the whole `User` and asking it instead would hand
   * the HTTP layer a password hash it has no business holding.
   */
  siteRoleFor(id: UserId): Promise<SiteRole>

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
  /**
   * The authority this account holds **in this event**, right now.
   *
   * `null` when the user has no part in it — which authorization turns into a 404 — and
   * `null` just as much when the account has been **disabled**. That second case is the
   * event-level twin of {@link UserRepository.siteRoleFor}'s `WHERE disabled_at IS NULL`
   * and exists for the same reason: an authorization read is answered from storage on the
   * request that uses it, and an account somebody switched off holds nothing. A capability
   * that survives in a cookie is a capability nobody can take back, and a rolling session
   * never expires while it is being used.
   *
   * Putting it here rather than in the middleware is what makes it hold everywhere. Every
   * authorization decision in this product — `requireRole`, `mediaRoutes`' own viewer
   * resolution, and the sixteen use cases that check an actor for themselves, including
   * `registerModerator`, which is how a disabled owner used to mint a fresh **enabled**
   * account — asks this one question. A check in `requireRole` alone would have left the
   * use cases answering a different one.
   *
   * The membership row itself is untouched, and the rest of this port still reports it:
   * `listForEvent` keeps showing a disabled moderator to the owner looking at the list,
   * and `countByRole` keeps counting them, so the last-owner rule is about rows rather
   * than about who happens to be switched on this evening — and re-enabling an account
   * gives back exactly what it had. Only the authority answer changes.
   */
  roleFor(eventId: EventId, userId: UserId): Promise<EventRole | null>

  /**
   * The membership **row**, whatever state the account behind it is in.
   *
   * The counterpart to {@link MembershipRepository.roleFor}, and the distinction is the
   * whole reason it exists: `roleFor` answers "what may this account do here, right now"
   * and therefore misses a disabled account; this answers "is there a row", which is a
   * question about the event's records and not about anybody's authority.
   *
   * Two callers, and both were bugs waiting to happen while they asked `roleFor`.
   * `registerModerator` uses it to refuse re-inviting somebody who is already a member —
   * with `roleFor` a **disabled co-owner** would have looked like a stranger and been
   * silently re-granted as a moderator, losing the role that re-enabling them was
   * supposed to give back. `revokeModerator` uses it to find the row it is about to
   * delete, so an owner can still tidy a switched-off account out of their event instead
   * of being told the membership does not exist.
   */
  membershipFor(eventId: EventId, userId: UserId): Promise<Membership | null>

  listForEvent(eventId: EventId): Promise<readonly MembershipWithUser[]>

  listForUser(userId: UserId): Promise<readonly Membership[]>

  /** Insert or update the role. */
  grant(membership: Membership): Promise<void>

  revoke(eventId: EventId, userId: UserId): Promise<void>

  /** Guards the last-owner rule: an event must never be left without an owner. */
  countByRole(eventId: EventId, role: EventRole): Promise<number>
}
