import { AuditEntry } from '../../../domain/audit/auditEntry'
import type { Event } from '../../../domain/events/event'
import { isRevealed, revealNow } from '../../../domain/events/eventRevealSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AuditRecorder } from '../../ports/auditLog'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * "Révéler maintenant" (spec 23): the host shows the evening to the guests and the room.
 *
 * **It writes an hour that is now** (`at = now`), nothing else: no photograph changes status, so
 * what a moderator had not approved stays hidden, and what one hid stays hidden (the reveal
 * opens the public door of the event; moderation is the door of each photograph). It is not a
 * state of its own, which is why there is no balayeur and why an event that restarts at the hour
 * changes nothing.
 *
 * **Any moderator may**, as any moderator may launch a challenge: the person at the evening with
 * a laptop (the DJ, the witness) is usually not the owner. The confirmation belongs to the
 * interface; here the act is **audited** (`event.revealed`, written first: a reveal that cannot
 * be recorded does not happen) because it cannot be taken back.
 *
 * **Idempotent.** An evening that is already revealed (the hour went by, or the mode is off)
 * answers success and writes nothing: no second audit line, no signal, and above all no change of
 * the hour the room was shown. The answer carries the event as it is.
 */

export interface RevealEventInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RevealEventDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly audit: AuditRecorder
  readonly bus: EventBus
  readonly clock: Clock
}

export type RevealEvent = (input: RevealEventInput) => Promise<Result<Event, DomainError>>

export const makeRevealEvent =
  ({ events, memberships, audit, bus, clock }: RevealEventDeps): RevealEvent =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'moderate')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    const now = clock.now()
    if (isRevealed(event.settings.reveal, now)) return ok(event)

    const settings = event.settings.with({ reveal: revealNow(event.settings.reveal, now) })
    if (!settings.ok) return settings
    const revealed = event.withSettings(settings.value)
    if (!revealed.ok) return revealed

    // Write-ahead, like the operator's acts: no reveal without the line saying who did it.
    const entry = AuditEntry.create({
      at: now,
      actor: { kind: 'member', userId: actorId },
      action: 'event.revealed',
      subject: { type: 'event', id: event.id },
      clientId: event.clientId,
      details: {},
    })
    if (!entry.ok) return entry
    await audit.record(entry.value)

    await events.save(revealed.value)
    // The console, the wall and the phones read the event again; no new signal type (spec 23 §5).
    bus.publish({ type: 'event.settingsChanged', eventId: event.id })

    return ok(revealed.value)
  }
