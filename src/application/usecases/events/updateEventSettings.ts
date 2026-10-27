import type { Event } from '../../../domain/events/event'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { clientContextOf } from '../clients/clientContextOf'
import { requireEventRole, requireWritable } from '../shared/eventRole'

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

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // Validated as a whole, so one field cannot be persisted out of range while its
    // neighbour is refused.
    const settings = event.settings.with(patch)
    if (!settings.ok) return settings

    // The archived rule lives in the entity: an archived event is a record whose media
    // may have been tiered off, and it says so once for every kind of edit.
    const updated = event.withSettings(settings.value)
    if (!updated.ok) return updated

    // The client's ceilings (roadmap §10.5 / G2-05): the rule, and why it asks only of what this
    // save changes, are `ClientCeilings.settingsRefusal`'s.
    const ceilings = (await clientContextOf(clients, event))?.ceilings ?? null
    const refusal = ceilings?.settingsRefusal(event.settings, patch) ?? null
    if (refusal !== null) return err(refusal)

    await events.save(updated.value)
    bus.publish({ type: 'event.settingsChanged', eventId: updated.value.id })

    return ok(updated.value)
  }
