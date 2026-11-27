import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { evaluateDiskSpace } from '../../../domain/shared/diskSpaceGuard'
import { signupDiskThreshold } from '../../../domain/signups/signupDiskGuard'
import { signupEnabled, type SignupMode } from '../../../domain/signups/signupMode'
import {
  confirmationOutcome,
  signupConfirmationNext,
  type ConfirmationOutcome,
  type SignupConfirmationNext,
  type SignupRequest,
} from '../../../domain/signups/signupRequest'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { DiskSpaceChecker } from '../../ports/diskSpace'
import type { Logger } from '../../ports/logger'
import type { SecretTokens } from '../../ports/secretTokens'
import type { SignupRepository } from '../../ports/signupRepository'
import type { ProvisionClientOwner } from '../clients/provisionClientOwner'
import type { NotifySignupOperator } from './notifySignupOperator'
import { SIGNUP_CONFIRMATION_NOT_FOUND } from './previewSignupConfirmation'

export interface ConfirmSignupDeps {
  readonly mode: SignupMode
  readonly signups: Pick<SignupRepository, 'peekConfirmation' | 'confirm' | 'release' | 'finalize'>
  readonly secrets: Pick<SecretTokens, 'digestOf'>
  readonly provisionClientOwner: ProvisionClientOwner
  /** Only the count the disk guard multiplies. */
  readonly clients: Pick<ClientRepository, 'countClientsWithEvents'>
  readonly disk: DiskSpaceChecker
  /** The directories whose free space bounds the box: the database's and the media root. */
  readonly diskPaths: readonly string[]
  /** `MIN_FREE_DISK_BYTES`. */
  readonly minFreeDiskBytes: number
  readonly notify: NotifySignupOperator
  readonly clock: Clock
  readonly logger: Logger
}

export interface SignupConfirmed {
  readonly next: SignupConfirmationNext
}

export type ConfirmSignup = (input: {
  readonly token: string
}) => Promise<Result<SignupConfirmed, DomainError>>

/**
 * Pressing "Confirm my address" (spec 31, ADR 0018). The token is spent and the request moves **in one
 * transaction** (`SignupRepository.confirm`), so a spent link never leaves a request unconfirmed and a
 * request is never confirmed twice.
 *
 * - Mode `review`: the request waits (`pending`) and the operator is told. Answer `review`.
 * - Mode `open`: first the **disk guard** (`signupDiskThreshold`: the minimum free, plus 5 GB for each client
 *   with an event not yet purged, plus 5 GB for this one; a free space that cannot be read is a no). If it
 *   passes, the confirmation is the claim (`approving`), then `provisionClientOwner({ createdBy: null })`
 *   and `finalize`; if provisioning fails the claim is released and the request waits like a held one.
 *   Answer `mail` (the invitation is on its way) or `held`. **Never a link**: the invitation exists only in
 *   the mail.
 *
 * A link that is unknown, spent, revoked or expired is `404 signup.confirmationNotFound`.
 */
export const makeConfirmSignup = ({
  mode,
  signups,
  secrets,
  provisionClientOwner,
  clients,
  disk,
  diskPaths,
  minFreeDiskBytes,
  notify,
  clock,
  logger,
}: ConfirmSignupDeps): ConfirmSignup => {
  const diskGuardPasses = async (): Promise<boolean> => {
    const threshold = signupDiskThreshold({
      minFreeDiskBytes,
      clientsWithEvents: await clients.countClientsWithEvents(),
    })
    const readings = await Promise.all(diskPaths.map((path) => disk.freeBytes(path)))
    return evaluateDiskSpace(readings, threshold).sufficient
  }

  /** The claim is `request`'s: open its account, or give the claim back. Returns where the request ended. */
  const open = async (request: SignupRequest): Promise<'approved' | 'pending' | 'unreachable'> => {
    const release = async (): Promise<'pending'> => {
      await signups.release(request.id)
      await notify('waiting')
      return 'pending'
    }

    let provisioned: Awaited<ReturnType<ProvisionClientOwner>>
    try {
      provisioned = await provisionClientOwner({
        clientName: request.clientName.value,
        ownerEmail: request.email.value,
        locale: request.locale,
        createdBy: null,
      })
    } catch (error) {
      logger.error('a signup could not be opened', {
        error: error instanceof Error ? error.message : String(error),
      })
      return release()
    }
    if (!provisioned.ok) {
      logger.warn('a signup could not be opened', { code: provisioned.error.code })
      return release()
    }

    await signups.finalize(request.id, {
      decidedBy: null,
      clientId: provisioned.value.clientId,
      invitationTokenId: provisioned.value.invitation.invitationId,
      now: clock.now(),
    })
    await notify('opened')
    // The invitation was not mailed (the relay refused it): the account exists and cannot be taken back
    // without the operator, who can issue the link again. The visitor is told it is on hold, never given a link.
    if (provisioned.value.invitation.delivery === 'link') {
      logger.warn('a signup was opened but its invitation mail did not leave')
      return 'unreachable'
    }
    return 'approved'
  }

  return async ({ token }) => {
    if (!signupEnabled(mode)) return err(DomainError.notFound('feature.unavailable'))
    const effective = mode === 'open' ? 'open' : 'review'
    const openMode = effective === 'open'
    const digest = secrets.digestOf(token)
    const now = clock.now()

    const peek = await signups.peekConfirmation(digest, now)
    if (peek === null || peek.state !== 'usable') {
      return err(DomainError.notFound(SIGNUP_CONFIRMATION_NOT_FOUND))
    }

    const outcome: ConfirmationOutcome = openMode
      ? confirmationOutcome('open', await diskGuardPasses())
      : 'pending'
    const confirmed = await signups.confirm({ tokenDigest: digest, now, outcome })
    if (confirmed.kind === 'invalid')
      return err(DomainError.notFound(SIGNUP_CONFIRMATION_NOT_FOUND))

    const request = confirmed.request
    if (request.status === 'pending') {
      await notify('waiting')
      return ok({ next: signupConfirmationNext(effective, 'pending') })
    }

    const endedAs = await open(request)
    return ok({
      next: signupConfirmationNext('open', endedAs === 'unreachable' ? 'pending' : endedAs),
    })
  }
}
