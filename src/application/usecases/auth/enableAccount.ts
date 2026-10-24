import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { ClientRepository } from '../../ports/clientRepository'
import type { UserRepository } from '../../ports/userRepository'
import { accountActEntries } from './accountActAudit'

export interface EnableAccountInput {
  readonly userId: UserId
  readonly actor: AuditActorInput
}

export interface EnableAccountDeps {
  readonly users: UserRepository
  readonly clients: Pick<ClientRepository, 'membershipsForUser'>
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type EnableAccount = (input: EnableAccountInput) => Promise<Result<void, DomainError>>

/**
 * Switches an account back on (G2-14 part 3), the other half of {@link makeDisableAccount}.
 *
 * What it restores is the account's authority, not its sessions: `User.disable` raised the
 * credentials epoch, so a cookie that was out in the world while the account was off stays dead and
 * the person signs in again. Same write-ahead order and the same lines (one per client), and
 * idempotent: enabling an account that is on writes nothing.
 */
export const makeEnableAccount =
  ({ users, clients, audit, clock }: EnableAccountDeps): EnableAccount =>
  async ({ userId, actor }) => {
    const user = await users.findById(userId)
    if (user === null) return err(DomainError.notFound('user.notFound'))
    if (!user.isDisabled()) return ok(undefined)

    const entries = await accountActEntries(clients, {
      userId,
      action: 'account.enabled',
      actor,
      at: clock.now(),
    })
    if (!entries.ok) return entries

    for (const entry of entries.value) await audit.record(entry)
    await users.save(user.enable())
    return ok(undefined)
  }
