import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { addDays } from '../../../domain/shared/time'
import { signupListedAt, type SignupRequest } from '../../../domain/signups/signupRequest'
import type { Clock } from '../../ports/clock'
import type { SignupListCursor, SignupRepository } from '../../ports/signupRepository'
import type { UserRepository } from '../../ports/userRepository'

export const SIGNUP_LIST_STATUSES = ['pending', 'approved', 'refused'] as const
export type SignupListStatus = (typeof SIGNUP_LIST_STATUSES)[number]

export const DEFAULT_SIGNUP_PAGE_SIZE = 50
export const MAX_SIGNUP_PAGE_SIZE = 100
/** What the operator sees of the decided requests: the last 30 days. */
export const SIGNUP_DECIDED_WINDOW_DAYS = 30

export interface ListSignupsInput {
  readonly status: SignupListStatus
  readonly limit?: number
  readonly before?: SignupListCursor
}

export interface OperatorSignup {
  readonly request: SignupRequest
  /** An account already answers to this address: the person will have to sign in to accept. */
  readonly existingAccount: boolean
}

export interface OperatorSignupPage {
  readonly items: readonly OperatorSignup[]
  /** Requests waiting for a decision, whatever the page: the badge. */
  readonly pendingCount: number
  /** Where the next page starts, or `null` at the end. */
  readonly next: SignupListCursor | null
}

export interface ListSignupsDeps {
  readonly signups: Pick<SignupRepository, 'listForOperator' | 'countPending'>
  readonly users: Pick<UserRepository, 'findByEmail'>
  readonly clock: Clock
}

export type ListSignupsForOperator = (
  input: ListSignupsInput,
) => Promise<Result<OperatorSignupPage, DomainError>>

/**
 * The operator's page of signup requests (`GET /api/site/signups`, spec 31): one state at a time, newest
 * first, a page and a cursor at a time. Only confirmed requests are ever listed. Decided ones are
 * windowed to 30 days (they are erased by then anyway: the window is the promise, not the sweep).
 *
 * `existingAccount` re-reads each address at the moment of listing and is never stored: what the console
 * says ("the person will have to sign in") must be true when the operator reads it.
 */
export const makeListSignupsForOperator =
  ({ signups, users, clock }: ListSignupsDeps): ListSignupsForOperator =>
  async ({ status, limit, before }) => {
    const size = limit ?? DEFAULT_SIGNUP_PAGE_SIZE
    if (!Number.isInteger(size) || size < 1 || size > MAX_SIGNUP_PAGE_SIZE) {
      return err(DomainError.invalid('signup.pageLimitInvalid', { max: MAX_SIGNUP_PAGE_SIZE }))
    }

    // One more than asked, to know whether a page follows without a second query.
    const now = clock.now()
    const rows = await signups.listForOperator({
      now,
      status,
      limit: size + 1,
      ...(status === 'pending' ? {} : { since: addDays(now, -SIGNUP_DECIDED_WINDOW_DAYS) }),
      ...(before === undefined ? {} : { before }),
    })
    const page = rows.slice(0, size)
    const last = page[page.length - 1]

    const items: OperatorSignup[] = await Promise.all(
      page.map(async (request) => ({
        request,
        existingAccount: (await users.findByEmail(request.email)) !== null,
      })),
    )

    return ok({
      items,
      pendingCount: await signups.countPending(now),
      next:
        rows.length > size && last !== undefined ? { at: signupListedAt(last), id: last.id } : null,
    })
  }
