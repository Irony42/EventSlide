import type { Event } from '../../../domain/events/event'
import { canManageEvent } from '../../../domain/events/eventRole'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host changes the event's policy: moderation mode, captions, reactions,
 * self-delete window, retention, per-guest cap.
 *
 * Owner only. A moderator was handed a laptop to approve photos for the evening;
 * letting them turn moderation off, or set retention to a day, would make lending out
 * the console the same thing as handing over the event.
 */

export interface UpdateEventSettingsInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** Absent fields are left alone; `null` means "no limit". Two different intents. */
  readonly patch: EventSettingsPatch
}

export interface UpdateEventSettingsDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
}

export type UpdateEventSettings = (
  input: UpdateEventSettingsInput,
) => Promise<Result<Event, DomainError>>

export const makeUpdateEventSettings =
  ({ events, memberships, bus }: UpdateEventSettingsDeps): UpdateEventSettings =>
  async ({ eventId, actorId, patch }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    // No membership answers `notFound`, not `forbidden`: confirming that an event
    // exists to someone with no part in it turns this into an enumeration oracle for
    // other people's events. Same choice `requireRole` makes at the HTTP boundary.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    // Validated as a whole, so one field cannot be persisted out of range while its
    // neighbour is refused.
    const settings = event.settings.with(patch)
    if (!settings.ok) return settings

    // The archived rule lives in the entity: an archived event is a record whose media
    // may have been tiered off, and it says so once for every kind of edit.
    const updated = event.withSettings(settings.value)
    if (!updated.ok) return updated

    await events.save(updated.value)
    bus.publish({ type: 'event.settingsChanged', eventId: updated.value.id })

    return ok(updated.value)
  }
