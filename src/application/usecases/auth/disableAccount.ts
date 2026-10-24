import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { ClientRepository } from '../../ports/clientRepository'
import type { UserRepository } from '../../ports/userRepository'
import { accountActEntries } from './accountActAudit'

export interface DisableAccountInput {
  readonly userId: UserId
  /** Who is switching the account off: an operator, normally. A required input. */
  readonly actor: AuditActorInput
}

export interface DisableAccountDeps {
  readonly users: UserRepository
  /** Read only for the client ids the account's audit lines carry. */
  readonly clients: Pick<ClientRepository, 'membershipsForUser'>
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type DisableAccount = (input: DisableAccountInput) => Promise<Result<void, DomainError>>

/**
 * Switches an account off, and ends every session it has (G2-08 / P3-09).
 *
 * `User.disable` raises the credentials epoch together with `disabledAt`, so the account's
 * cookies stay dead after `enable()`: the authorization reads already refuse a disabled
 * account on every request, and what the epoch adds is that re-enabling it does not quietly
 * revive a cookie that was out in the world while it was switched off.
 *
 * **An operator's account is never switched off from here** (`403 account.operatorProtected`,
 * G2-14 part 3): an operator who could switch off another would be able to lock the box's
 * operators out one after another, and one who could switch off itself would lock the box. Taking
 * an operator's authority away is a change to the database, which is the same bar it has always
 * had. It is asked before "already off", so the answer for an operator does not depend on its state.
 *
 * Who else may call this is the route's decision: the operator API puts requireOperator, the second
 * factor and a fresh step-up in front of it. The audit is nevertheless here, not there: the lines are
 * the same wherever the call comes from (see {@link accountActEntries}), and a caller that forgot
 * them would leave a switch-off nobody could account for.
 *
 * Write-ahead, like `setClientCeilings`: the entries are built, and so validated, before anything
 * changes, then recorded, then the account is saved. A line the log refuses (an actor that is not an
 * account) refuses the *change*; the lesser error, a line for a save that failed afterwards, is
 * visible and a change with no line is not.
 *
 * Idempotent: switching off an account that is already off changes nothing and writes no
 * second entry, so the audit trail does not repeat itself and the first timestamp stays.
 */
export const makeDisableAccount =
  ({ users, clients, audit, clock }: DisableAccountDeps): DisableAccount =>
  async ({ userId, actor }) => {
    const user = await users.findById(userId)
    if (user === null) return err(DomainError.notFound('user.notFound'))
    if (user.siteRole === 'operator') return err(DomainError.forbidden('account.operatorProtected'))
    if (user.isDisabled()) return ok(undefined)

    const at = clock.now()
    const entries = await accountActEntries(clients, {
      userId,
      action: 'account.disabled',
      actor,
      at,
    })
    if (!entries.ok) return entries

    for (const entry of entries.value) await audit.record(entry)
    await users.save(user.disable(at))
    return ok(undefined)
  }
