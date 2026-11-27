import { parseAuditReason } from '../../../domain/audit/auditReason'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { InvalidateExport } from '../exports/invalidateAlbumExport'
import type { TakedownHook } from '../notices/notifyTakedown'
import {
  parseHostNotice,
  recordOperatorAct,
  type HostNotice,
  type OperatorActInput,
} from './operatorAct'

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

export interface SetEventTakedownInput extends OperatorActInput, HostNotice {
  readonly eventId: EventId
  /** `true` takes it down, `false` puts it back. */
  readonly down: boolean
}

export interface SetEventTakedownDeps {
  readonly events: Pick<EventRepository, 'findById' | 'setTakenDown'>
  readonly audit: AuditRecorder
  readonly bus: Pick<EventBus, 'publish'>
  readonly clock: Clock
  /**
   * Retires the verified archive the box may hold (spec 22) when an event is taken down, awaited and before anything
   * goes: an archive must never still hold what was removed.
   */
  readonly invalidateExport?: InvalidateExport
  /** Tells the event's owners, when the operator asked to and the event was really taken down (spec 32, A4). */
  readonly notice?: TakedownHook
}

export type SetEventTakedown = (input: SetEventTakedownInput) => Promise<Result<void, DomainError>>

export const makeSetEventTakedown =
  ({
    events,
    audit,
    bus,
    clock,
    invalidateExport,
    notice,
  }: SetEventTakedownDeps): SetEventTakedown =>
  async ({ eventId, down, reason, actor, notifyHost, hostReason }) => {
    const why = parseAuditReason(reason)
    if (!why.ok) return why
    const told = parseHostNotice({ notifyHost, hostReason })
    if (!told.ok) return told

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

    // The event stops being served at once, and so does the copy of its album the box keeps.
    if (down) await invalidateExport?.(event.id, 'takenDown')
    await events.setTakenDown(event.id, down ? at : null)
    // Neutral, like the photograph's: the stream forwards the type to everyone who listens.
    bus.publish({ type: 'event.settingsChanged', eventId: event.id })
    if (down && told.value.tell) {
      notice?.({ kind: 'event', eventId: event.id, reason: told.value.reason, at })
    }
    return ok(undefined)
  }
