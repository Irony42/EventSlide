import type {
  AcceptInvitationRecord,
  InvitationAcceptance,
  InvitationAcceptanceOutcome,
} from '../../application/ports/invitationAcceptance'
import type { Db } from './connection'
import { ACCOUNT_TOKEN_USABLE_SQL } from './sqliteAccountTokenRepository'
import { UPSERT_USER, userRow } from './sqliteUserRepository'
import { toIsoText } from './rowMapping'

/**
 * `InvitationAcceptance` over SQLite: one `IMMEDIATE` transaction around the spend of the
 * link, the creation of the account, the grant and the stamp (docs/ROADMAP.md §10.3; G2-09).
 *
 * **The write lock is taken at `BEGIN`**, so no other connection can write between the
 * reads and the writes below. That is what lets the order be "look, then write" rather than
 * "write, and undo": a link that cannot be spent and an address that is taken are both
 * answered **before** anything is changed, with nothing to roll back, and the one statement
 * that spends the link is then certain to change exactly one row. If it ever does not, that
 * is a bug and it throws — which rolls back everything, the account included.
 *
 * The statements are the ones the single-table repositories use where there is one
 * (`ACCOUNT_TOKEN_USABLE_SQL`, `UPSERT_USER`), so "usable" and "a user row" mean the same
 * thing here as everywhere else.
 */

export class SqliteInvitationAcceptance implements InvitationAcceptance {
  private readonly selectUsable
  private readonly selectEmailTaken
  private readonly spend
  private readonly insertUser
  private readonly stampVerified
  private readonly grantEvent
  private readonly grantClient

  constructor(private readonly db: Db) {
    this.selectUsable = db.prepare<[string, string], { readonly present: number }>(
      `SELECT 1 AS present FROM account_tokens WHERE id = ? AND ${ACCOUNT_TOKEN_USABLE_SQL}`,
    )
    this.selectEmailTaken = db.prepare<[string], { readonly present: number }>(
      `SELECT 1 AS present FROM users WHERE email = ?`,
    )
    this.spend = db.prepare<[string, string, string]>(
      `UPDATE account_tokens SET consumed_at = ? WHERE id = ? AND ${ACCOUNT_TOKEN_USABLE_SQL}`,
    )
    this.insertUser = db.prepare(UPSERT_USER)
    // The first proof stands: an account that was verified before keeps its date.
    this.stampVerified = db.prepare<[string, string]>(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?`,
    )
    // \`OR IGNORE\` is the "never lower a role" rule: a row for this account in this place is
    // left exactly as it is. It does not hide a missing parent: a foreign-key failure is
    // still an error, and rolls everything back.
    this.grantEvent = db.prepare<[string, string, string, string]>(
      `INSERT OR IGNORE INTO event_memberships (event_id, user_id, role, granted_at)
            VALUES (?, ?, ?, ?)`,
    )
    this.grantClient = db.prepare<[string, string, string, string]>(
      `INSERT OR IGNORE INTO client_members (client_id, user_id, role, granted_at)
            VALUES (?, ?, ?, ?)`,
    )
  }

  async accept(record: AcceptInvitationRecord): Promise<InvitationAcceptanceOutcome> {
    return this.db
      .transaction((): InvitationAcceptanceOutcome => {
        const at = toIsoText(record.now)

        if (this.selectUsable.get(record.tokenId, at) === undefined) return 'spent'

        const { account, grant } = record
        if (account.kind === 'new' && this.selectEmailTaken.get(account.user.email.value)) {
          return 'emailTaken'
        }

        const spent = this.spend.run(at, record.tokenId, at)
        if (spent.changes !== 1) {
          throw new Error('the invitation was usable a moment ago and could not be spent')
        }

        const userId = account.kind === 'new' ? account.user.id : account.userId
        if (account.kind === 'new') {
          this.insertUser.run(...userRow(account.user))
        } else if (account.emailVerifiedAt !== null) {
          this.stampVerified.run(toIsoText(account.emailVerifiedAt), userId)
        }

        if (grant.kind === 'event') {
          this.grantEvent.run(grant.eventId, userId, grant.role, at)
        } else {
          this.grantClient.run(grant.clientId, userId, grant.role, at)
        }
        return 'accepted'
      })
      .immediate()
  }
}
