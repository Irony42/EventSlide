import type { AuditActorInput } from '../../../domain/audit/auditActor'
import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import type { ClientId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'

/** Between a day and a year: a window to export in, and a client that is not kept for ever. */
export const OFFBOARD_GRACE_DAYS = { min: 1, max: 365 } as const

const DAY_MS = 86_400_000

export interface OffboardClientInput {
  readonly clientId: ClientId
  readonly actor: AuditActorInput
  /** How long the client keeps its albums, from now, to export them (docs/ROADMAP.md §4.4). */
  readonly graceDays: number
}

export interface OffboardClientDeps {
  readonly clients: ClientRepository
  readonly events: Pick<EventRepository, 'listByClient' | 'save'>
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type OffboardClient = (input: OffboardClientInput) => Promise<Result<void, DomainError>>

/**
 * Ends a client's engagement (G2-14 part 3, roadmap §10.7): the relationship is over, and the
 * operator does it without a database console.
 *
 * - **Live events are closed and drafts archived**, so nothing is left running or openable. An
 *   event that is already closed or archived stays as it is: its album is what the client may still
 *   export.
 * - **The client is frozen**, as by `suspendClient` (its public surfaces answer as for an unknown
 *   event and its members read and cannot write), and **its albums are given a purge date**,
 *   `graceDays` from now, in `clients.purge_after`: the retention sweep already purges every event of
 *   a client whose date has passed, so the albums go with no new deletion path.
 * - What happens next is `finalizeOffboardedClients`, run by the same sweep once the events are gone:
 *   the accounts that belonged to nothing else and the client row go.
 *
 * It records one `client.offboarded` line with the window and the number of events it moved, never
 * which ones. Write-ahead: the line is built (so validated) and recorded before anything changes;
 * the events are moved before the client is marked, so a failure half way leaves a client that is
 * not offboarded and whose events are already closed, and asking again finishes the job.
 *
 * Idempotent: a client already being offboarded keeps its first date, nothing is written and no
 * second line is added. `400 client.graceInvalid` for a window outside `1..365` days, asked before
 * anything is read.
 */
export const makeOffboardClient =
  ({ clients, events, audit, clock }: OffboardClientDeps): OffboardClient =>
  async ({ clientId, actor, graceDays }) => {
    if (
      !Number.isInteger(graceDays) ||
      graceDays < OFFBOARD_GRACE_DAYS.min ||
      graceDays > OFFBOARD_GRACE_DAYS.max
    ) {
      return err(DomainError.invalid('client.graceInvalid'))
    }

    const client = await clients.findById(clientId)
    if (client === null) return err(DomainError.notFound('client.notFound'))
    if (client.isOffboarding()) return ok(undefined)

    const at = clock.now()
    const moved: Event[] = []
    let closed = 0
    let archived = 0
    for (const event of await events.listByClient(clientId)) {
      if (event.status === 'live') {
        const next = event.close(at)
        if (!next.ok) return next
        moved.push(next.value)
        closed += 1
      } else if (event.status === 'draft') {
        const next = event.archive(at)
        if (!next.ok) return next
        moved.push(next.value)
        archived += 1
      }
    }

    const entry = AuditEntry.create({
      at,
      actor,
      action: 'client.offboarded',
      subject: { type: 'client', id: client.id },
      clientId: client.id,
      details: { graceDays, closed, archived },
    })
    if (!entry.ok) return entry

    await audit.record(entry.value)
    for (const event of moved) await events.save(event)
    await clients.save(client.offboard(at, new Date(at.getTime() + graceDays * DAY_MS)))
    return ok(undefined)
  }
