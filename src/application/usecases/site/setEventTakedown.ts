import { parseAuditReason } from '../../../domain/audit/auditReason'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import { recordOperatorAct, type OperatorActInput } from './operatorAct'

/**
 * Takes a whole event down, or puts it back, by its id (`POST /api/site/events/:eventId/take-down`
 * and `/restore`; launch review S5, G8-03; the rules every operator act shares are in
 * `operatorAct.ts`).
 *
 * The wall, the guest feed, the join, a gallery link and the host's own views all answer as for an
 * event that does not exist (`Event.isTakenDown`, asked by every surface that serves an event), and
 * an open stream ends at its next beat after hearing `event.settingsChanged`. It does **not** stop the
 * retention clock (that is the purge hold) and it touches no photograph, so it is undone by one
 * call and loses nothing.
 */

export interface SetEventTakedownInput extends OperatorActInput {
  readonly eventId: EventId
  /** `true` takes it down, `false` puts it back. */
  readonly down: boolean
}

export interface SetEventTakedownDeps {
  readonly events: Pick<EventRepository, 'findById' | 'setTakenDown'>
  readonly audit: AuditRecorder
  readonly bus: Pick<EventBus, 'publish'>
  readonly clock: Clock
}

export type SetEventTakedown = (input: SetEventTakedownInput) => Promise<Result<void, DomainError>>

export const makeSetEventTakedown =
  ({ events, audit, bus, clock }: SetEventTakedownDeps): SetEventTakedown =>
  async ({ eventId, down, reason, actor }) => {
    const why = parseAuditReason(reason)
    if (!why.ok) return why

    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    if (event.isTakenDown() === down) return ok(undefined)

    const at = clock.now()
    const recorded = await recordOperatorAct(audit, {
      at,
      actor,
      action: down ? 'event.takenDown' : 'event.restored',
      subject: { type: 'event', id: event.id },
      reason: why.value,
    })
    if (!recorded.ok) return recorded

    await events.setTakenDown(event.id, down ? at : null)
    // Neutral, like the photograph's: the stream forwards the type to everyone who listens.
    bus.publish({ type: 'event.settingsChanged', eventId: event.id })
    return ok(undefined)
  }
