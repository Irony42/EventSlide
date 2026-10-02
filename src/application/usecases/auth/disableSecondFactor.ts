import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { SecondFactorRepository } from '../../ports/secondFactorRepository'
import type { UserRepository } from '../../ports/userRepository'

export interface DisableSecondFactorInput {
  /** From the session, never from the request body: this removes *that* account's factor. */
  readonly userId: UserId
}

export interface DisableSecondFactorDeps {
  readonly users: UserRepository
  readonly factors: SecondFactorRepository
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type DisableSecondFactor = (
  input: DisableSecondFactorInput,
) => Promise<Result<void, DomainError>>

/**
 * Removes an account's authenticator and its recovery codes (roadmap §10.1, G2-13 / P3-15):
 * a new phone, a phone that is gone, or an enrolment the person no longer wants.
 *
 * It ends every session of the account (`credentialsChangedAt`), this one included, for the
 * same reason enrolling does in the other direction: what a session proved about the account
 * at the time it was issued is no longer what is true. The route renews the caller's own
 * session **without** the second-factor stamp, so on a box that requires one the operator is
 * at the gate again until they enrol — removing the factor never opens `/api/site`, it
 * closes it.
 *
 * Who may call it is the route's decision, and the route puts a fresh step-up in front.
 * Idempotent: an account with no factor changes nothing and writes no entry.
 *
 * Write-ahead, like `disableAccount`.
 */
export const makeDisableSecondFactor =
  ({ users, factors, audit, clock }: DisableSecondFactorDeps): DisableSecondFactor =>
  async ({ userId }) => {
    const user = await users.findById(userId)
    // The id came from a session, so a miss means the account was deleted underneath it.
    if (user === null) return err(DomainError.notFound('user.notFound'))
    if ((await factors.find(userId)) === null) return ok(undefined)

    const at = clock.now()
    const entry = AuditEntry.create({
      at,
      actor: { kind: user.isOperator() ? 'operator' : 'member', userId },
      action: 'account.secondFactorDisabled',
      subject: { type: 'account', id: userId },
      clientId: null,
      details: {},
    })
    if (!entry.ok) return entry

    await audit.record(entry.value)
    await factors.remove(userId)
    await users.save(user.revokeSessionsBefore(at))
    return ok(undefined)
  }
