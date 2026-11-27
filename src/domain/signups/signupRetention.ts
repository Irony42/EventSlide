import { addDays } from '../shared/time'
import type { SignupStatus } from './signupRequest'

/**
 * How long a signup request is kept (spec 31 section 4.3). The longest any request lives is
 * **60 days after the person last submitted the form** (a refusal on day 29, kept 30 more), which is
 * what the form's notice tells the person.
 *
 * - `unconfirmed`: erased 24 hours after its **last** confirmation link expired (a link lives 24 h,
 *   so 48 h after the last submission, and a resend moves the date).
 * - `pending`: expires **30 days after the request was made** (a resend counts as making it again;
 *   not after its confirmation, or the bound below would not hold). From then on it cannot be claimed
 *   or refused, whether or not the sweep has run, and the sweep audits it, then erases it.
 * - `refused`: erased 30 days after the refusal; that row is what keeps the address quiet meanwhile.
 * - `approved`: erased when its invitation is accepted, or 24 hours after the invitation expired
 *   (7 days). The client and its audit line keep the trace.
 * - `expired`: erased by the sweep pass that made it, so it is due at once.
 * - `approving`: a claim in flight. One that is more than an hour old is given back to `pending`
 *   (a provisioning that never finished), where an operator sees it and the 30 days still run.
 */
// Kept this long after the last confirmation link expired.
export const SIGNUP_UNCONFIRMED_GRACE_HOURS = 24
// The confirmation link's own life (`ACCOUNT_TOKEN_LIFETIME_MS.emailVerification`), as hours.
export const SIGNUP_CONFIRMATION_LIFETIME_HOURS = 24
export const SIGNUP_PENDING_EXPIRES_AFTER_DAYS = 30
export const SIGNUP_REFUSED_KEPT_DAYS = 30
export const SIGNUP_APPROVED_GRACE_HOURS = 24
/** The invitation's own life (`ACCOUNT_TOKEN_LIFETIME_MS.invitation`), as days. */
export const SIGNUP_INVITATION_LIFETIME_DAYS = 7
/** A claim older than this is released. */
export const SIGNUP_CLAIM_STALE_MINUTES = 60

/** The most a request can be kept, in days: the bound the form's notice states. */
export const SIGNUP_MAX_KEPT_DAYS = 60

const HOUR_MS = 60 * 60 * 1000

/** What the sweep does with a request at an instant. */
export type SignupSweepAction = 'keep' | 'expire' | 'erase' | 'release'

export interface SweepView {
  readonly status: SignupStatus
  readonly createdAt: Date
  readonly claimedAt: Date | null
  readonly decidedAt: Date | null
  /**
   * When the latest confirmation link of the address stops working, for `unconfirmed`. `null` when
   * none is held: the request then counts from its creation, as if its one link had been issued then.
   */
  readonly lastConfirmationExpiresAt: Date | null
  /** Whether the invitation of an `approved` request was accepted. */
  readonly invitationAccepted: boolean
}

/**
 * The moment a request is erased or expires, or `null` when no clock runs on it. For `pending` it is
 * the moment of expiry, not of erasure (the sweep erases in the pass that follows, after the audit line).
 */
export const signupDueAt = (view: SweepView): Date | null => {
  switch (view.status) {
    case 'unconfirmed':
      return new Date(
        (
          view.lastConfirmationExpiresAt ??
          new Date(view.createdAt.getTime() + SIGNUP_CONFIRMATION_LIFETIME_HOURS * HOUR_MS)
        ).getTime() +
          SIGNUP_UNCONFIRMED_GRACE_HOURS * HOUR_MS,
      )
    case 'pending':
      return addDays(view.createdAt, SIGNUP_PENDING_EXPIRES_AFTER_DAYS)
    case 'refused':
      return view.decidedAt === null ? null : addDays(view.decidedAt, SIGNUP_REFUSED_KEPT_DAYS)
    case 'approved':
      return view.decidedAt === null
        ? null
        : new Date(
            addDays(view.decidedAt, SIGNUP_INVITATION_LIFETIME_DAYS).getTime() +
              SIGNUP_APPROVED_GRACE_HOURS * HOUR_MS,
          )
    case 'expired':
      return view.decidedAt ?? view.createdAt
    case 'approving':
      return view.claimedAt === null
        ? null
        : new Date(view.claimedAt.getTime() + SIGNUP_CLAIM_STALE_MINUTES * 60 * 1000)
  }
}

/** `expire` a `pending` request past its date, `release` a stale claim, `erase` anything else past its date. */
export const signupSweepAction = (view: SweepView, now: Date): SignupSweepAction => {
  if (view.status === 'approved' && view.invitationAccepted) return 'erase'
  const due = signupDueAt(view)
  if (due === null || due.getTime() > now.getTime()) return 'keep'
  if (view.status === 'pending') return 'expire'
  return view.status === 'approving' ? 'release' : 'erase'
}
