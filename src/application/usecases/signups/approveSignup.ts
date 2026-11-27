import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { ClientCeilingsInput } from '../../../domain/clients/clientCeilings'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'
import type { SignupRepository } from '../../ports/signupRepository'
import type { ProvisionClientOwner, ProvisionedClientOwner } from '../clients/provisionClientOwner'

export interface ApproveSignupInput {
  readonly id: string
  /** The operator who decides: the client's creator and the audit line's actor. */
  readonly operator: UserId
  /** The operator's own ceilings, as for `POST /api/site/clients`; absent takes the box's defaults. */
  readonly ceilings?: ClientCeilingsInput
}

export interface ApproveSignupDeps {
  readonly signups: Pick<SignupRepository, 'findById' | 'claim' | 'release' | 'finalize'>
  readonly provisionClientOwner: ProvisionClientOwner
  /** Only the writing half of the log. */
  readonly audit: AuditRecorder
  readonly clock: Clock
  readonly logger: Logger
}

export type ApproveSignup = (
  input: ApproveSignupInput,
) => Promise<Result<ProvisionedClientOwner, DomainError>>

/**
 * An operator approves a confirmed signup request (spec 31 sections 3 and 5, ADR 0018): the space is
 * opened and its owner's invitation goes out, through the same `provisionClientOwner` as
 * `POST /api/site/clients`, with the operator as its creator.
 *
 * **The claim comes first** (`pending` to `approving`, one conditional UPDATE): two operators pressing
 * the button at once, or a double click, provision one client, and the second is told `409
 * signup.notPending`. A request nobody confirmed is `404 signup.notFound`, exactly as an id nobody
 * holds: an operator is never shown an unproven address, so it cannot name one either.
 *
 * **A failed provisioning gives the claim back** (`approving` to `pending`), whether it returned an
 * error (the address is over its hourly invitation cap, a ceiling was refused) or threw; the use case
 * `provisionClientOwner` already removed the empty client. The error then goes to the operator as it
 * came, and the request is still in their queue to retry.
 *
 * The line `signup.approved` follows the finalisation and names the request, never the address: a log
 * that will not take it propagates its failure to the operator, and the request stays `approved` (a
 * second attempt would otherwise open a second client). Whether the address already has an account is
 * the list's to say (`listSignupsForOperator`), and changes nothing here: the invitation page offers
 * the sign-in.
 */
export const makeApproveSignup =
  ({ signups, provisionClientOwner, audit, clock, logger }: ApproveSignupDeps): ApproveSignup =>
  async ({ id, operator, ceilings }) => {
    const request = await signups.findById(id)
    if (request === null || request.status === 'unconfirmed') {
      return err(DomainError.notFound('signup.notFound'))
    }
    const claimedAt = clock.now()
    if (!(await signups.claim(id, claimedAt))) {
      return err(DomainError.conflict('signup.notPending'))
    }

    // Giving the claim back must never replace the failure that made it necessary: its own failure
    // (a throw, or a claim that is no longer ours) is logged and dropped.
    const giveBack = async (): Promise<void> => {
      try {
        if (!(await signups.release(id, claimedAt))) {
          logger.warn('a signup claim could not be given back', { signupId: id })
        }
      } catch {
        logger.warn('a signup claim could not be given back', { signupId: id })
      }
    }

    let provisioned: Result<ProvisionedClientOwner, DomainError>
    try {
      provisioned = await provisionClientOwner({
        clientName: request.clientName.value,
        ownerEmail: request.email.value,
        locale: request.locale,
        ...(ceilings === undefined ? {} : { ceilings }),
        createdBy: operator,
      })
    } catch (error) {
      await giveBack()
      throw error
    }
    if (!provisioned.ok) {
      await giveBack()
      return provisioned
    }

    const at = clock.now()
    const finalized = await signups.finalize(id, {
      decidedBy: operator,
      clientId: provisioned.value.clientId,
      invitationTokenId: provisioned.value.invitation.invitationId,
      claimedAt,
      now: at,
    })
    if (!finalized) {
      // The claim was no longer ours (the stale-claim sweep gave it back, or another call took it): the
      // client and its invitation exist and belong to nobody's decision. Say so, name the client for
      // whoever cleans it (never the address), and write no `signup.approved`.
      logger.warn('a signup was provisioned but its claim was lost: orphan client', {
        signupId: id,
        clientId: provisioned.value.clientId,
      })
      return err(DomainError.conflict('signup.notPending'))
    }

    const line = AuditEntry.create({
      at,
      actor: { kind: 'operator', userId: operator },
      action: 'signup.approved',
      subject: { type: 'access_request', id },
      clientId: null,
      details: {},
    })
    if (!line.ok) return line
    await audit.record(line.value)

    return ok(provisioned.value)
  }
