import type { AccountToken } from '../../domain/users/accountToken'
import type { EmailAddress } from '../../domain/users/emailAddress'
import type { AccountTokenId, ClientId, UserId } from '../../domain/shared/ids'
import type { ConfirmationOutcome, SignupRequest, SignupStatus } from '../../domain/signups/signupRequest'

/**
 * The signup requests of a box (spec 31, ADR 0018) and, in the same transactions, the
 * confirmation tokens that prove their addresses.
 *
 * **Every transition is one conditional statement**, never read-decide-write: `better-sqlite3` is
 * synchronous, so a statement runs to completion before another begins, and the second of two callers
 * finds the row already moved. A boolean answer says whether this caller was the one that moved it.
 *
 * The confirmation token is an `account_tokens` row of purpose `emailVerification` with no account
 * (`userId` null). `admit` and `confirm` write it with the request in **one transaction**, which is why
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
}

export interface SignupListFilter {
  /** Which states to list. `unconfirmed` is ignored: an unproven address is never shown to an operator. */
  readonly statuses: readonly SignupStatus[]
  /** Only requests decided or made since this instant (`decided_at`, else `confirmed_at`). */
  readonly since?: Date
  readonly limit: number
}

export interface SignupSweepResult {
  /** The requests that expired in this pass (the caller audits them); they are erased in the same pass. */
  readonly expiredIds: readonly string[]
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

  /** `pending` to `approving`. `false` when another caller took it, or it is not pending. */
  claim(id: string): Promise<boolean>

  /** `approving` to `pending`: provisioning failed. */
  release(id: string): Promise<boolean>

  /** `approving` to `approved`, with the client and invitation it produced. */
  finalize(id: string, finalization: SignupFinalization): Promise<boolean>

  /** `pending` to `refused`. */
  refuse(id: string, by: UserId, now: Date): Promise<boolean>

  /** Confirmed requests for the operator, newest first. Never an `unconfirmed` one. */
  listForOperator(filter: SignupListFilter): Promise<readonly SignupRequest[]>

  /** Requests in `pending`: the badge. */
  countPending(): Promise<number>

  /** Expires and erases what the retention rules say is due (`signupSweepAction`). */
  sweep(now: Date): Promise<SignupSweepResult>
}
