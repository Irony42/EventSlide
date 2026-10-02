import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { UserRepository } from '../../ports/userRepository'

export interface DisableAccountInput {
  readonly userId: UserId
  /** Who is switching the account off: an operator, normally. A required input. */
  readonly actor: AuditActorInput
}

export interface DisableAccountDeps {
  readonly users: UserRepository
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
 * **Who may call this is the caller's decision, not this use case's.** There is no
 * authorization in here and no route in front of it yet: the operator API that carries the
 * rules (an operator cannot switch off another operator's account, step-up authentication)
 * is its own item, and puts its guard in front of this one. It is nevertheless audited here,
 * not there — the entry is the same wherever the call comes from, and a caller that forgot
 * it would leave a switch-off nobody could account for.
 *
 * Write-ahead, like `setClientCeilings`: the entry is built, and so validated, before
 * anything changes, then recorded, then the account is saved. A line the log refuses (an
 * actor that is not an account) refuses the *change*; the lesser error, a line for a save
 * that failed afterwards, is visible and a change with no line is not.
 *
 * Idempotent: switching off an account that is already off changes nothing and writes no
 * second entry, so the audit trail does not repeat itself and the first timestamp stays.
 */
export const makeDisableAccount =
  ({ users, audit, clock }: DisableAccountDeps): DisableAccount =>
  async ({ userId, actor }) => {
    const user = await users.findById(userId)
    if (user === null) return err(DomainError.notFound('user.notFound'))
    if (user.isDisabled()) return ok(undefined)

    const at = clock.now()
    const entry = AuditEntry.create({
      at,
      actor,
      action: 'account.disabled',
      subject: { type: 'account', id: user.id },
      clientId: null,
      details: {},
    })
    if (!entry.ok) return entry

    await audit.record(entry.value)
    await users.save(user.disable(at))
    return ok(undefined)
  }
