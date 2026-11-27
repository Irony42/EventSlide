import type { SiteCeilingsPatch } from './site'

/**
 * Where a signup request stands, as the operator's list names it (`?status=`). The three the
 * console reads: `pending` (confirmed, waiting for an operator: always in `review`, and in `open`
 * only when the disk guard held the request), `approved` (an account was opened) and `refused`.
 */
export type SiteSignupStatus = 'pending' | 'approved' | 'refused'

/**
 * One request, as `GET /api/site/signups` answers it (spec 31, §5).
 *
 * `email` is the address the person gave and confirmed: the console shows it, it is what the
 * operator validates. `existingAccount` is read by the server when it answers, so the console can
 * say the person will have to sign in to accept. `clientId` is set once an account was opened.
 */
export interface SiteSignupDto {
  readonly id: string
  readonly email: string
  readonly clientName: string
  readonly note: string | null
  /** `YYYY-MM-DD`, as typed. */
  readonly eventDate: string | null
  readonly locale: string
  readonly status: SiteSignupStatus
  readonly createdAt: string
  readonly confirmedAt: string | null
  readonly decidedAt: string | null
  readonly clientId: string | null
  readonly existingAccount: boolean
}

export interface SiteSignupPageDto {
  readonly items: readonly SiteSignupDto[]
  /** Requests waiting for an operator, whatever `status` was asked: the badge reads it. */
  readonly pendingCount: number
  /** Opaque cursor of the next page (`before`), or `null` at the end. */
  readonly next: string | null
}

/** `POST /api/site/signups/:id/approve`: the same ceilings patch as `POST /api/site/clients`. */
export type SiteSignupApproveInput = { readonly ceilings?: SiteCeilingsPatch }
