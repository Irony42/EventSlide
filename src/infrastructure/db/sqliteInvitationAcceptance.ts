import type {
  AcceptInvitationRecord,
  InvitationAcceptance,
  InvitationAcceptanceOutcome,
} from '../../application/ports/invitationAcceptance'
import type { Db } from './connection'
import { ACCOUNT_TOKEN_USABLE_SQL } from './sqliteAccountTokenRepository'
import { INSERT_USER, userRow } from './sqliteUserRepository'
import { toIsoText } from './rowMapping'
import { INSERT_AUDIT_SQL, auditParams } from './sqliteAuditLog'

/**
 * `InvitationAcceptance` over SQLite: one transaction around the spend of the link, the
 * creation of the account, the grant and the stamp (docs/ROADMAP.md §10.3; G2-09).
 *
 * **Everything the link grants is read from the link's own row, inside the transaction.** The
 * caller names who is accepting and nothing about what: the place and the role are columns of
 * the row it spends, so one person's link cannot be spent for another's place by any caller,
 * however wrong.
 *
 * **The order is "look, then write", and the transaction is `IMMEDIATE` so that nothing
 * writes between the two.** A link that cannot be spent and an address that is taken are
 * both answered before anything is changed, with nothing to roll back. Correctness does not
 * rest on the lock: the statement that spends the link is conditional and changes exactly one
 * row or the transaction throws, which rolls back everything, the account included — a
 * deferred transaction would fail with `SQLITE_BUSY` instead of double-spending. The lock is
 * what makes a second acceptance wait for the first rather than fail at its first write.
 *
 * Statements that stand for a rule say only that rule:
 *
 * - The account is a plain `INSERT` (`INSERT_USER`), never an upsert: an id that exists is
 *   an error and rolls back, because an upsert would rewrite another account's address,
 *   password and authority on the box and answer `accepted`.
 * - The event grant is `ON CONFLICT (event_id, user_id) DO NOTHING`, naming the key it
 *   means to ignore. `INSERT OR IGNORE` would also swallow a `CHECK` or `NOT NULL` failure and
 *   report an acceptance that granted nothing.
 * - The client grant raises a `member` to `owner` and never lowers an `owner`.
 * - **The audit entry, when there is one, is the last statement** (the acceptance of the terms,
 *   G2-20): after the spend and the grant it describes, inside the same transaction, so the
 *   log never says an acceptance happened that did not, and an entry the log refuses rolls the
 *   whole acceptance back. It is the plain `INSERT` `SqliteAuditLog.record` uses.
 */

interface InvitationRow {
  readonly purpose: string
  readonly email: string
  readonly event_id: string | null
  readonly event_role: string | null
  readonly client_id: string | null
  readonly client_role: string | null
}

export class SqliteInvitationAcceptance implements InvitationAcceptance {
  private readonly selectInvitation
  private readonly selectAddressOf
  private readonly selectEmailTaken
  private readonly spend
  private readonly insertUser
  private readonly stampVerified
  private readonly grantEvent
  private readonly grantClient
  private readonly insertAudit
  private readonly stampTerms

  constructor(private readonly db: Db) {
    this.selectInvitation = db.prepare<[string, string], InvitationRow>(
      `SELECT purpose, email, event_id, event_role, client_id, client_role
         FROM account_tokens WHERE id = ? AND ${ACCOUNT_TOKEN_USABLE_SQL}`,
    )
    this.selectAddressOf = db.prepare<[string], { readonly email: string }>(
      `SELECT email FROM users WHERE id = ?`,
    )
    this.selectEmailTaken = db.prepare<[string], { readonly present: number }>(
      `SELECT 1 AS present FROM users WHERE email = ?`,
    )
    this.spend = db.prepare<[string, string, string]>(
      `UPDATE account_tokens SET consumed_at = ? WHERE id = ? AND ${ACCOUNT_TOKEN_USABLE_SQL}`,
    )
    this.insertUser = db.prepare(INSERT_USER)
    // The first proof stands: an account that was verified before keeps its date.
    this.stampVerified = db.prepare<[string, string]>(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?`,
    )
    this.grantEvent = db.prepare<[string, string, string, string]>(
      `INSERT INTO event_memberships (event_id, user_id, role, granted_at)
            VALUES (?, ?, ?, ?)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
    )
    this.insertAudit = db.prepare(INSERT_AUDIT_SQL)
    this.stampTerms = db.prepare<[string, string, string]>(
      `UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?`,
    )
    this.grantClient = db.prepare<[string, string, string, string]>(
      `INSERT INTO client_members (client_id, user_id, role, granted_at)
            VALUES (?, ?, ?, ?)
       ON CONFLICT (client_id, user_id)
         DO UPDATE SET role = CASE WHEN excluded.role = 'owner' THEN 'owner'
                                   ELSE client_members.role END`,
    )
  }

  async accept(record: AcceptInvitationRecord): Promise<InvitationAcceptanceOutcome> {
    return this.db
      .transaction((): InvitationAcceptanceOutcome => {
        const at = toIsoText(record.now)

        const invitation = this.selectInvitation.get(record.tokenId, at)
        if (invitation === undefined || invitation.purpose !== 'invitation') return 'spent'

        const { account } = record
        const userId = account.kind === 'new' ? account.user.id : account.userId
        const address =
          account.kind === 'new'
            ? account.user.email.value
            : this.selectAddressOf.get(userId)?.email
        if (address === undefined) throw new Error('the account that accepts does not exist')
        // A link is for one mailbox. An account at another address is a caller's bug, and
        // it is loud rather than a quiet "no": nothing has been written yet.
        if (address !== invitation.email) {
          throw new Error('the invitation was written to another address')
        }

        if (account.kind === 'new' && this.selectEmailTaken.get(address)) return 'emailTaken'

        const spent = this.spend.run(at, record.tokenId, at)
        if (spent.changes !== 1) {
          throw new Error('the invitation was usable a moment ago and could not be spent')
        }

        if (account.kind === 'new') {
          this.insertUser.run(...userRow(account.user))
        } else if (account.emailVerifiedAt !== null) {
          this.stampVerified.run(toIsoText(account.emailVerifiedAt), userId)
        }

        if (invitation.event_id !== null && invitation.event_role !== null) {
          this.grantEvent.run(invitation.event_id, userId, invitation.event_role, at)
        } else if (invitation.client_id !== null && invitation.client_role !== null) {
          this.grantClient.run(invitation.client_id, userId, invitation.client_role, at)
        } else {
          throw new Error('the invitation names nothing to grant')
        }
        if (record.audit !== undefined) this.insertAudit.run(auditParams(record.audit))
        // The durable half of the same fact: the log's entry is pruned, the account's is not.
        if (record.termsVersion !== undefined) this.stampTerms.run(record.termsVersion, at, userId)
        return 'accepted'
      })
      .immediate()
  }
}
