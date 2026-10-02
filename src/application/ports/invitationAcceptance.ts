import type { AccountTokenId, UserId } from '../../domain/shared/ids'
import type { InvitationTarget } from '../../domain/users/accountToken'
import type { User } from '../../domain/users/user'

/**
 * Spending an invitation (docs/ROADMAP.md §10.3; free plan G2-09, paid plan P3-10): the
 * stored half of "this person accepted".
 *
 * ## Why this is a port of its own
 *
 * Accepting an invitation is four writes that mean nothing apart: **spend the link**,
 * **create the account** (when the address has none), **grant what the link grants**, and
 * **stamp the mailbox as proved** (when the link came by mail). Done one after another through
 * the ports that own each table, a failure between any two of them leaves somebody worse off
 * than they were: a link spent for an account that was never made is an invitation its holder
 * cannot use and cannot ask to have repeated; an account made without its place is a sign-in
 * that opens nothing; and two people accepting two links for one new address at the same
 * moment would each spend theirs and one of them would lose their account to the unique index.
 * `EventRepository.createWithOwner` exists for the same reason. So the adapter does all of it
 * in one write transaction, and nothing here is observable half-done.
 *
 * It also leaves room for the next writer: the acceptance of the terms (G2-20) is an audit
 * entry that has to be in the same transaction, and this is the port it will join.
 *
 * ## What it decides, and what it leaves to the caller
 *
 * The caller decides **who may accept** — the signed-in account whose address the link was
 * written to, or a person choosing a password for an address that has no account — and parses
 * and hashes everything before asking, so no hashing happens inside a transaction that holds
 * the database's one writer. This port decides only what the database can: whether the link
 * can still be spent, whether the address is still free, and that the writes happen together
 * or not at all.
 */

/** Who the link is accepted as. */
export type AcceptingAccount =
  /**
   * A person choosing a password for an address that has no account. The `User` is built by
   * the caller, already carrying `emailVerifiedAt` if the link came by mail; **nothing exists
   * in `users` until this is accepted**, which is the point of the whole feature.
   */
  | { readonly kind: 'new'; readonly user: User }
  /**
   * An account that already uses the address and is signed in. Its password, name and role on
   * the box are never touched. `emailVerifiedAt` is stamped if given and the account has none;
   * an account that was verified before keeps its first proof.
   */
  | { readonly kind: 'existing'; readonly userId: UserId; readonly emailVerifiedAt: Date | null }

export interface AcceptInvitationRecord {
  readonly tokenId: AccountTokenId
  /** The instant the link is judged usable at, and the stamp of the spend and the grant. */
  readonly now: Date
  readonly account: AcceptingAccount
  /** What the link grants. The caller read it from the token it just found usable. */
  readonly grant: InvitationTarget
}

/**
 * - `accepted`: the link is spent, the account exists, the grant is in place.
 * - `spent`: the link could not be spent — already used, revoked, expired, waiting for an
 *   approval it has not had, or unknown. **Nothing was written.** The caller cannot tell
 *   which, and neither can a stranger holding the link.
 * - `emailTaken`: a new account was asked for and the address already has one. **Nothing was
 *   written, and the link is still usable** — the person is told to sign in and accept it as
 *   that account. Checked after `spent`, so a dead link is never reported as anything else.
 */
export type InvitationAcceptanceOutcome = 'accepted' | 'spent' | 'emailTaken'

export interface InvitationAcceptance {
  /**
   * Spends the link and, in the same transaction, creates the account if it is new, grants
   * `grant`, and stamps the mailbox as proved.
   *
   * **The grant never overwrites a role the account already holds in that place.** A
   * co-owner who is invited to moderate the event they co-own is still its owner, and a
   * client's owner who is invited as a member is still its owner: accepting a link can add a
   * place, never lower one. The link is spent either way — it was used.
   *
   * **Exactly one of any number of concurrent calls for one link answers `accepted`.**
   *
   * Throws, like every writer here, for what the caller was meant to rule out: an existing
   * account or a place that is gone. Nothing is left written when it does.
   */
  accept(record: AcceptInvitationRecord): Promise<InvitationAcceptanceOutcome>
}
