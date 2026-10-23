import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { ClientLocale } from '../../../domain/clients/clientLocale'
import type { ClientRole } from '../../../domain/clients/clientRole'
import { operatorInvitationNeedsApproval } from '../../../domain/clients/operatorGuard'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { UserRepository } from '../../ports/userRepository'
import type { IssueInvitation, IssuedInvitation } from '../auth/issueInvitation'

export interface InviteToClientAsOperatorInput {
  /** The operator who is inviting. Their site role is read from storage, here. */
  readonly actorId: UserId
  readonly clientId: ClientId
  /** What the operator typed. Parsed by `issueInvitation`; never logged, never audited. */
  readonly email: string
  /** What accepting grants in the client: a place in its account, as owner or member. */
  readonly role: ClientRole
  /** The language of the operator's page, which is the language the mail is written in. */
  readonly locale: ClientLocale
}

export type OperatorInvitation = IssuedInvitation & {
  /**
   * Whether the invitation waits for an owner of the client (R1). When `true` the link, if one
   * is shown, opens nothing until an owner has approved it (`approveInvitation`).
   */
  readonly pendingApproval: boolean
}

export interface InviteToClientAsOperatorDeps {
  readonly users: Pick<UserRepository, 'siteRoleFor'>
  readonly clients: Pick<ClientRepository, 'findById' | 'countEvents'>
  /** Only the compensation: an invitation the log refused to record is revoked again. */
  readonly tokens: Pick<AccountTokenRepository, 'revokeOutstandingInvitations'>
  readonly issueInvitation: IssueInvitation
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type InviteToClientAsOperator = (
  input: InviteToClientAsOperatorInput,
) => Promise<Result<OperatorInvitation, DomainError>>

/**
 * An operator invites a person into a client's account (the operator guard's **R1**; free plan
 * G2-12, paid plan P3-14).
 *
 * ## The rule
 *
 * **An invitation an operator writes is usable at once only if the client has no event.**
 * Otherwise it is written with `requires_approval` and opens nothing until an owner of the
 * client approves it (`approveInvitation`, `POST /api/client/invitations/:id/approve`). This is
 * what stops an operator from inviting themselves, or an address they control, into a client
 * that has somebody's wedding in it: the client is the one that says who comes in.
 *
 * The count is **every event of the client, in any status**: an archived wedding is still a
 * wedding in the client's account, and a client that has only ever had one is not "new".
 * Nothing about the events is read but their number (`ClientRepository.countEvents`).
 *
 * The same rule is held a second time when the invitation is **spent**
 * (`makeResolveInvitation`): the week it lives is long enough for the client to grow its first
 * event, and an invitation that needed no approval when it was written does not get to skip it
 * afterwards.
 *
 * ## What is checked here, and what is not
 *
 * The caller is an operator, **read from storage on this call** and not taken on the word of
 * the route: the rule is about operators, so a use case that applied it to whoever its caller
 * said was one would apply nothing the day a route forgot. A non-operator is `403
 * auth.forbidden`. Which operators may reach the route at all (the second factor, the step-up)
 * is the HTTP layer's, as for every operator action.
 *
 * ## What is written
 *
 * The invitation, through `issueInvitation` (so the cap per address, the single live link per
 * address and place, and "mailed when the box can mail, shown when it cannot" are that use
 * case's, unchanged), and then one line of the audit log: `invitation.issued {pendingApproval}`,
 * which the client's owner reads (R5). The line says **that** an invitation was written and
 * whether it waits for them, and nothing about whom it is for: the log's vocabulary has no
 * word for an address, on purpose.
 *
 * The id the line is about exists only once the invitation is written, so the entry follows it
 * instead of preceding it. **If the log refuses it, the invitation is revoked again** and the
 * failure propagates: an operator action with no line is the error this use case exists to
 * avoid, and a revoked link, whose mail may already be in an inbox, is merely a dead one.
 */
export const makeInviteToClientAsOperator =
  ({
    users,
    clients,
    tokens,
    issueInvitation,
    audit,
    clock,
  }: InviteToClientAsOperatorDeps): InviteToClientAsOperator =>
  async ({ actorId, clientId, email, role, locale }) => {
    if ((await users.siteRoleFor(actorId)) !== 'operator') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'operator' }))
    }

    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))

    // Parsed before anything is written, so an address that is not one leaves no trace, and so
    // the revocation below has the address it needs without parsing twice.
    const address = EmailAddress.create(email)
    if (!address.ok) return address

    const pendingApproval = operatorInvitationNeedsApproval(await clients.countEvents(client.id))

    const issued = await issueInvitation({
      email: address.value.value,
      locale,
      place: { kind: 'client', clientId: client.id, role, name: client.name.value },
      createdBy: actorId,
      requiresApproval: pendingApproval,
    })
    if (!issued.ok) return issued

    const discard = async (): Promise<void> => {
      await tokens.revokeOutstandingInvitations(
        address.value,
        { kind: 'client', clientId: client.id, role },
        clock.now(),
      )
    }

    const entry = AuditEntry.create({
      at: clock.now(),
      actor: { kind: 'operator', userId: actorId },
      action: 'invitation.issued',
      subject: { type: 'invitation', id: issued.value.invitationId },
      clientId: client.id,
      details: { pendingApproval },
    })
    if (!entry.ok) {
      await discard()
      return entry
    }
    try {
      await audit.record(entry.value)
    } catch (error) {
      await discard()
      throw error
    }

    return ok({ ...issued.value, pendingApproval })
  }
