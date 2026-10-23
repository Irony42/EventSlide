import type { AuditDetails } from '../../../domain/audit/auditDetails'
import { isCanonicalReason } from '../../../domain/audit/auditReason'
import type {
  SiteAccountRow,
  SiteClientRow,
  SiteEventRow,
} from '../../../domain/site/siteOverviewRows'
import type { AuditPage, AuditRecord } from '../../../application/ports/auditLog'
import type {
  SiteAccountPage,
  SiteClientPage,
  SiteEventPage,
} from '../../../application/ports/siteOverview'
import type { OperatorInvitation } from '../../../application/usecases/clients/inviteToClientAsOperator'
import type { ProvisionedClientOwner } from '../../../application/usecases/clients/provisionClientOwner'
import type { OperatorResetOutcome } from '../../../application/usecases/auth/issuePasswordResetForAccount'
import type { Client } from '../../../domain/clients/client'
import type {
  ClientCeilingsChangedDto,
  OperatorInvitationDto,
  OperatorPasswordResetDto,
  ProvisionedClientDto,
  SiteAccountDto,
  SiteAccountPageDto,
  SiteAuditEntryDto,
  SiteAuditPageDto,
  SiteClientDto,
  SiteClientPageDto,
  SiteEventDto,
  SiteEventPageDto,
} from './dto'
import { toCeilingsDto } from './presenters'

/**
 * What the operator is shown (`/api/site`, G2-14 / P3-13), **written field by field and never
 * spread from a row**.
 *
 * The rows themselves are already content-free by construction (`SiteOverview` returns only what
 * `domain/site/siteOverviewRows.ts` declares), so this is the second line and not the first: a
 * field a row gains later does not reach the wire until somebody decides here that it should, and
 * `siteRoutes.contentFree.test.ts` sweeps the responses of every route for planted content to
 * prove that neither line has been walked round.
 */

const iso = (date: Date): string => date.toISOString()
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

// -------------------------------------------------------------------- the read model --

const toSiteClientDto = (row: SiteClientRow): SiteClientDto => ({
  id: row.id,
  name: row.name,
  createdAt: iso(row.createdAt),
  suspendedAt: isoOrNull(row.suspendedAt),
  purgeAfter: isoOrNull(row.purgeAfter),
  ceilings: toCeilingsDto(row.ceilings),
  eventsCreatedInPeriod: row.eventsCreatedInPeriod,
  usage: {
    eventCount: row.usage.eventCount,
    liveEventCount: row.usage.liveEventCount,
    memberCount: row.usage.memberCount,
    usedBytes: row.usage.usedBytes,
  },
})

export const toSiteClientPageDto = (page: SiteClientPage): SiteClientPageDto => ({
  items: page.items.map(toSiteClientDto),
  next: page.next,
})

const toSiteEventDto = (row: SiteEventRow): SiteEventDto => ({
  id: row.id,
  status: row.status,
  createdAt: iso(row.createdAt),
  startsAt: isoOrNull(row.startsAt),
  openedAt: isoOrNull(row.openedAt),
  closedAt: isoOrNull(row.closedAt),
  quotaBytes: row.quotaBytes,
  usedBytes: row.usedBytes,
  photoCount: row.photoCount,
})

export const toSiteEventPageDto = (page: SiteEventPage): SiteEventPageDto => ({
  items: page.items.map(toSiteEventDto),
  next: page.next,
})

const toSiteAccountDto = (row: SiteAccountRow): SiteAccountDto => ({
  id: row.id,
  email: row.email,
  siteRole: row.siteRole,
  createdAt: iso(row.createdAt),
  lastLoginAt: isoOrNull(row.lastLoginAt),
  disabledAt: isoOrNull(row.disabledAt),
  mustChangePassword: row.mustChangePassword,
  ownedEventCount: row.ownedEventCount,
  clients: row.clients.map((client) => ({ clientId: client.clientId, role: client.role })),
})

export const toSiteAccountPageDto = (page: SiteAccountPage): SiteAccountPageDto => ({
  items: page.items.map(toSiteAccountDto),
  next: page.next,
})

// ------------------------------------------------------------------------- the log --

const INSTANT_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * What of an entry's `details` an operator may read: numbers, switches, instants, objects of
 * those and, at the top level and under the key `reason`, the operator's own sentence.
 *
 * The allow-list refuses anything else when an entry is **written**, but a row is read back as it
 * was stored (`AuditRecord` is deliberately looser, so last year's history stays readable), so the
 * door checks again: a string that is neither an instant nor a canonical reason, a `reason` that
 * is not at the top, and an array are dropped here whatever an older allow-list let into a row.
 */
const operatorDetails = (details: AuditDetails, top: boolean): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(details).flatMap(([key, value]): [string, unknown][] => {
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return [[key, value]]
      }
      if (typeof value === 'string') {
        const readable =
          INSTANT_TEXT.test(value) || (top && key === 'reason' && isCanonicalReason(value))
        return readable ? [[key, value]] : []
      }
      return typeof value === 'object' && !Array.isArray(value)
        ? [[key, operatorDetails(value, false)]]
        : []
    }),
  )

const toSiteAuditEntryDto = (record: AuditRecord): SiteAuditEntryDto => ({
  seq: record.seq,
  at: iso(record.at),
  action: record.action,
  actor: { kind: record.actor.kind, userId: record.actor.userId, label: record.actor.label },
  subject: { type: record.subject.type, id: record.subject.id },
  clientId: record.clientId,
  details: operatorDetails(record.details, true),
})

export const toSiteAuditPageDto = (page: AuditPage): SiteAuditPageDto => ({
  items: page.items.map(toSiteAuditEntryDto),
  next: page.next,
})

// ----------------------------------------------------------------- what an act answers --

/**
 * An invitation an operator wrote. The link is copied **only** from the variant that carries one
 * (`delivery: 'link'`, which the use case produces when no mail went out), so there is no branch
 * of this function in which a token or a link is read from anywhere else.
 */
export const toOperatorInvitationDto = (invitation: OperatorInvitation): OperatorInvitationDto =>
  invitation.delivery === 'link'
    ? {
        id: invitation.invitationId,
        delivery: 'link',
        expiresAt: iso(invitation.expiresAt),
        pendingApproval: invitation.pendingApproval,
        link: invitation.link,
      }
    : {
        id: invitation.invitationId,
        delivery: 'mail',
        expiresAt: iso(invitation.expiresAt),
        pendingApproval: invitation.pendingApproval,
      }

/** A freshly provisioned client: its id and its owner's invitation, which waits for nobody. */
export const toProvisionedClientDto = (
  provisioned: ProvisionedClientOwner,
): ProvisionedClientDto => ({
  clientId: provisioned.clientId,
  invitation: toOperatorInvitationDto({ ...provisioned.invitation, pendingApproval: false }),
})

export const toClientCeilingsChangedDto = (client: Client): ClientCeilingsChangedDto => ({
  ceilings: toCeilingsDto(client.ceilings.toProps()),
  eventsCreatedInPeriod: client.eventsCreatedInPeriod,
})

/**
 * The outcome of a reset an operator asked for. **A link leaves here only from the `link`
 * variant**, the one the use case reaches on a box with no mail relay, in the opt-in mode and
 * after another owner's approval; `mail` and `pendingApproval` are copied without one.
 */
export const toOperatorPasswordResetDto = (
  outcome: OperatorResetOutcome,
): OperatorPasswordResetDto => {
  switch (outcome.delivery) {
    case 'mail':
      return { delivery: 'mail', expiresAt: iso(outcome.expiresAt) }
    case 'pendingApproval':
      return {
        delivery: 'pendingApproval',
        expiresAt: iso(outcome.expiresAt),
        approvalId: outcome.approvalId,
      }
    case 'link':
      return { delivery: 'link', expiresAt: iso(outcome.expiresAt), link: outcome.link }
  }
}
