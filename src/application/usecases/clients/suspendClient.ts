import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'

/**
 * Freezes a client (roadmap §10.7; free plan G2-14, paid plan P3-13): an operator's act on the
 * box, behind `requireOperator`, a second factor and a step-up at the HTTP layer, and **audited**.
 *
 * ## What a suspension is
 *
 * `clients.suspended_at` is set, and **nothing else changes**: no account is disabled (a member
 * who was switched off for another reason would be indistinguishable after a resumption), no
 * medium is touched, the retention clock keeps running. What the column does is read at the
 * surfaces. A suspended client's **public** surfaces (the wall, the live feed, published media by
 * slug, the join, a guest's routes, the shared gallery) answer **exactly what an unknown event
 * answers**, its **members** may read and may not write (`403 client.suspended`), and an open
 * live feed is closed at its next heartbeat. docs/SECURITY.md §22 is the table.
 *
 * ## What it writes
 *
 * `client.suspended`, once: **idempotent**, like `Client.suspend`, so a second call changes
 * nothing, keeps the first instant and writes no second line. **Write-ahead**, like
 * `setClientCeilings`: the entry is built, and so validated, then recorded, then the client is
 * saved, so a suspension cannot happen without a line saying who did it, and an actor the log
 * will not accept refuses the act.
 */

export interface SuspendClientInput {
  readonly clientId: ClientId
  /** Who is freezing it: the operator, normally, or an integration acting for one. */
  readonly actor: AuditActorInput
}

export interface SuspendClientDeps {
  readonly clients: ClientRepository
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type SuspendClient = (input: SuspendClientInput) => Promise<Result<void, DomainError>>

export const makeSuspendClient =
  ({ clients, audit, clock }: SuspendClientDeps): SuspendClient =>
  async ({ clientId, actor }) => {
    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))
    if (client.isSuspended()) return ok(undefined)

    const at = clock.now()
    const entry = AuditEntry.create({
      at,
      actor,
      action: 'client.suspended',
      subject: { type: 'client', id: client.id },
      clientId: client.id,
      details: {},
    })
    if (!entry.ok) return entry

    await audit.record(entry.value)
    await clients.save(client.suspend(at))
    return ok(undefined)
  }
