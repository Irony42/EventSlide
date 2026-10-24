import type { StatusTone } from '../../design-system/components/StatusIcon'
import type { EventStatus, SiteAuditEntryDto, SiteClientDto } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'

/**
 * The words and tones the operator's console reads from what the server said.
 *
 * Not components and not hooks, so each takes the table as a parameter. None of it decides
 * anything: a client is "being wound down" because the server set a purge date, and "suspended"
 * because it set a suspension, and this module only names the two.
 */

export type ClientStanding = 'active' | 'suspended' | 'offboarding'

/**
 * A client's standing, from the two instants the server keeps. Winding down is the stronger of
 * the two: an offboarded client is suspended as well, and a person reading "Suspended" would
 * think they can lift it (the server refuses, `client.offboarding`).
 */
export const standingOf = (
  client: Pick<SiteClientDto, 'suspendedAt' | 'purgeAfter'>,
): ClientStanding =>
  client.purgeAfter !== null ? 'offboarding' : client.suspendedAt !== null ? 'suspended' : 'active'

export const standingLabel = (standing: ClientStanding, t: UiText): string => {
  switch (standing) {
    case 'active':
      return t.site.statusActive
    case 'suspended':
      return t.site.statusSuspended
    case 'offboarding':
      return t.site.statusOffboarding
  }
}

export const standingTone = (standing: ClientStanding): StatusTone => {
  switch (standing) {
    case 'active':
      return 'success'
    case 'suspended':
      return 'warning'
    case 'offboarding':
      return 'danger'
  }
}

export const eventStatusTone = (status: EventStatus): StatusTone => {
  switch (status) {
    case 'live':
      return 'success'
    case 'closed':
      return 'warning'
    case 'draft':
    case 'archived':
      return 'neutral'
  }
}

export const eventStatusLabel = (status: EventStatus, t: UiText): string =>
  t.site.eventStatuses[status]

/** The first eight characters of an id: enough to tell two rows apart, never a name. */
export const shortId = (id: string): string => id.slice(0, 8)

/**
 * The sentence for one line of the operator's log. A line written under a name this build does
 * not know is "an action was recorded" rather than hidden or printed raw: a log that leaves a
 * line out is worse than one that says less about it.
 */
export const auditSentence = (entry: SiteAuditEntryDto, t: UiText): string => {
  if (entry.action === 'invitation.issued' && entry.details['pendingApproval'] === true) {
    return t.site.actionInvitationIssuedPending
  }
  // `hasOwn` and not a bare lookup: the action is a string the server wrote, and
  // `constructor` must not resolve to `Object`.
  const sentences: Readonly<Record<string, string | undefined>> = t.site.actions
  const known = Object.hasOwn(t.site.actions, entry.action) ? sentences[entry.action] : undefined
  return known ?? t.site.actionOther
}

/** The operator's own words for a change of ceilings, or `null` when the line carries none. */
export const reasonOf = (entry: SiteAuditEntryDto): string | null => {
  const reason = entry.details['reason']
  return typeof reason === 'string' && reason !== '' ? reason : null
}
