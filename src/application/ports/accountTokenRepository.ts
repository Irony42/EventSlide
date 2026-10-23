import type {
  AccountToken,
  AccountTokenPurpose,
  InvitationTarget,
} from '../../domain/users/accountToken'
import type { EmailAddress } from '../../domain/users/emailAddress'
import type { AccountTokenId, UserId } from '../../domain/shared/ids'

/**
 * Account tokens (docs/ROADMAP.md §10.3; free plan G2-08, paid plan P3-09): the stored half
 * of every link that proves control of a mailbox. The rules of what a token is live in
 * `domain/users/accountToken.ts`; this port is where they are made true under concurrency.
 *
 * ## Spending is one statement, never read-then-write
 *
 * {@link AccountTokenRepository.consume} is a single conditional `UPDATE` that reports
 * whether **this** call was the one that changed the row. Two requests carrying the same
 * link at the same instant read the same usable token, and exactly one of them may go on to
 * change a password; the other must be told no. Only the database can say which — a use case
 * that read the token, checked it, and wrote it back would let both through. So the token is
 * immutable in the domain and the three transitions it can make (spent, approved, revoked)
 * are methods here, each answering whether it happened.
 *
 * ## No method takes or returns a secret
 *
 * Everything is addressed by the **digest**. A repository that is handed a token can write
 * it down; one that never sees it cannot.
 */
export interface AccountTokenRepository {
  /**
   * Stores a new token. Insert only: a duplicate id or a duplicate digest is an error, not
   * an overwrite, and so is a user (or event) that does not exist.
   */
  save(token: AccountToken): Promise<void>

  /**
   * The token whose digest this is, **if it could be spent right now** for this purpose:
   * not spent, not revoked, not expired, and approved if it needed approval. `null` for
   * everything else — an unknown digest, a token issued for another purpose, a dead one —
   * and the caller cannot tell which, because neither can a stranger holding it.
   *
   * Expiry is exclusive: a token is dead *at* its `expiresAt`.
   */
  findUsable(digest: string, purpose: AccountTokenPurpose, now: Date): Promise<AccountToken | null>

  /**
   * Spends the token: `true` if this call changed it from usable to spent, `false` if it was
   * already spent, revoked, expired, waiting for approval, or does not exist.
   *
   * **Exactly one of any number of concurrent calls for one token answers `true`.** That is
   * the guarantee a password reset is built on.
   */
  consume(id: AccountTokenId, now: Date): Promise<boolean>

  /**
   * Records that `by` approved a token that needed it: `true` if this call did, `false` if
   * the token does not need approval, was already approved, or is dead. Approval makes a
   * token usable; it does not spend it.
   *
   * Who may approve is a policy, and the policy is the caller's: this only makes the
   * transition atomic.
   */
  approve(id: AccountTokenId, by: UserId, now: Date): Promise<boolean>

  /**
   * Revokes every token for this address and purpose that could still be spent, and says how
   * many it was. Issuing a new reset link calls this first, so there is only ever one link
   * that works, and the newest one is it.
   *
   * Tokens already spent, revoked or expired are left exactly as they were.
   */
  revokeOutstanding(email: EmailAddress, purpose: AccountTokenPurpose, now: Date): Promise<number>

  /**
   * Revokes every invitation written to this address **for this event or this client** that
   * could still be spent (or is waiting for the approval that would make it so), and says how
   * many it was. Issuing an invitation calls this first, so an address has one live link to a
   * given place and the newest one is it: the inviter who lost a link, or sent it to the wrong
   * channel, can replace it and know the first no longer opens anything.
   *
   * The match is on the **place** — the event, or the client — and not on the role: inviting
   * someone as an owner supersedes the link that invited them as a member. It is also
   * confined to that place and to invitations. Another event's link to the same address, a
   * pending reset, a spent or expired link are left exactly as they were: this is not
   * {@link AccountTokenRepository.revokeOutstanding}, which revokes by purpose and would
   * cancel an invitation to a different wedding.
   */
  revokeOutstandingInvitations(
    email: EmailAddress,
    target: InvitationTarget,
    now: Date,
  ): Promise<number>

  /**
   * How many tokens for this address and purpose were issued **after** `since` (exclusive),
   * whatever has become of them. This is what bounds how many mails an address can be sent in
   * an hour: a spent or revoked token still counts as a mail that went out.
   */
  countCreatedSince(email: EmailAddress, purpose: AccountTokenPurpose, since: Date): Promise<number>

  /**
   * Deletes the tokens that expired **before** `before` (exclusive), and says how many. A row
   * is housekeeping once it can no longer be spent, and it holds an address.
   */
  deleteExpired(before: Date): Promise<number>
}
