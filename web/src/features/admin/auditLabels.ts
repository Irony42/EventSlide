import type { UiText } from '../../lib/i18n/translations'
import type { ClientAuditEntryDto } from '../../lib/api/dto'

/**
 * The sentence an owner reads for one line of their log (G2-16 / P3-17).
 *
 * Not a component and not a hook, so it takes the table as a parameter. The log's `action` is
 * the server's vocabulary (`auditAction.ts`) and a row written under a name this build does not
 * know is shown as "an action was recorded" rather than hidden or printed raw: a log that
 * leaves a line out is worse than one that says less about it.
 *
 * Two actions say different things according to a switch in their details, and both read it as a
 * boolean only: the details are numbers, switches and instants by construction, so there is no
 * text in them to print.
 */
export const auditSentence = (entry: ClientAuditEntryDto, t: UiText): string => {
  const text = t.clientSpace
  switch (entry.action) {
    case 'client.ceilingsChanged':
      return text.actionCeilingsChanged
    case 'client.periodReset':
      return text.actionPeriodReset
    case 'invitation.issued':
      return entry.details['pendingApproval'] === true
        ? text.actionInvitationIssuedPending
        : text.actionInvitationIssued
    case 'invitation.approved':
      return text.actionInvitationApproved
    case 'account.resetRequested':
      return text.actionResetRequested
    case 'account.resetApproved':
      return text.actionResetApproved
    case 'account.termsAccepted':
      // The version is in the log and not in what an owner reads here: the owner's door lets
      // through numbers, switches and instants only (`readableDetails`, G2-16).
      return text.actionTermsAccepted
    case 'account.resetIssued':
      return entry.details['linkShown'] === true ? text.actionResetShown : text.actionResetMailed
    default:
      return text.actionOther
  }
}

/** Who did it, in words: the kind of actor, and never an account. */
export const auditActor = (entry: ClientAuditEntryDto, t: UiText): string => {
  switch (entry.actor.kind) {
    case 'operator':
      return t.clientSpace.actorOperator
    case 'member':
      return t.clientSpace.actorMember
    case 'system':
      return t.clientSpace.actorSystem
    case 'integration':
      return t.clientSpace.actorIntegration
  }
}
