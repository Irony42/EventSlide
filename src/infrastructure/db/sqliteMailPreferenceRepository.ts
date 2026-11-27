import type {
  DigestSubscription,
  MailPreferenceRepository,
} from '../../application/ports/mailPreferenceRepository'
import {
  DEFAULT_MAIL_PREFERENCES,
  type MailPreferences,
  type MailPreferencesPatch,
} from '../../domain/notices/mailPreferences'
import type { EventId, UserId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * The mail switches of `users` (`mail_rsvp`, `mail_event`) and the digest state of `event_memberships`
 * (`rsvp_digest`, `rsvp_digest_at`), migration 042.
 *
 * Every statement touches its own columns and nothing else, which is why this is not part of
 * `SqliteUserRepository.save` (a whole-row write that would put a switch back). `claimDigest` is the
 * compare-and-set: `rsvp_digest_at IS ?` matches `NULL` as well as a stored instant, so the one statement
 * that finds the column as the caller read it is the one that writes.
 */
export class SqliteMailPreferenceRepository implements MailPreferenceRepository {
  constructor(private readonly db: Db) {}

  async forUser(userId: UserId): Promise<MailPreferences> {
    const row = this.db
      .prepare(`SELECT mail_rsvp, mail_event FROM users WHERE id = ?`)
      .get(userId) as { mail_rsvp: number; mail_event: number } | undefined
    if (row === undefined) return DEFAULT_MAIL_PREFERENCES
    return { rsvp: row.mail_rsvp === 1, event: row.mail_event === 1 }
  }

  async save(userId: UserId, patch: MailPreferencesPatch): Promise<void> {
    // One statement, each switch kept when the patch leaves it out: concurrent changes of the two never undo each other.
    this.db
      .prepare(
        `UPDATE users SET mail_rsvp = COALESCE(?, mail_rsvp), mail_event = COALESCE(?, mail_event) WHERE id = ?`,
      )
      .run(
        patch.rsvp === undefined ? null : patch.rsvp ? 1 : 0,
        patch.event === undefined ? null : patch.event ? 1 : 0,
        userId,
      )
  }

  async digestFor(eventId: EventId, userId: UserId): Promise<DigestSubscription> {
    const row = this.db
      .prepare(
        `SELECT rsvp_digest, rsvp_digest_at FROM event_memberships WHERE event_id = ? AND user_id = ?`,
      )
      .get(eventId, userId) as { rsvp_digest: number; rsvp_digest_at: string | null } | undefined
    if (row === undefined) return { on: false, lastAt: null }
    return {
      on: row.rsvp_digest === 1,
      lastAt: row.rsvp_digest_at === null ? null : fromIsoText(row.rsvp_digest_at),
    }
  }

  async setDigest(eventId: EventId, userId: UserId, on: boolean): Promise<void> {
    this.db
      .prepare(`UPDATE event_memberships SET rsvp_digest = ? WHERE event_id = ? AND user_id = ?`)
      .run(on ? 1 : 0, eventId, userId)
  }

  async claimDigest(
    eventId: EventId,
    userId: UserId,
    expected: Date | null,
    at: Date,
  ): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE event_memberships SET rsvp_digest_at = ?
          WHERE event_id = ? AND user_id = ? AND rsvp_digest_at IS ?
            AND rsvp_digest = 1 AND role = 'owner'`,
      )
      .run(toIsoText(at), eventId, userId, expected === null ? null : toIsoText(expected))
    return result.changes === 1
  }
}
