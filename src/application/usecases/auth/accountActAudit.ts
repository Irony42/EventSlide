import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { AuditActorInput } from '../../../domain/audit/auditActor'
import type { DomainError } from '../../../domain/shared/errors'
import type { ClientId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'

/**
 * The lines an act on an account leaves (G2-14 part 3): **one per client the account belongs to**,
 * carrying that client's id, so the owner's trail says that a member's account was switched off,
 * back on or deleted; and one with no client for an account that belongs to none, so the act is
 * never unrecorded. The subject is the account's opaque id in every one of them.
 *
 * All the entries are built, and so validated, before any is returned: a line the log would refuse
 * (an actor that is not an account) refuses the act, and the caller records them all before it
 * changes anything.
 */
export const accountActEntries = async (
  clients: Pick<ClientRepository, 'membershipsForUser'>,
  input: {
    readonly userId: UserId
    readonly action: 'account.disabled' | 'account.enabled' | 'account.deleted'
    readonly actor: AuditActorInput
    readonly at: Date
  },
): Promise<Result<readonly AuditEntry[], DomainError>> => {
  const memberships = await clients.membershipsForUser(input.userId)
  const clientIds: readonly (ClientId | null)[] =
    memberships.length === 0 ? [null] : memberships.map((membership) => membership.clientId)

  const entries: AuditEntry[] = []
  for (const clientId of clientIds) {
    const entry = AuditEntry.create({
      at: input.at,
      actor: input.actor,
      action: input.action,
      subject: { type: 'account', id: input.userId },
      clientId,
      details: {},
    })
    if (!entry.ok) return entry
    entries.push(entry.value)
  }
  return ok(entries)
}
