import type { OperatorSignupPage } from '../../../application/usecases/signups/listSignupsForOperator'
import type { SignupStatus } from '../../../domain/signups/signupRequest'
import { encodeSignupCursor } from '../signupCursor'

/**
 * What the operator reads of a signup request (`GET /api/site/signups`, spec 31), written field by
 * field. The address, the space's name and the note are what a stranger typed: they are shown to an
 * operator, who needs them to decide, and to nobody else (`requireOperator` is the router's first line).
 */
export interface SiteSignupDto {
  readonly id: string
  readonly email: string
  readonly clientName: string
  readonly note: string | null
  /** `YYYY-MM-DD`. */
  readonly eventDate: string | null
  readonly locale: string
  readonly status: SignupStatus
  readonly createdAt: string
  readonly confirmedAt: string | null
  readonly decidedAt: string | null
  readonly clientId: string | null
  /** An account already answers to this address: the person will have to sign in to accept. */
  readonly existingAccount: boolean
}

export interface SiteSignupPageDto {
  readonly items: readonly SiteSignupDto[]
  /** Requests waiting for a decision, whatever the page: the badge. */
  readonly pendingCount: number
  /** An opaque cursor for `before`, or `null` at the end. */
  readonly next: string | null
}

const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

export const toSiteSignupPageDto = (page: OperatorSignupPage): SiteSignupPageDto => ({
  items: page.items.map(({ request, existingAccount }) => ({
    id: request.id,
    email: request.email.value,
    clientName: request.clientName.value,
    note: request.note,
    eventDate: request.eventDate,
    locale: request.locale,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    confirmedAt: isoOrNull(request.confirmedAt),
    decidedAt: isoOrNull(request.decidedAt),
    clientId: request.clientId,
    existingAccount,
  })),
  pendingCount: page.pendingCount,
  next: page.next === null ? null : encodeSignupCursor(page.next),
})
