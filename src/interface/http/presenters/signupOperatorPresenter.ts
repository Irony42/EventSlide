import type {
  OperatorSignup,
  OperatorSignupPage,
} from '../../../application/usecases/signups/listSignupsForOperator'
import type { SiteSignupDto, SiteSignupPageDto, SiteSignupStatus } from './dto'
import { encodeSignupCursor } from '../signupCursor'

const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

const listedStatus = (status: string): SiteSignupStatus =>
  status === 'approved' || status === 'refused' ? status : 'pending'

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
