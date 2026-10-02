import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { IdGenerator } from '../../ports/idGenerator'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import type { SecretTokens } from '../../ports/secretTokens'
import type { UserRepository } from '../../ports/userRepository'
import { mintRecoveryCodes } from './mintRecoveryCodes'

export interface RegenerateRecoveryCodesInput {
  /** From the session, never from the request body. */
  readonly userId: UserId
}

export interface RegenerateRecoveryCodesDeps {
  readonly users: UserRepository
  readonly factors: SecondFactorRepository
  readonly secrets: SecretTokens
  readonly ids: IdGenerator
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type RegenerateRecoveryCodes = (
  input: RegenerateRecoveryCodesInput,
) => Promise<Result<{ readonly recoveryCodes: readonly string[] }, DomainError>>

/**
 * Replaces the whole set of recovery codes with a new one (roadmap §10.1, G2-13 / P3-15):
 * the ones that were lost, the ones that were printed and left on a desk, or simply the last
 * few of ten. **Every old code stops working at once, spent or not**, so a regeneration is
 * also how a person takes back a sheet of paper they no longer trust.
 *
 * Who may call it is the route's decision, and the route puts a fresh step-up in front: a
 * session alone must not be able to mint the codes that stand in for the phone.
 *
 * `409 auth.secondFactorNotEnrolled` for an account with nothing to recover, which the
 * repository also refuses (`replaceRecoveryCodes` answers `false`), so a race with a removal
 * cannot leave codes behind.
 */
export const makeRegenerateRecoveryCodes =
  ({
    users,
    factors,
    secrets,
    ids,
    audit,
    clock,
  }: RegenerateRecoveryCodesDeps): RegenerateRecoveryCodes =>
  async ({ userId }) => {
    const user = await users.findById(userId)
    // The id came from a session, so a miss means the account was deleted underneath it.
    if (user === null) return err(DomainError.notFound('user.notFound'))
    const factor = await factors.find(userId)
    if (factor === null || factor.confirmedAt === null) {
      return err(DomainError.conflict('auth.secondFactorNotEnrolled'))
    }

    const entry = AuditEntry.create({
      at: clock.now(),
      actor: { kind: user.isOperator() ? 'operator' : 'member', userId },
      action: 'account.recoveryCodesRegenerated',
      subject: { type: 'account', id: userId },
      clientId: null,
      details: {},
    })
    if (!entry.ok) return entry

    const recovery = mintRecoveryCodes(ids, secrets)

    await audit.record(entry.value)
    if (!(await factors.replaceRecoveryCodes(userId, recovery.digests))) {
      return err(DomainError.conflict('auth.secondFactorNotEnrolled'))
    }
    return ok({ recoveryCodes: recovery.codes })
  }
