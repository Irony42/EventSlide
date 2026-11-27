import { addDays } from '../shared/time'
import type { SignupStatus } from './signupRequest'

/**
 * What the box does with one public request for one address at one instant (spec 31 section 4.2).
 *
 * **No branch depends on whether the address already has an account**: it would be an oracle for who
 * uses the box. An existing user follows the same road and gets the same mail.
 *
 * - `create`: a new request and a confirmation mail.
 * - `resend`: the address has an `unconfirmed` request whose last mail is more than an hour old: a
 *   new token (the old one revoked) and a new mail, on the same request.
 * - `silent`: nothing is written and nothing is sent, and the visitor cannot tell.
 *
 * The box-wide daily ceiling (`SIGNUP_MAX_PER_DAY`) is configuration and is applied in the same write
 * as the admission, not here.
 */
export type SignupAdmission = 'create' | 'resend' | 'silent'

/** Confirmation mails one address may be sent in 24 hours, whatever happened to the requests. */
export const SIGNUP_MAX_PER_ADDRESS_PER_DAY = 3

/** After a refusal the same address is left alone for this long. */
export const SIGNUP_REFUSED_SILENCE_DAYS = 30

/** An `unconfirmed` request is not resent to before this has passed since its last mail. */
export const SIGNUP_RESEND_AFTER_MS = 60 * 60 * 1000

/** One earlier request of this address, as the admission needs to see it. */
export interface AddressRequestView {
  readonly status: SignupStatus
  /** When it was decided, for `refused`. */
  readonly decidedAt: Date | null
  /** When the latest confirmation mail was issued for it (its token's issue time). */
  readonly lastConfirmationAt: Date
}

export interface AdmissionInput {
  readonly now: Date
  /** Every request still held for the address (the repository erases the rest). */
  readonly requests: readonly AddressRequestView[]
  /** Confirmation mails issued to the address in the last 24 hours. */
  readonly confirmationsInLastDay: number
}

const waitsForDecision = (status: SignupStatus): boolean =>
  status === 'pending' || status === 'approving'

export const decideSignupAdmission = ({
  now,
  requests,
  confirmationsInLastDay,
}: AdmissionInput): SignupAdmission => {
  if (requests.some((request) => waitsForDecision(request.status))) return 'silent'

  const silenceFrom = addDays(now, -SIGNUP_REFUSED_SILENCE_DAYS).getTime()
  const recentlyRefused = requests.some(
    (request) =>
      request.status === 'refused' &&
      request.decidedAt !== null &&
      request.decidedAt.getTime() > silenceFrom,
  )
  if (recentlyRefused) return 'silent'

  if (confirmationsInLastDay >= SIGNUP_MAX_PER_ADDRESS_PER_DAY) return 'silent'

  const unconfirmed = requests.find((request) => request.status === 'unconfirmed')
  if (unconfirmed === undefined) return 'create'
  const waited = now.getTime() - unconfirmed.lastConfirmationAt.getTime()
  return waited > SIGNUP_RESEND_AFTER_MS ? 'resend' : 'silent'
}
