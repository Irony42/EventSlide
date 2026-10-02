import type { User } from '../../domain/users/user'
import type { EmailAddress } from '../../domain/users/emailAddress'
import type { SiteRole } from '../../domain/users/siteRole'
import type { EventRole } from '../../domain/events/eventRole'
import type { EventId, UserId } from '../../domain/shared/ids'

/**
 * What `UserRepository.authStateFor` answers — see its doc comment for why it is one
 * read rather than two.
 */
export interface AuthState {
  readonly active: boolean
  readonly mustChangePassword: boolean
  /**
   * The credentials epoch (G2-08 / P3-09): a session issued before this instant is no
   * longer valid. `null` when the account's credentials never changed, which revokes
   * nothing. Always `null` for an inactive account: nothing asks an epoch of an account
   * that may not act.
   */
  readonly credentialsChangedAt: Date | null
}

/**
 * What every implementation answers for an account that cannot act: one gone entirely,
 * and one somebody disabled. Exported so both adapters collapse to the exact same
 * value rather than two object literals that happen to compare equal today.
 */
export const INACTIVE_AUTH_STATE: AuthState = {
  active: false,
  mustChangePassword: false,
  credentialsChangedAt: null,
}

export interface UserRepository {
  findById(id: UserId): Promise<User | null>

  /** The login lookup. A unique index on the normalised address backs it. */
  findByEmail(email: EmailAddress): Promise<User | null>

  /**
   * Everything authorization reads about an account's credentials, in the one query a
   * request needs — never two.
   *
   * It supersedes two reads a request used to make separately: whether the account may
   * act at all (`GET`/`POST /api/events`, `POST /api/auth/password` ask nothing about an
   * event, so there is no role to fetch and nothing else would notice an account the
   * session's owner switched off), and `mustChangePassword`, which a session cookie used
   * to carry from the moment of login. The second one is the point of the merge, not a
   * convenience: a capability copied into a cookie survives whatever happens to the row
   * behind it, which is exactly backwards for a flag whose whole job is to be true until
   * somebody chooses a password. Reading it fresh from storage on every request is the
   * same argument `siteRoleFor` already makes for the site role, applied to this flag.
   *
   * `active` is total, and false for the same two cases `siteRoleFor` collapses: an
   * account that does not exist and one that has been disabled are one answer, because a
   * session outliving its account names nobody. `mustChangePassword` is only meaningful
   * when `active` is true — the two aggregates (`UserRepository`, `authz.ts`) do not
   * need to agree on what a disabled account's flag means, because nothing downstream
   * ever asks the flag before asking whether the account may act at all.
   *
   * `credentialsChangedAt` is the epoch `enforceSessionAge` compares a session's `issuedAt`
   * against. It rides this read rather than a third one for the reason the other two
   * already do: a request pays one query for everything authorization knows about the
   * account behind its cookie.
   */
  authStateFor(id: UserId): Promise<AuthState>

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

  /**
   * Insert or update. **The epoch only moves forward**: `credentialsChangedAt` is stored
   * as the later of what the row holds and what `user` carries, so a copy of the account
   * read before a password change and saved after it (a sign-in's `lastLoginAt` write
   * racing a reset, say) cannot bring revoked sessions back. Every other field is
   * overwritten, as it always was.
   */
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
