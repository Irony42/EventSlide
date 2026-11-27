import type { AccountToken } from '../../domain/users/accountToken'
import type { EmailAddress } from '../../domain/users/emailAddress'
import type { AccountTokenId, ClientId, UserId } from '../../domain/shared/ids'
import type {
  ConfirmationOutcome,
  SignupRequest,
  SignupStatus,
} from '../../domain/signups/signupRequest'

/**
 * The signup requests of a box (spec 31, ADR 0018) and, in the same transactions, the
 * confirmation tokens that prove their addresses.
 *
 * **Every transition is one conditional statement**, never read-decide-write: `better-sqlite3` is
 * synchronous, so a statement runs to completion before another begins, and the second of two callers
 * finds the row already moved. A boolean answer says whether this caller was the one that moved it.
 *
 * The confirmation token is an `account_tokens` row of purpose `emailVerification` with no account
 * (`userId` null). **Every query on those tokens is scoped to `user_id IS NULL`**: an
 * `emailVerification` token that belongs to an account is not a signup link, whatever its address. `admit` and `confirm` write it with the request in **one transaction**, which is why
 * they live here and not on `AccountTokenRepository`.
 */

/** What {@link SignupRepository.admit} decided, in one write. */
export type SignupAdmitOutcome =
  /** A new request and its confirmation token were stored. */
  | 'created'
  /** The address had an `unconfirmed` request more than an hour old: new token, old ones revoked, the request refreshed. */
  | 'resent'
  /** Nothing was written (the address is waiting, was refused lately, or is over its daily cap). */
  | 'silent'
  /** The box's daily ceiling is reached; nothing was written, whoever asked. */
  | 'busy'

export interface SignupAdmitInput {
  /** What the form produced, `unconfirmed`. Stored only on `created`; on `resent` its content replaces the earlier one. */
  readonly request: SignupRequest
  /** The confirmation token for `request.email`: purpose `emailVerification`, no account. Stored on `created` and `resent`. */
  readonly token: AccountToken
  readonly now: Date
  /** `SIGNUP_MAX_PER_DAY`: confirmation tokens the whole box may issue in 24 hours. */
  readonly maxPerDay: number
}

export interface SignupAdmitResult {
  readonly outcome: SignupAdmitOutcome
  /** Confirmation tokens issued in the last 24 hours once this call is done: what the 80 % alert reads. */
  readonly issuedToday: number
}

export interface SignupConfirmInput {
  /** SHA-256 of the token the link carried. */
  readonly tokenDigest: string
  readonly now: Date
  /** Where the confirmation leads: the operator's queue (`pending`) or the claim (`approving`). */
  readonly outcome: ConfirmationOutcome
}

export type SignupConfirmResult =
  /** The token was spent and the request moved, in one transaction: this is the request as it now stands. */
  | { readonly kind: 'confirmed'; readonly request: SignupRequest }
  /** Nothing changed: the token is unknown, spent, revoked or expired, or no `unconfirmed` request is left for its address. */
  | { readonly kind: 'invalid' }

/** What opening a link, without acting, may show. */
export interface SignupConfirmationPeek {
  /** `usable` only when pressing the button would work. */
  readonly state: 'usable' | 'spent' | 'expired'
  readonly email: EmailAddress
}

export interface SignupFinalization {
  /** The operator, or `null` when the system opened the account (mode `open`). */
  readonly decidedBy: UserId | null
  readonly clientId: ClientId
  readonly invitationTokenId: AccountTokenId | null
  readonly now: Date
  /** The stamp of the claim being finalised (`SignupRequest.claimedAt`): a claim given back and retaken is another claim. */
  readonly claimedAt: Date
}

/** A position in the list, as `signupListedAt` and the id give it: the next page starts strictly after it. */
export interface SignupListCursor {
  readonly at: Date
  readonly id: string
}

export interface SignupListFilter {
  /** Now: a `pending` request more than 30 days old is past decision (claim and refuse refuse it) and is left out. */
  readonly now: Date
  /** One state. `unconfirmed` lists nothing: an unproven address is never shown to an operator. */
  readonly status: SignupStatus
  /** Only requests decided or made since this instant (`decided_at`, else `confirmed_at`, else `created_at`): the 30-day window. */
  readonly since?: Date
  /** Only requests after this position in the newest-first order. */
  readonly before?: SignupListCursor
  /** At most this many; a caller that wants to know whether more follow asks for one more. */
  readonly limit: number
}

export interface SignupSweepResult {
  /** The requests that expired in this pass (the caller audits them); they are erased in the same pass. */
  readonly expiredIds: readonly string[]
  /** The claims older than an hour that went back to `pending` (the caller tells the operator). */
  readonly releasedIds: readonly string[]
  /** Rows erased, expired ones included. */
  readonly erased: number
}

export interface SignupRepository {
  /**
   * The admission, in one write transaction: refuses with `busy` at the daily ceiling, otherwise asks
   * the domain's `decideSignupAdmission` (fed with this address's requests, the issue time of its latest
   * confirmation token and its confirmations in the last 24 hours) and does what it says. A `silent` or
   * `busy` answer writes nothing.
   */
  admit(input: SignupAdmitInput): Promise<SignupAdmitResult>

  findById(id: string): Promise<SignupRequest | null>

  /** What the link would do, without doing it. `null` for a digest no confirmation token has. */
  peekConfirmation(tokenDigest: string, now: Date): Promise<SignupConfirmationPeek | null>

  /** Spends the token and moves the request out of `unconfirmed`, in one transaction. */
  confirm(input: SignupConfirmInput): Promise<SignupConfirmResult>

  /**
   * `pending` to `approving`, stamped `now`. `false` when another caller took it, it is not pending, or
   * it was made 30 days ago or more (a pending request past day 30 is expired even before the sweep).
   */
  claim(id: string, now: Date): Promise<boolean>

  /**
   * `approving` to `pending`: provisioning failed. Only the claim stamped `claimedAt` is given back, so a
   * late release after the sweep gave the claim back (and another caller took it) changes nothing.
   */
  release(id: string, claimedAt: Date): Promise<boolean>

  /** `approving` to `approved`, with the client and invitation it produced, for the claim stamped `finalization.claimedAt` only. */
  finalize(id: string, finalization: SignupFinalization): Promise<boolean>

  /** `pending` to `refused`; `false` too for a request made 30 days ago or more. */
  refuse(id: string, by: UserId, now: Date): Promise<boolean>

  /** Confirmed requests of one state for the operator, newest first, a page at a time. Never an `unconfirmed` one. */
  listForOperator(filter: SignupListFilter): Promise<readonly SignupRequest[]>

  /** Requests in `pending` that can still be decided (under 30 days old at `now`): the badge. */
  countPending(now: Date): Promise<number>

  /** Expires and erases what the retention rules say is due, and releases stale claims (`signupSweepAction`). */
  sweep(now: Date): Promise<SignupSweepResult>
}
