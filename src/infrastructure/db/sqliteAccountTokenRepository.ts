import type { AccountTokenRepository } from '../../application/ports/accountTokenRepository'
import {
  asAccountTokenId,
  asEventId,
  asUserId,
  type AccountTokenId,
  type UserId,
} from '../../domain/shared/ids'
import {
  isAccountTokenPurpose,
  type AccountToken,
  type AccountTokenDelivery,
  type AccountTokenEventRole,
  type AccountTokenPurpose,
} from '../../domain/users/accountToken'
import { EmailAddress } from '../../domain/users/emailAddress'
import type { Db } from './connection'
import {
  fromIsoText,
  fromNullableIsoText,
  fromSqliteBoolean,
  toIsoText,
  toSqliteBoolean,
} from './rowMapping'

/**
 * `account_tokens` (migration 010).
 *
 * **Every transition is one conditional statement**, and `better-sqlite3` is synchronous:
 * a statement runs to completion before any other on the connection starts, so two requests
 * carrying one link resolve one after the other and the second finds the row already spent.
 * That is what the port's "exactly one wins" rests on, and it is why nothing here reads a
 * token, decides, and writes it back.
 *
 * The digest is the only key a caller ever has, and it is compared by the index. The
 * secret itself never reaches this file.
 */

const COLUMNS = `id, purpose, token_digest, email, user_id, event_id, event_role, delivery,
                 requires_approval, approved_by, approved_at, created_by, created_at,
                 expires_at, consumed_at, revoked_at`

interface AccountTokenRow {
  readonly id: string
  readonly purpose: string
  readonly token_digest: string
  readonly email: string
  readonly user_id: string | null
  readonly event_id: string | null
  readonly event_role: string | null
  readonly delivery: string
  readonly requires_approval: number
  readonly approved_by: string | null
  readonly approved_at: string | null
  readonly created_by: string | null
  readonly created_at: string
  readonly expires_at: string
  readonly consumed_at: string | null
  readonly revoked_at: string | null
}

/**
 * The definition of "could be spent right now", in SQL, with one placeholder: `now`.
 *
 * Written once and used by both {@link SqliteAccountTokenRepository.findUsable} and
 * {@link SqliteAccountTokenRepository.consume}, so what a lookup calls usable and what a
 * spend accepts cannot drift apart. `expires_at > now` is exclusive on purpose: a token is
 * dead at its expiry. The approval clause is the reason this is not simply "not consumed":
 * a token that needs somebody else's approval is not spendable until it has it.
 *
 * ISO-8601 UTC text sorts as time, which is what makes these string comparisons honest.
 */
const USABLE = `consumed_at IS NULL
                AND revoked_at IS NULL
                AND expires_at > ?
                AND (requires_approval = 0 OR approved_at IS NOT NULL)`

const deliveryOf = (raw: string): AccountTokenDelivery => {
  if (raw !== 'mail' && raw !== 'link') {
    throw new Error(`account_tokens.delivery holds a value the domain rejects (${raw})`)
  }
  return raw
}

const eventRoleOf = (raw: string | null): AccountTokenEventRole | null => {
  if (raw === null) return null
  if (raw !== 'moderator') {
    throw new Error(`account_tokens.event_role holds a value the domain rejects (${raw})`)
  }
  return raw
}

const purposeOf = (raw: string): AccountTokenPurpose => {
  if (!isAccountTokenPurpose(raw)) {
    throw new Error(`account_tokens.purpose holds a value the domain rejects (${raw})`)
  }
  return raw
}

const emailOf = (raw: string): EmailAddress => {
  const parsed = EmailAddress.create(raw)
  if (!parsed.ok) {
    throw new Error(`account_tokens.email holds a value the domain rejects (${parsed.error.code})`)
  }
  return parsed.value
}

const optionalUser = (raw: string | null): UserId | null => (raw === null ? null : asUserId(raw))

const toToken = (row: AccountTokenRow): AccountToken => ({
  id: asAccountTokenId(row.id),
  purpose: purposeOf(row.purpose),
  tokenDigest: row.token_digest,
  email: emailOf(row.email),
  userId: optionalUser(row.user_id),
  eventId: row.event_id === null ? null : asEventId(row.event_id),
  eventRole: eventRoleOf(row.event_role),
  delivery: deliveryOf(row.delivery),
  requiresApproval: fromSqliteBoolean(row.requires_approval),
  approvedBy: optionalUser(row.approved_by),
  approvedAt: fromNullableIsoText(row.approved_at),
  createdBy: optionalUser(row.created_by),
  createdAt: fromIsoText(row.created_at),
  expiresAt: fromIsoText(row.expires_at),
  consumedAt: fromNullableIsoText(row.consumed_at),
  revokedAt: fromNullableIsoText(row.revoked_at),
})

const isoOrNull = (date: Date | null): string | null => (date === null ? null : toIsoText(date))

export class SqliteAccountTokenRepository implements AccountTokenRepository {
  constructor(private readonly db: Db) {}

  async save(token: AccountToken): Promise<void> {
    // A plain INSERT, never an upsert: a token is written once, and a duplicate id or digest
    // must fail loudly instead of replacing somebody's link.
    this.db
      .prepare(
        `INSERT INTO account_tokens (${COLUMNS})
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token.id,
        token.purpose,
        token.tokenDigest,
        token.email.value,
        token.userId,
        token.eventId,
        token.eventRole,
        token.delivery,
        toSqliteBoolean(token.requiresApproval),
        token.approvedBy,
        isoOrNull(token.approvedAt),
        token.createdBy,
        toIsoText(token.createdAt),
        toIsoText(token.expiresAt),
        isoOrNull(token.consumedAt),
        isoOrNull(token.revokedAt),
      )
  }

  async findUsable(
    digest: string,
    purpose: AccountTokenPurpose,
    now: Date,
  ): Promise<AccountToken | null> {
    const row = this.db
      .prepare<[string, string, string], AccountTokenRow>(
        `SELECT ${COLUMNS} FROM account_tokens
          WHERE token_digest = ? AND purpose = ? AND ${USABLE}`,
      )
      .get(digest, purpose, toIsoText(now))

    return row === undefined ? null : toToken(row)
  }

  async consume(id: AccountTokenId, now: Date): Promise<boolean> {
    const at = toIsoText(now)
    const result = this.db
      .prepare<[string, string, string]>(
        `UPDATE account_tokens SET consumed_at = ?
          WHERE id = ? AND ${USABLE}`,
      )
      .run(at, id, at)

    return result.changes === 1
  }

  async approve(id: AccountTokenId, by: UserId, now: Date): Promise<boolean> {
    const at = toIsoText(now)
    const result = this.db
      .prepare<[string, string, string, string]>(
        `UPDATE account_tokens SET approved_by = ?, approved_at = ?
          WHERE id = ?
            AND requires_approval = 1
            AND approved_at IS NULL
            AND consumed_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > ?`,
      )
      .run(by, at, id, at)

    return result.changes === 1
  }

  async revokeOutstanding(
    email: EmailAddress,
    purpose: AccountTokenPurpose,
    now: Date,
  ): Promise<number> {
    const at = toIsoText(now)
    // `USABLE` without its approval clause: a link still waiting to be approved is one an
    // approval would make spendable, so it is outstanding too.
    const result = this.db
      .prepare<[string, string, string, string]>(
        `UPDATE account_tokens SET revoked_at = ?
          WHERE email = ? AND purpose = ?
            AND consumed_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > ?`,
      )
      .run(at, email.value, purpose, at)

    return result.changes
  }

  async countCreatedSince(
    email: EmailAddress,
    purpose: AccountTokenPurpose,
    since: Date,
  ): Promise<number> {
    const row = this.db
      .prepare<[string, string, string], { readonly issued: number }>(
        `SELECT COUNT(*) AS issued FROM account_tokens
          WHERE email = ? AND purpose = ? AND created_at > ?`,
      )
      .get(email.value, purpose, toIsoText(since))

    return row?.issued ?? 0
  }

  async deleteExpired(before: Date): Promise<number> {
    const result = this.db
      .prepare<[string]>(`DELETE FROM account_tokens WHERE expires_at < ?`)
      .run(toIsoText(before))

    return result.changes
  }
}
