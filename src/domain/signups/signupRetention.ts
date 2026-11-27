import { addDays } from '../shared/time'
import type { SignupStatus } from './signupRequest'

/**
 * How long a signup request is kept (spec 31 section 4.3). The longest any request lives is
 * **60 days** (a refusal on day 29, kept 30 more), which is what the form's notice tells the person.
 *
 * - `unconfirmed`: erased 48 hours after it was made (token 24 h, then 24 h).
 * - `pending`: expires after 30 days without a decision (the sweep audits it, then erases it).
 * - `refused`: erased 30 days after the refusal; that row is what keeps the address quiet meanwhile.
 * - `approved`: erased when its invitation is accepted, or 24 hours after the invitation expired
 *   (7 days). The client and its audit line keep the trace.
 * - `expired`: erased by the sweep pass that made it, so it is due at once.
 * - `approving`: a claim in flight; no clock runs on it.
 */
export const SIGNUP_UNCONFIRMED_KEPT_HOURS = 48
export const SIGNUP_PENDING_EXPIRES_AFTER_DAYS = 30
export const SIGNUP_REFUSED_KEPT_DAYS = 30
export const SIGNUP_APPROVED_GRACE_HOURS = 24
/** The invitation's own life (`ACCOUNT_TOKEN_LIFETIME_MS.invitation`), as days. */
export const SIGNUP_INVITATION_LIFETIME_DAYS = 7

/** The most a request can be kept, in days: the bound the form's notice states. */
export const SIGNUP_MAX_KEPT_DAYS = 60

const HOUR_MS = 60 * 60 * 1000

/** What the sweep does with a request at an instant. */
export type SignupSweepAction = 'keep' | 'expire' | 'erase'

export interface SweepView {
  readonly status: SignupStatus
  readonly createdAt: Date
  readonly confirmedAt: Date | null
  readonly decidedAt: Date | null
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
      return new Date(view.createdAt.getTime() + SIGNUP_UNCONFIRMED_KEPT_HOURS * HOUR_MS)
    case 'pending':
      return addDays(view.confirmedAt ?? view.createdAt, SIGNUP_PENDING_EXPIRES_AFTER_DAYS)
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
      return null
  }
}

/** `expire` for a `pending` request past its date, `erase` for anything else past its date. */
export const signupSweepAction = (view: SweepView, now: Date): SignupSweepAction => {
  if (view.status === 'approved' && view.invitationAccepted) return 'erase'
  const due = signupDueAt(view)
  if (due === null || due.getTime() > now.getTime()) return 'keep'
  return view.status === 'pending' ? 'expire' : 'erase'
}
