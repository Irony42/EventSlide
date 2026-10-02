import {
  isAccountTokenUsable,
  isTokenDigest,
  type AccountToken,
} from '../../domain/users/accountToken'
import type { EmailAddress } from '../../domain/users/emailAddress'
import type { AccountTokenId, EventId, UserId } from '../../domain/shared/ids'
import type { AccountTokenPurpose } from '../../domain/users/accountToken'
import type { AccountTokenRepository } from '../ports/accountTokenRepository'

/**
 * In-memory `AccountTokenRepository`.
 *
 * What has to behave is what the SQLite adapter's constraints and conditional `UPDATE`s
 * do: the digest and the id are unique, a token can name only an account (and an event) that
 * exists, and `consume`, `approve` and `revokeOutstanding` change a token **only if it is
 * still in the state they expect** — which is the whole concurrency story. Every method here
 * runs to completion before another starts, so two concurrent `consume` calls for one token
 * resolve one after the other and the second sees it spent, exactly as the database makes
 * them.
 *
 * Foreign keys are mirrored by {@link FakeAccountTokenRepository.withAccounts} and
 * {@link FakeAccountTokenRepository.withEvents}, the way `FakeAuditLog` mirrors its actor:
 * a fake that accepted a token for an account that does not exist would pass tests the real
 * table would fail. A repository built without them knows no accounts and refuses every
 * token that names one, so a test that does not care states nothing and a test that does
 * says who exists.
 */
export class FakeAccountTokenRepository implements AccountTokenRepository {
  private readonly rows = new Map<AccountTokenId, AccountToken>()
  private readonly accounts = new Set<UserId>()
  private readonly events = new Set<EventId>()

  /** The accounts that exist, for the foreign keys on `user_id`, `created_by`, `approved_by`. */
  withAccounts(...ids: readonly UserId[]): this {
    for (const id of ids) this.accounts.add(id)
    return this
  }

  /** The events that exist, for the foreign key on `event_id`. */
  withEvents(...ids: readonly EventId[]): this {
    for (const id of ids) this.events.add(id)
    return this
  }

  /** Every token held, in issue order. For a test to look at, not for a use case to read. */
  get all(): readonly AccountToken[] {
    return [...this.rows.values()]
  }

  async save(token: AccountToken): Promise<void> {
    if (this.rows.has(token.id)) {
      throw new Error('UNIQUE constraint failed: account_tokens.id')
    }
    for (const row of this.rows.values()) {
      if (row.tokenDigest === token.tokenDigest) {
        throw new Error('UNIQUE constraint failed: account_tokens.token_digest')
      }
    }
    this.mustExist(token.userId)
    this.mustExist(token.createdBy)
    this.mustExist(token.approvedBy)
    if (token.eventId !== null && !this.events.has(token.eventId)) {
      throw new Error('FOREIGN KEY constraint failed: account_tokens.event_id')
    }
    // The table's `CHECK`: a digest is a SHA-256 in lower-case hex, and a token written
    // in its place is the likeliest mistake there is.
    if (!isTokenDigest(token.tokenDigest)) {
      throw new Error('CHECK constraint failed: length(token_digest) = 64')
    }
    if (token.expiresAt.getTime() <= token.createdAt.getTime()) {
      throw new Error('CHECK constraint failed: expires_at > created_at')
    }
    this.rows.set(token.id, token)
  }

  private mustExist(account: UserId | null): void {
    if (account !== null && !this.accounts.has(account)) {
      throw new Error('FOREIGN KEY constraint failed: the account does not exist')
    }
  }

  async findUsable(
    digest: string,
    purpose: AccountTokenPurpose,
    now: Date,
  ): Promise<AccountToken | null> {
    for (const row of this.rows.values()) {
      if (row.tokenDigest === digest && row.purpose === purpose) {
        return isAccountTokenUsable(row, now) ? row : null
      }
    }
    return null
  }

  async consume(id: AccountTokenId, now: Date): Promise<boolean> {
    const row = this.rows.get(id)
    if (row === undefined || !isAccountTokenUsable(row, now)) return false
    this.rows.set(id, { ...row, consumedAt: now })
    return true
  }

  async approve(id: AccountTokenId, by: UserId, now: Date): Promise<boolean> {
    const row = this.rows.get(id)
    if (
      row === undefined ||
      !row.requiresApproval ||
      row.approvedAt !== null ||
      row.consumedAt !== null ||
      row.revokedAt !== null ||
      row.expiresAt.getTime() <= now.getTime()
    ) {
      return false
    }
    this.mustExist(by)
    this.rows.set(id, { ...row, approvedBy: by, approvedAt: now })
    return true
  }

  async revokeOutstanding(
    email: EmailAddress,
    purpose: AccountTokenPurpose,
    now: Date,
  ): Promise<number> {
    let revoked = 0
    for (const [id, row] of this.rows) {
      // Outstanding means *spendable but for approval*: a link still waiting to be approved
      // is a link that could be, so it is revoked too. That is `isAccountTokenUsable`
      // without its approval clause, written out because the clause is the one difference.
      const outstanding =
        row.email.equals(email) &&
        row.purpose === purpose &&
        row.consumedAt === null &&
        row.revokedAt === null &&
        row.expiresAt.getTime() > now.getTime()
      if (outstanding) {
        this.rows.set(id, { ...row, revokedAt: now })
        revoked += 1
      }
    }
    return revoked
  }

  async countCreatedSince(
    email: EmailAddress,
    purpose: AccountTokenPurpose,
    since: Date,
  ): Promise<number> {
    return [...this.rows.values()].filter(
      (row) =>
        row.email.equals(email) &&
        row.purpose === purpose &&
        row.createdAt.getTime() > since.getTime(),
    ).length
  }

  async deleteExpired(before: Date): Promise<number> {
    let deleted = 0
    for (const [id, row] of this.rows) {
      if (row.expiresAt.getTime() < before.getTime()) {
        this.rows.delete(id)
        deleted += 1
      }
    }
    return deleted
  }
}
