import type Database from 'better-sqlite3'
import type {
  Membership,
  MembershipRepository,
  MembershipWithUser,
} from '../../application/ports/userRepository'
import { isEventRole, type EventRole } from '../../domain/events/eventRole'
import { asEventId, asUserId, type EventId, type UserId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `MembershipRepository` over SQLite.
 *
 * `roleFor` is called on every `/admin` request, and the composite primary key
 * `(event_id, user_id)` is what makes `requireRole('moderator')` mean "moderator **of
 * the event in this URL**". 1.0 kept a single `partyId` on the user row, so lending the
 * moderation screen for one wedding handed over every event on the box.
 */

interface MembershipRow {
  readonly event_id: string
  readonly user_id: string
  readonly role: string
  readonly granted_at: string
}

interface MembershipWithUserRow extends MembershipRow {
  readonly email: string
  readonly display_name: string | null
}

interface RoleRow {
  readonly role: string
}

interface CountRow {
  readonly count: number
}

/**
 * The column carries `CHECK (role IN ('owner', 'moderator'))`, so an unknown role can
 * only come from a hand-edited database. Refusing to hydrate it is the safe direction:
 * guessing would either lock the owner out of their own event or, far worse, promote a
 * moderator.
 */
const roleOf = (raw: string): EventRole => {
  if (!isEventRole(raw)) {
    throw new Error(`Corrupt event_memberships.role in the database: ${raw}`)
  }
  return raw
}

const toMembership = (row: MembershipRow): Membership => ({
  eventId: asEventId(row.event_id),
  userId: asUserId(row.user_id),
  role: roleOf(row.role),
  grantedAt: fromIsoText(row.granted_at),
})

const toMembershipWithUser = (row: MembershipWithUserRow): MembershipWithUser => ({
  ...toMembership(row),
  email: row.email,
  displayName: row.display_name,
})

export class SqliteMembershipRepository implements MembershipRepository {
  private readonly selectRole: Database.Statement<[string, string], RoleRow>
  private readonly selectForEvent: Database.Statement<[string], MembershipWithUserRow>
  private readonly selectForUser: Database.Statement<[string], MembershipRow>
  private readonly upsert: Database.Statement<[string, string, string, string]>
  private readonly deleteOne: Database.Statement<[string, string]>
  private readonly countRole: Database.Statement<[string, string], CountRow>

  /** Prepared once: `selectRole` runs on every authenticated admin request. */
  constructor(db: Db) {
    this.selectRole = db.prepare<[string, string], RoleRow>(
      `SELECT role FROM event_memberships WHERE event_id = ? AND user_id = ?`,
    )

    // An inner join, not a left join: `user_id` is a foreign key, so a membership
    // without a user cannot exist and a null email would be an invented one.
    this.selectForEvent = db.prepare<[string], MembershipWithUserRow>(
      `SELECT m.event_id, m.user_id, m.role, m.granted_at, u.email, u.display_name
         FROM event_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.event_id = ?
        ORDER BY m.granted_at DESC, m.user_id`,
    )

    this.selectForUser = db.prepare<[string], MembershipRow>(
      `SELECT event_id, user_id, role, granted_at
         FROM event_memberships
        WHERE user_id = ?
        ORDER BY granted_at DESC, event_id`,
    )

    // `granted_at` is replaced along with the role: a re-grant is a fresh decision, and
    // keeping the first timestamp would make "when was this person given the console"
    // answer with a role they no longer hold.
    this.upsert = db.prepare<[string, string, string, string]>(
      `INSERT INTO event_memberships (event_id, user_id, role, granted_at)
            VALUES (?, ?, ?, ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET role       = excluded.role,
                                                     granted_at = excluded.granted_at`,
    )

    this.deleteOne = db.prepare<[string, string]>(
      `DELETE FROM event_memberships WHERE event_id = ? AND user_id = ?`,
    )

    this.countRole = db.prepare<[string, string], CountRow>(
      `SELECT COUNT(*) AS count FROM event_memberships WHERE event_id = ? AND role = ?`,
    )
  }

  /** `null` is what authorization turns into a 403, so the miss is the important case. */
  async roleFor(eventId: EventId, userId: UserId): Promise<EventRole | null> {
    const row = this.selectRole.get(eventId, userId)
    return row === undefined ? null : roleOf(row.role)
  }

  async listForEvent(eventId: EventId): Promise<readonly MembershipWithUser[]> {
    return this.selectForEvent.all(eventId).map(toMembershipWithUser)
  }

  async listForUser(userId: UserId): Promise<readonly Membership[]> {
    return this.selectForUser.all(userId).map(toMembership)
  }

  async grant(membership: Membership): Promise<void> {
    this.upsert.run(
      membership.eventId,
      membership.userId,
      membership.role,
      toIsoText(membership.grantedAt),
    )
  }

  /** Idempotent: revoking a membership that is already gone is not an error. */
  async revoke(eventId: EventId, userId: UserId): Promise<void> {
    this.deleteOne.run(eventId, userId)
  }

  /** Guards the last-owner rule, which is per event — never a global owner count. */
  async countByRole(eventId: EventId, role: EventRole): Promise<number> {
    const row = this.countRole.get(eventId, role)
    // `COUNT(*)` always yields a row. The fallback is there because the type says it
    // might not, and a `!` assertion is banned in production code.
    return row?.count ?? 0
  }
}
