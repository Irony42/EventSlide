import { parseAuditReason } from '../../../domain/audit/auditReason'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import { recordOperatorAct, type OperatorActInput } from './operatorAct'

/**
 * Holds an event's purge, to preserve evidence, or releases it (`POST /api/site/events/:eventId/purge-hold`
 * and `/purge-release`; launch review S5, G8-03; the rules every operator act shares are in
 * `operatorAct.ts`).
 *
 * The retention sweep skips a held event (`listDueForPurge` never lists it) and **nothing of the
 * event is destroyed by anyone else either**: the host's purge and the deletion of a photograph
 * (a host's, a moderator's or a guest's own) are refused while it is held. It hides nothing and
 * tells no screen: a hold is invisible to the room, and independent of a takedown. Releasing it
 * makes the event due again at its own deadline, which may already have passed, so the next sweep
 * purges it.
 */

export interface SetEventPurgeHoldInput extends OperatorActInput {
  readonly eventId: EventId
  /** `true` holds the purge, `false` releases it. */
  readonly held: boolean
}

export interface SetEventPurgeHoldDeps {
  readonly events: Pick<EventRepository, 'findById' | 'setPurgeHeld'>
  readonly audit: AuditRecorder
  readonly clock: Clock
}

export type SetEventPurgeHold = (
  input: SetEventPurgeHoldInput,
) => Promise<Result<void, DomainError>>

export const makeSetEventPurgeHold =
  ({ events, audit, clock }: SetEventPurgeHoldDeps): SetEventPurgeHold =>
  async ({ eventId, held, reason, actor }) => {
    const why = parseAuditReason(reason)
    if (!why.ok) return why

    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    if (event.isPurgeHeld() === held) return ok(undefined)

    const at = clock.now()
    const recorded = await recordOperatorAct(audit, {
      at,
      actor,
      action: held ? 'event.purgeHeld' : 'event.purgeReleased',
      subject: { type: 'event', id: event.id },
      reason: why.value,
    })
    if (!recorded.ok) return recorded

    await events.setPurgeHeld(event.id, held ? at : null)
    return ok(undefined)
  }
