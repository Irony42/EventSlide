import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import { describeCeilingsChange } from '../../../domain/audit/clientCeilingsAudit'
import type { Client } from '../../../domain/clients/client'
import { ClientCeilings, type ClientCeilingsInput } from '../../../domain/clients/clientCeilings'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'

/**
 * Changes what a client may do (roadmap §10.5). An operator's act on the box, gated by
 * `requireOperator` at the HTTP layer (G2-14), and **audited** (roadmap §10.8): who changed
 * which ceiling from what to what, and when, for the client's own owner to read (G2-16).
 *
 * **A patch, not a replacement.** An omitted key keeps the client's current value and an
 * explicit `null` removes that ceiling, so an operator raising one number cannot
 * silently lift the other seven.
 *
 * **A renewal resets the per-period counter, and nothing else does.** When the patch
 * moves `periodStartedAt` the client's `eventsCreatedInPeriod` goes back to zero —
 * `Client.withCeilings` carries the rule — and an ordinary edit of any other ceiling
 * leaves it alone. The counter never decreases on its own, so "create, delete, recreate"
 * cannot walk around a per-period ceiling.
 *
 * **What is written.** `describeCeilingsChange` decides, as a pure function: nothing when
 * the patch changed nothing, `client.ceilingsChanged {before, after}` when a ceiling
 * moved, and `client.periodReset {before, after}` as well when the period did. The actor is
 * a required input, so there is no way to change a ceiling that does not name who did it:
 * `createClient` and `renameClient` have none because they are not yet audited, and this
 * one cannot be called without.
 *
 * **Write-ahead: the entry is written before the change is.** Every entry is built, and so
 * validated, first; then the entries are recorded; then the client is saved. A ceiling
 * therefore cannot move without a line saying who moved it, and a line the log refuses (an
 * actor that is not an account, a snapshot that has drifted from the ceilings) refuses the
 * *change*, instead of saving it and failing to say so — which, the other way round, leaves
 * a change nobody can ever audit, since the retry is a patch that no longer changes
 * anything.
 *
 * **Known gap: the two writes are not one transaction.** If the save fails after the entry
 * was recorded (the disk, a locked file), the failure propagates and the log holds a line
 * for a change that did not happen; the operator's retry writes a second line with the same
 * `before` and `after`. A line for an intent that failed is the lesser of the two errors,
 * and it is visible; a change with no line is not. Closing it needs a unit-of-work port that
 * no use case has yet, and G2-20 asks for the same atomicity for the acceptance of the
 * terms, so the two should share one answer.
 */

export interface SetClientCeilingsInput {
  readonly clientId: ClientId
  readonly ceilings: ClientCeilingsInput
  /** Who is changing them: the operator, normally, or an integration acting for one. */
  readonly actor: AuditActorInput
}

export interface SetClientCeilingsDeps {
  readonly clients: ClientRepository
  /** Only the writing half of the log: this use case cannot prune it. */
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type SetClientCeilings = (
  input: SetClientCeilingsInput,
) => Promise<Result<Client, DomainError>>

export const makeSetClientCeilings =
  ({ clients, audit, clock }: SetClientCeilingsDeps): SetClientCeilings =>
  async ({ clientId, ceilings, actor }) => {
    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))

    const next = ClientCeilings.create({ ...client.ceilings.toProps(), ...ceilings })
    if (!next.ok) return next

    const updated = client.withCeilings(next.value)

    const at = clock.now()
    const entries: AuditEntry[] = []
    for (const planned of describeCeilingsChange(client, updated)) {
      const entry = AuditEntry.create({
        at,
        actor,
        action: planned.action,
        subject: { type: 'client', id: client.id },
        clientId: client.id,
        details: planned.details,
      })
      if (!entry.ok) return entry
      entries.push(entry.value)
    }

    for (const entry of entries) await audit.record(entry)
    await clients.save(updated)
    return ok(updated)
  }
