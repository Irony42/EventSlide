import type { AccountTokenId, ClientId, UserId } from '../shared/ids'
import { DomainError } from '../shared/errors'
import { characterCount, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'
import { isCalendarDay } from '../shared/localDay'
import { addDays } from '../shared/time'
import { ClientName } from '../clients/clientName'
import { isClientLocale, type ClientLocale } from '../clients/clientLocale'
import type { EmailAddress } from '../users/emailAddress'

/**
 * A signup request (spec 31 section 4.1, ADR 0018): what a stranger typed into the public form,
 * and where it is on the way to an account. It is **a request, not an account**: nothing here is a
 * user, a client or a password. The account is born later, through the existing invitation.
 *
 * ```
 * unconfirmed -> pending -> approving -> approved
 *      |            |          |
 *      |            |          +-> pending   (provisioning failed: released)
 *      |            +-> refused | expired
 *      +-> approving            (mode `open`, disk guard passed: the confirmation is the claim)
 * ```
 *
 * `approving` is the **claim**: one caller moves a request there (a conditional UPDATE in the
 * repository), provisions, then finalises; a second caller finds it already taken. Every
 * transition below checks the state it leaves and refuses the rest with `signup.illegalTransition`.
 *
 * Pure and immutable: each transition returns a new value.
 */

export const SIGNUP_STATUSES = [
  'unconfirmed',
  'pending',
  'approving',
  'approved',
  'refused',
  'expired',
] as const

export type SignupStatus = (typeof SIGNUP_STATUSES)[number]

export const isSignupStatus = (value: unknown): value is SignupStatus =>
  typeof value === 'string' && (SIGNUP_STATUSES as readonly string[]).includes(value)

/** The space's name on the form: shorter than `clients.name` (200), which it becomes. */
export const SIGNUP_CLIENT_NAME_MAX = 80
export const SIGNUP_NOTE_MAX = 300

/** An event date may not be before yesterday, nor more than two years ahead. */
export const SIGNUP_EVENT_DATE_PAST_DAYS = 1
export const SIGNUP_EVENT_DATE_FUTURE_YEARS = 2

export interface SignupRequest {
  readonly id: string
  readonly email: EmailAddress
  readonly clientName: ClientName
  /** What the person wants the space for; `null` when left empty. */
  readonly note: string | null
  /** `YYYY-MM-DD`, or `null`. */
  readonly eventDate: string | null
  readonly locale: ClientLocale
  readonly status: SignupStatus
  readonly createdAt: Date
  readonly confirmedAt: Date | null
  /** When the request entered `approving`; `null` in every other state. The sweep gives a stale claim back. */
  readonly claimedAt: Date | null
  readonly decidedAt: Date | null
  /** The operator who decided; `null` for the system (mode `open`) or before any decision. */
  readonly decidedBy: UserId | null
  readonly clientId: ClientId | null
  readonly invitationTokenId: AccountTokenId | null
}

/** What the form hands over, already past the honeypot. */
export interface SignupFormInput {
  readonly id: string
  readonly email: EmailAddress
  readonly clientName: unknown
  readonly note?: unknown
  readonly eventDate?: unknown
  readonly locale: unknown
}

const utcDay = (at: Date): string => at.toISOString().slice(0, 10)

/** The last event date a form may carry: two calendar years after today. */
const latestEventDay = (now: Date): string => {
  const limit = new Date(now.getTime())
  limit.setUTCFullYear(limit.getUTCFullYear() + SIGNUP_EVENT_DATE_FUTURE_YEARS)
  return utcDay(limit)
}

const parseNote = (raw: unknown): Result<string | null, DomainError> => {
  if (raw === undefined || raw === null) return ok(null)
  if (typeof raw !== 'string') return err(DomainError.invalid('signup.note.invalid'))
  const cleaned = toSingleLine(raw)
  if (characterCount(cleaned) > SIGNUP_NOTE_MAX) {
    return err(DomainError.invalid('signup.note.tooLong', { max: SIGNUP_NOTE_MAX }))
  }
  return ok(cleaned === '' ? null : cleaned)
}

const parseEventDate = (raw: unknown, now: Date): Result<string | null, DomainError> => {
  if (raw === undefined || raw === null || raw === '') return ok(null)
  if (!isCalendarDay(raw)) return err(DomainError.invalid('signup.eventDate.invalid'))
  const earliest = utcDay(addDays(now, -SIGNUP_EVENT_DATE_PAST_DAYS))
  if (raw < earliest || raw > latestEventDay(now)) {
    return err(DomainError.invalid('signup.eventDate.outOfRange'))
  }
  return ok(raw)
}

/** A new request, `unconfirmed`, or the first field that is wrong. */
export const createSignupRequest = (
  input: SignupFormInput,
  now: Date,
): Result<SignupRequest, DomainError> => {
  const clientName = ClientName.create(input.clientName)
  if (!clientName.ok) return clientName
  if (characterCount(clientName.value.value) > SIGNUP_CLIENT_NAME_MAX) {
    return err(DomainError.invalid('signup.clientName.tooLong', { max: SIGNUP_CLIENT_NAME_MAX }))
  }
  const note = parseNote(input.note)
  if (!note.ok) return note
  const eventDate = parseEventDate(input.eventDate, now)
  if (!eventDate.ok) return eventDate
  if (!isClientLocale(input.locale)) return err(DomainError.invalid('signup.locale.invalid'))

  return ok({
    id: input.id,
    email: input.email,
    clientName: clientName.value,
    note: note.value,
    eventDate: eventDate.value,
    locale: input.locale,
    status: 'unconfirmed',
    createdAt: now,
    confirmedAt: null,
    claimedAt: null,
    decidedAt: null,
    decidedBy: null,
    clientId: null,
    invitationTokenId: null,
  })
}

const move = (
  request: SignupRequest,
  allowedFrom: readonly SignupStatus[],
  to: SignupStatus,
  changes: Partial<SignupRequest>,
): Result<SignupRequest, DomainError> =>
  allowedFrom.includes(request.status)
    ? ok({ ...request, ...changes, status: to })
    : err(DomainError.conflict('signup.illegalTransition', { from: request.status, to }))

/** Where a confirmed address goes: the claim itself, or the operator's queue. */
export type ConfirmationOutcome = 'approving' | 'pending'

/**
 * Where a confirmation leads. Only `open` with the disk guard satisfied goes straight to the claim;
 * `review`, and `open` held back by the guard (or unable to read the free space), wait for an operator.
 * (`off` takes no confirmation at all: the route does not exist.)
 */
export const confirmationOutcome = (
  mode: 'review' | 'open',
  diskGuardPassed: boolean,
): ConfirmationOutcome => (mode === 'open' && diskGuardPassed ? 'approving' : 'pending')

/**
 * What the confirmation answer tells the visitor, never a link (spec 31 section 3, step 4):
 * `review` (an operator will look), `mail` (the account opens and the invitation arrives by mail) or
 * `held` (`open`, but the request is back in the operator's queue: the disk guard said no, the free
 * space could not be read, or provisioning failed).
 */
export type SignupConfirmationNext = 'review' | 'mail' | 'held'

/**
 * The answer for a confirmation, from the mode and where the request ended up: `pending` after a
 * confirmation in `open` is the held case, and `approving` or `approved` is the mail one.
 */
export const signupConfirmationNext = (
  mode: 'review' | 'open',
  endedAs: 'pending' | 'approving' | 'approved',
): SignupConfirmationNext => {
  if (mode === 'review') return 'review'
  return endedAs === 'pending' ? 'held' : 'mail'
}

/** The address is proven: `unconfirmed` to `pending` or, for the automatic path, straight to `approving`. */
export const confirmSignupRequest = (
  request: SignupRequest,
  now: Date,
  outcome: ConfirmationOutcome,
): Result<SignupRequest, DomainError> =>
  move(request, ['unconfirmed'], outcome, {
    confirmedAt: now,
    claimedAt: outcome === 'approving' ? now : null,
  })

/** An operator takes a waiting request: `pending` to `approving`. */
export const claimSignupRequest = (
  request: SignupRequest,
  now: Date,
): Result<SignupRequest, DomainError> => move(request, ['pending'], 'approving', { claimedAt: now })

/** Provisioning failed: the claim is given back, `approving` to `pending`. */
export const releaseSignupRequest = (request: SignupRequest): Result<SignupRequest, DomainError> =>
  move(request, ['approving'], 'pending', { claimedAt: null })

export interface SignupApproval {
  /** The operator, or `null` when the system opened the account (mode `open`). */
  readonly decidedBy: UserId | null
  readonly clientId: ClientId
  readonly invitationTokenId: AccountTokenId | null
}

/** The client exists and its invitation is out: `approving` to `approved`. */
export const finalizeSignupRequest = (
  request: SignupRequest,
  now: Date,
  approval: SignupApproval,
): Result<SignupRequest, DomainError> =>
  move(request, ['approving'], 'approved', {
    claimedAt: null,
    decidedAt: now,
    decidedBy: approval.decidedBy,
    clientId: approval.clientId,
    invitationTokenId: approval.invitationTokenId,
  })

/** An operator says no: `pending` to `refused`. No reason is kept. */
export const refuseSignupRequest = (
  request: SignupRequest,
  now: Date,
  decidedBy: UserId,
): Result<SignupRequest, DomainError> =>
  move(request, ['pending'], 'refused', { decidedAt: now, decidedBy })

/** Nobody decided in time: `pending` to `expired` (the sweep writes the audit line, then erases). */
export const expireSignupRequest = (
  request: SignupRequest,
  now: Date,
): Result<SignupRequest, DomainError> => move(request, ['pending'], 'expired', { decidedAt: now })
