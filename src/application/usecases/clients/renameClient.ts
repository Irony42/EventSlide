import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { Client } from '../../../domain/clients/client'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'

/**
 * Renames a client. An operator's act on the box, gated by `requireOperator` at the HTTP
 * layer (G2-14), and **audited** (roadmap §10.8): `client.renamed`, which says that it
 * happened, to which client and by whom, and not what the name was or became.
 *
 * **Write-ahead, like `setClientCeilings`**: the entry is built, and so validated, before
 * anything changes, then recorded, then the client is saved. An actor the log would not
 * accept refuses the rename; the lesser error, a line for a save that failed afterwards, is
 * visible, and a rename with no line is not.
 *
 * **Nothing changed, nothing written.** Renaming a client to the name it already has is not
 * an act on it, so it is answered with the client as it is and leaves no line.
 */

export interface RenameClientInput {
  readonly clientId: ClientId
  readonly name: string
  /** Who is renaming it: the operator, normally. A required input. */
  readonly actor: AuditActorInput
}

export interface RenameClientDeps {
  readonly clients: ClientRepository
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type RenameClient = (input: RenameClientInput) => Promise<Result<Client, DomainError>>

export const makeRenameClient =
  ({ clients, audit, clock }: RenameClientDeps): RenameClient =>
  async ({ clientId, name, actor }) => {
    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))

    const renamed = client.rename(name)
    if (!renamed.ok) return renamed
    if (renamed.value.name.value === client.name.value) return ok(client)

    const entry = AuditEntry.create({
      at: clock.now(),
      actor,
      action: 'client.renamed',
      subject: { type: 'client', id: client.id },
      clientId: client.id,
      details: {},
    })
    if (!entry.ok) return entry

    await audit.record(entry.value)
    await clients.save(renamed.value)
    return ok(renamed.value)
  }
