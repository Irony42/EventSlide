import type { Event } from '../../../domain/events/event'
import { canManageEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host arms — or disarms — the automatic opening and closing.
 *
 * Owner only, for the same reason `changeEventStatus` is: this decides when guests can
 * upload and when they stop, and a moderator handed a laptop for the evening is not
 * being handed the event.
 *
 * Nothing here decides whether the instants are coherent, already past, or whether the
 * event may hold them at all. `Event.reschedule` owns all three, so the answer the host
 * gets from this form is the same one the sweep will act on.
 */

export interface ScheduleEventInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** `null` clears that half: "I will open the doors myself". */
  readonly scheduledOpenAt: Date | null
  readonly scheduledCloseAt: Date | null
}

export interface ScheduleEventDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  /** What "already in the past" is measured against. See `Event.reschedule`. */
  readonly clock: Clock
}

export type ScheduleEvent = (input: ScheduleEventInput) => Promise<Result<Event, DomainError>>

export const makeScheduleEvent =
  ({ events, memberships, bus, clock }: ScheduleEventDeps): ScheduleEvent =>
  async ({ eventId, actorId, scheduledOpenAt, scheduledCloseAt }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    // `notFound`, not `forbidden`: confirming an event exists to someone with no part in
    // it turns this into an enumeration oracle, exactly as in `updateEventSettings`.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    const updated = event.reschedule({ scheduledOpenAt, scheduledCloseAt }, clock.now())
    if (!updated.ok) return updated

    await events.save(updated.value)
    // `settingsChanged` rather than a new frame type: the schedule reaches every client
    // as part of the event itself, and this signal is what makes a second open console
    // refetch it. The bus carries topics, never payloads (docs/ARCHITECTURE.md §7).
    bus.publish({ type: 'event.settingsChanged', eventId: updated.value.id })

    return ok(updated.value)
  }
