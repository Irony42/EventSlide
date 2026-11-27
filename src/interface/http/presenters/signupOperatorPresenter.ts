import type {
  OperatorSignup,
  OperatorSignupPage,
} from '../../../application/usecases/signups/listSignupsForOperator'
import type { SiteSignupDto, SiteSignupPageDto, SiteSignupStatus } from './dto'
import type { SignupStatus } from '../../../domain/signups/signupRequest'
import { encodeSignupCursor } from '../signupCursor'

const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

/**
 * What the console calls a request's state. `approving` is a claim still in flight: it shows with
 * `pending`. The list only asks for those three, so `unconfirmed` and `expired` never arrive here: one
 * that does is a bug in the query, not something to put a name on.
 */
export const listedStatus = (status: SignupStatus): SiteSignupStatus => {
  switch (status) {
    case 'pending':
    case 'approving':
      return 'pending'
    case 'approved':
    case 'refused':
      return status
    case 'unconfirmed':
    case 'expired':
      throw new Error(`a ${status} signup request cannot be listed for the operator`)
  }
}

const toSiteSignupDto = ({ request, existingAccount }: OperatorSignup): SiteSignupDto => ({
  id: request.id,
  email: request.email.value,
  clientName: request.clientName.value,
  note: request.note,
  eventDate: request.eventDate,
  locale: request.locale,
  status: listedStatus(request.status),
  createdAt: request.createdAt.toISOString(),
  confirmedAt: isoOrNull(request.confirmedAt),
  decidedAt: isoOrNull(request.decidedAt),
  clientId: request.clientId,
  existingAccount,
})

export const toSiteSignupPageDto = (page: OperatorSignupPage): SiteSignupPageDto => ({
  items: page.items.map(toSiteSignupDto),
  pendingCount: page.pendingCount,
  next: page.next === null ? null : encodeSignupCursor(page.next),
})
