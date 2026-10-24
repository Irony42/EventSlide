import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'

/**
 * Lifts a suspension (roadmap §10.7; free plan G2-14, paid plan P3-13): the other half of
 * `suspendClient`, with the same gate at the HTTP layer and the same audit discipline.
 *
 * Because a suspension changed **nothing but a column**, lifting it restores exactly what was
 * there: no account is re-enabled (none was disabled), no medium is restored (none was touched),
 * and the live feeds that were closed reopen when their pages reconnect. Idempotent: resuming a
 * client that is not suspended changes nothing and writes no line. Write-ahead: `client.resumed`
 * is recorded before the client is saved.
 */

export interface ResumeClientInput {
  readonly clientId: ClientId
  readonly actor: AuditActorInput
}

export interface ResumeClientDeps {
  readonly clients: ClientRepository
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type ResumeClient = (input: ResumeClientInput) => Promise<Result<void, DomainError>>

export const makeResumeClient =
  ({ clients, audit, clock }: ResumeClientDeps): ResumeClient =>
  async ({ clientId, actor }) => {
    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))
    // An engagement that has ended is not undone by lifting the freeze (G2-14 part 3): its albums are
    // dated for purge, and a client that came back would be purged under its own feet.
    if (client.isOffboarding()) return err(DomainError.conflict('client.offboarding'))
    if (!client.isSuspended()) return ok(undefined)

    const entry = AuditEntry.create({
      at: clock.now(),
      actor,
      action: 'client.resumed',
      subject: { type: 'client', id: client.id },
      clientId: client.id,
      details: {},
    })
    if (!entry.ok) return entry

    await audit.record(entry.value)
    await clients.save(client.reinstate())
    return ok(undefined)
  }
