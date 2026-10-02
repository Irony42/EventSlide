import type { Event } from '../../../domain/events/event'
import { canManageEvent } from '../../../domain/events/eventRole'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { clientContextOf } from '../clients/clientContextOf'

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
  /**
   * For the ceilings of the event's client (roadmap §10.5): `max_retention_days` and
   * `clips_allowed`. Read only for an event that has a client — see `clientContextOf`.
   */
  readonly clients: ClientRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
}

export type UpdateEventSettings = (
  input: UpdateEventSettingsInput,
) => Promise<Result<Event, DomainError>>

export const makeUpdateEventSettings =
  ({ events, clients, memberships, bus }: UpdateEventSettingsDeps): UpdateEventSettings =>
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

    // The client's ceilings (roadmap §10.5 / G2-05), asked only of the fields the patch
    // actually carries: an edit that does not mention retention is not refused because the
    // stored one is above a ceiling lowered since — the purge already honours the lower
    // number, and locking a host out of unrelated settings would punish them for it.
    //
    // **Refused, where creation reduces.** An event being created has no value the host
    // chose to override; an edit does, and silently shortening what they typed would tell
    // them they got what they asked for. Both are 400, so the form can say which field.
    const ceilings = (await clientContextOf(clients, event))?.ceilings ?? null
    if (ceilings !== null) {
      const cap = ceilings.maxRetentionDays
      if (
        cap !== null &&
        patch.retentionDays !== undefined &&
        !ceilings.admitsRetention(patch.retentionDays)
      ) {
        return err(DomainError.invalid('client.retentionAboveCeiling', { maxDays: cap }))
      }
      if (patch.allowClips === true && !ceilings.clipsAllowed) {
        return err(DomainError.invalid('client.clipsNotAllowed'))
      }
    }

    await events.save(updated.value)
    bus.publish({ type: 'event.settingsChanged', eventId: updated.value.id })

    return ok(updated.value)
  }
