import { DomainError } from '../../../domain/shared/errors'
import { err, ok, type Result } from '../../../domain/shared/result'
import { evaluateDiskSpace } from '../../../domain/shared/diskSpaceGuard'
import {
  signupDiskThreshold,
  signupFreshClientsSince,
} from '../../../domain/signups/signupDiskGuard'
import { signupEnabled, type SignupMode } from '../../../domain/signups/signupMode'
import {
  confirmationOutcome,
  signupConfirmationNext,
  type ConfirmationOutcome,
  type SignupConfirmationNext,
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
  readonly clients: Pick<ClientRepository, 'countClientsReservingRoom'>
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
  /**
   * Resolves when the operator's notice (if any) has been tried. **Never rejects**; the HTTP layer does not
   * wait for it, so a slow relay cannot slow the answer. A test awaits it.
   */
  readonly completion: Promise<void>
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
 *   reserving room, plus 5 GB for this one; "reserving room" is a client with an event not yet purged or one
 *   created in the last 30 days; a free space that cannot be read is a no). The guard is not atomic: the
 *   day's ceiling bounds the race. If it passes, the confirmation is the claim (`approving`), then
 *   `provisionClientOwner({ createdBy: null })` and `finalize`.
 *   If provisioning fails, the claim is released and the request waits like a held one. If `finalize` fails or
 *   says no after the account exists, or the invitation mail did not leave, the answer is `held` too, the
 *   client id is logged (never the address) and the operator is told (`waiting`): they re-issue the
 *   invitation from the client page.
 *   Answer `mail` (the invitation is on its way) or `held`. **Never a link**: the invitation exists only in
 *   the mail. The operator notices run in `completion`, never on the response path.
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
  const diskGuardPasses = async (now: Date): Promise<boolean> => {
    const threshold = signupDiskThreshold({
      minFreeDiskBytes,
      clientsReservingRoom: await clients.countClientsReservingRoom(signupFreshClientsSince(now)),
    })
    const readings = await Promise.all(diskPaths.map((path) => disk.freeBytes(path)))
    return evaluateDiskSpace(readings, threshold).sufficient
  }

  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

  return async ({ token }) => {
    if (!signupEnabled(mode)) return err(DomainError.notFound('feature.unavailable'))
    const effective = mode === 'open' ? 'open' : 'review'
    const openMode = effective === 'open'
    const digest = secrets.digestOf(token)
    const now = clock.now()

    /** The notices this call owes; they run behind `completion`, whatever happens. */
    const notices: Promise<void>[] = []
    const tell = (kind: 'opened' | 'waiting'): void => {
      notices.push(notify(kind))
    }
    const answer = (next: SignupConfirmationNext) =>
      ok({ next, completion: Promise.all(notices).then(() => undefined) })

    const peek = await signups.peekConfirmation(digest, now)
    if (peek === null || peek.state !== 'usable') {
      return err(DomainError.notFound(SIGNUP_CONFIRMATION_NOT_FOUND))
    }

    const outcome: ConfirmationOutcome = openMode
      ? confirmationOutcome('open', await diskGuardPasses(now))
      : 'pending'
    const confirmed = await signups.confirm({ tokenDigest: digest, now, outcome })
    if (confirmed.kind === 'invalid')
      return err(DomainError.notFound(SIGNUP_CONFIRMATION_NOT_FOUND))

    const request = confirmed.request
    if (request.status === 'pending') {
      tell('waiting')
      return answer(signupConfirmationNext(effective, 'pending'))
    }

    // The claim is ours (`approving`, stamped `now`): open the account, or give the claim back.
    const giveBack = async (): Promise<void> => {
      try {
        await signups.release(request.id, now)
      } catch (error) {
        logger.error('a signup claim could not be given back', { error: describe(error) })
      }
      tell('waiting')
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
      logger.error('a signup could not be opened', { error: describe(error) })
      await giveBack()
      return answer(signupConfirmationNext('open', 'pending'))
    }
    if (!provisioned.ok) {
      logger.warn('a signup could not be opened', { code: provisioned.error.code })
      await giveBack()
      return answer(signupConfirmationNext('open', 'pending'))
    }

    const { clientId, invitation } = provisioned.value
    let finalized = false
    try {
      finalized = await signups.finalize(request.id, {
        decidedBy: null,
        clientId,
        invitationTokenId: invitation.invitationId,
        now: clock.now(),
        claimedAt: now,
      })
    } catch (error) {
      logger.error('a signup account was opened but its request could not be finalized', {
        clientId,
        error: describe(error),
      })
    }
    if (!finalized) {
      // The account exists and the request is not marked: the claim is left to the sweep (one hour), and the
      // operator is told, because the client is real and the visitor has been told "held".
      logger.error('a signup account was opened but its request was not finalized', { clientId })
      tell('waiting')
      return answer(signupConfirmationNext('open', 'pending'))
    }

    // The invitation was not mailed (the relay refused it): the account exists and the visitor has no link.
    // The operator re-issues the invitation from the client page. Never a link in the answer.
    if (invitation.delivery === 'link') {
      logger.warn('a signup was opened but its invitation mail did not leave', { clientId })
      tell('waiting')
      return answer(signupConfirmationNext('open', 'pending'))
    }

    tell('opened')
    return answer(signupConfirmationNext('open', 'approved'))
  }
}
