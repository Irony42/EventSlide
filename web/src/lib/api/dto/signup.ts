// Self-service signup, as a visitor sees it (spec 31, §5 of the spec).

/**
 * `POST /api/signup`'s answer (`202`). `sent` is the same word for a new address, a known one,
 * one with a request waiting and one over its caps: the form is never an oracle. `busy` is the
 * one exception, and says nothing about an address: the whole box has reached its confirmations
 * for the day.
 */
export interface SignupAnswerDto {
  readonly status: 'sent' | 'busy'
}

/**
 * What a confirmation link is, read without spending it (`GET /api/signup/confirm/:token`).
 * `maskedEmail` is the address with most of its local part hidden (`l•••@gmail.com`).
 */
export interface SignupPreviewDto {
  readonly state: 'usable' | 'spent' | 'expired'
  readonly maskedEmail: string
}

/**
 * What pressing "Confirm" came to (`POST /api/signup/confirm/:token`). Never a link: the
 * invitation that lets the person choose a password exists only in the mail.
 *
 * - `mail`: the account is open and the invitation is on its way (mode `open`).
 * - `review`: the request waits for the operator's decision (mode `review`).
 * - `held`: mode `open`, but the disk guard held the request back; the account opens as soon as
 *   there is room.
 */
export interface SignupConfirmedDto {
  readonly next: 'review' | 'mail' | 'held'
}
