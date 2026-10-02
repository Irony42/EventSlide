import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { matchTotpStep, parseTotpCode } from '../../../domain/users/totp'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import type { MfaVault } from '../../ports/mfaVault'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import type { SecretTokens } from '../../ports/secretTokens'
import type { TotpEngine } from '../../ports/totpEngine'
import type { UserRepository } from '../../ports/userRepository'
import { mintRecoveryCodes } from './mintRecoveryCodes'

export interface ConfirmTotpEnrollmentInput {
  /** From the session, never from the request body. */
  readonly userId: UserId
  /** The six digits the person's app shows for the secret they scanned. */
  readonly code: string
}

export interface ConfirmTotpEnrollmentDeps {
  readonly users: UserRepository
  readonly factors: SecondFactorRepository
  readonly vault: MfaVault | null
  readonly engine: TotpEngine
  readonly secrets: SecretTokens
  readonly ids: IdGenerator
  readonly audit: AuditRecorder
  readonly clock: Clock
  readonly logger: Logger
}

export interface ConfirmedEnrolment {
  /** Shown once, as `K7QM-2XTR-9PHD-4VNB`. Only their digests are stored. */
  readonly recoveryCodes: readonly string[]
}

export type ConfirmTotpEnrollment = (
  input: ConfirmTotpEnrollmentInput,
) => Promise<Result<ConfirmedEnrolment, DomainError>>

/**
 * Finishes an enrolment (roadmap §10.1, G2-13 / P3-15): the person's app showed the right
 * code, so the authenticator is real from this moment on.
 *
 * In one gesture: the factor is confirmed, **the step that proved it is spent** (so the code
 * cannot be replayed to sign in a second later), ten recovery codes are minted and their
 * digests stored, every session issued before now is ended (`credentialsChangedAt`), and the
 * enrolment is written to the audit log. The caller's own session is the route's to renew,
 * stamped as having passed the second factor — it just did.
 *
 * **Why the other sessions end.** The point of a second factor is that a stolen password is no
 * longer enough. A session a thief opened with the password *before* the enrolment would
 * otherwise outlive it and keep working, and the operator who enrolled in good faith would
 * have no way to know. The epoch is what `revokeOtherSessions` already uses.
 *
 * Write-ahead, like `disableAccount`: the audit entry is built, and so validated, first, then
 * recorded, then the factor is confirmed.
 */
export const makeConfirmTotpEnrollment =
  ({
    users,
    factors,
    vault,
    engine,
    secrets,
    ids,
    audit,
    clock,
    logger,
  }: ConfirmTotpEnrollmentDeps): ConfirmTotpEnrollment =>
  async ({ userId, code }) => {
    if (vault === null) return err(DomainError.notFound('feature.unavailable'))

    const presented = parseTotpCode(code)
    if (!presented.ok) return presented

    const record = await factors.find(userId)
    if (record === null || record.confirmedAt !== null) {
      return err(DomainError.conflict('auth.noEnrolmentInProgress'))
    }

    const secret = vault.open(record.sealedSecret, record.keyVersion)
    if (secret === null) {
      logger.error('a pending second factor could not be opened with the configured key')
      return err(DomainError.unexpected('auth.secondFactorUnavailable'))
    }

    const at = clock.now()
    const step = matchTotpStep({
      presented: presented.value,
      at,
      lastUsedStep: null,
      codeAt: (candidate) => engine.codeAt(secret, candidate),
    })
    if (step === null) return err(DomainError.unauthenticated('auth.invalidSecondFactor'))

    const user = await users.findById(userId)
    if (user === null) return err(DomainError.notFound('user.notFound'))

    const entry = AuditEntry.create({
      at,
      actor: { kind: 'operator', userId },
      action: 'account.secondFactorEnrolled',
      subject: { type: 'account', id: userId },
      clientId: null,
      details: {},
    })
    if (!entry.ok) return entry

    const recovery = mintRecoveryCodes(ids, secrets)

    await audit.record(entry.value)
    if (!(await factors.confirmEnrolment(userId, step, at, recovery.digests))) {
      // Two confirmations raced and the other one won; this person's code was valid, and the
      // factor is theirs either way, but the codes this call minted were never stored.
      return err(DomainError.conflict('auth.noEnrolmentInProgress'))
    }

    await users.save(user.revokeSessionsBefore(at))
    return ok({ recoveryCodes: recovery.codes })
  }
