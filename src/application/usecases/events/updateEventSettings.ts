import type { Event } from '../../../domain/events/event'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { mergeWallSettings } from '../../../domain/events/eventWallSettings'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { ceilingsOf } from '../clients/clientContextOf'
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
  /** Stamps the mixed wall's anchor. */
  readonly clock: Clock
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

/**
 * The patch applied to one reading of the event: validated as a whole (so one field cannot be
 * persisted out of range while its neighbour is refused), the purge hold on the welcome message,
 * and the archived rule, which lives in the entity.
 */
const judge = (
  event: Event,
  patch: EventSettingsPatch,
  nowMs: number,
): Result<Event, DomainError> => {
  const settings = event.settings.with(withMixedAnchor(event, patch, nowMs))
  if (!settings.ok) return settings

  // A purge hold keeps evidence: changing or clearing the welcome message destroys the previous
  // text, so it is refused while the value changes (the same text sent back, as a full form does,
  // passes). Code `saveFailed`, never one that names the hold, like `venuePhoto.saveFailed`.
  if (event.isPurgeHeld() && settings.value.welcomeMessage !== event.settings.welcomeMessage) {
    return err(DomainError.unexpected('eventSettings.saveFailed'))
  }

  // The archived rule lives in the entity: an archived event is a record whose media may have
  // been tiered off, and it says so once for every kind of edit.
  return event.withSettings(settings.value)
}

/**
 * The mixed wall's phases restart when the host turns the mode on or changes a duration, so the
 * host who ticks the box sees the wall first. Any other save (a layout, a caption policy, the
 * same form sent back whole) leaves the anchor where it was and the rooms in step. The anchor is
 * the server's: a patch's own value is overwritten, and no route carries one.
 */
const withMixedAnchor = (
  event: Event,
  patch: EventSettingsPatch,
  nowMs: number,
): EventSettingsPatch => {
  const before = event.settings.wall
  const after = mergeWallSettings(before, patch.wall)
  const restarts =
    after.mixedEnabled &&
    (!before.mixedEnabled ||
      after.mixedWallSeconds !== before.mixedWallSeconds ||
      after.mixedSlideshowSeconds !== before.mixedSlideshowSeconds)
  return {
    ...patch,
    wall: { ...patch.wall, mixedAnchorMs: restarts ? nowMs : before.mixedAnchorMs },
  }
}

export const makeUpdateEventSettings =
  ({ clock, events, clients, memberships, bus }: UpdateEventSettingsDeps): UpdateEventSettings =>
  async ({ eventId, actorId, patch }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // Judged on the entity read at the top, so the answers to a bad request come before the
    // awaits below, in the order they always did.
    const nowMs = clock.now().getTime()
    const judged = judge(event, patch, nowMs)
    if (!judged.ok) return judged

    // The client's ceilings (roadmap §10.5 / G2-05): the rule, and why it asks only of what this
    // save changes, are `ClientCeilings.settingsRefusal`'s.
    const ceilings = await ceilingsOf(clients, event)
    const refusal = ceilings?.settingsRefusal(event.settings, patch) ?? null
    if (refusal !== null) return err(refusal)

    // **Read again, and saved with no await between.** The copy read at the top is older than the
    // awaits above (the role, the client's ceilings), and `events.save` rewrites the whole row: saving
    // that copy would erase a logo a `setEventLogo` wrote in between. The patch is applied to the
    // fresh entity instead (the ceilings were judged on what this save changes, which is the same).
    const current = await events.findById(eventId)
    if (current === null) return err(DomainError.notFound('event.notFound'))
    const updated = judge(current, patch, nowMs)
    if (!updated.ok) return updated

    await events.save(updated.value)
    bus.publish({ type: 'event.settingsChanged', eventId: updated.value.id })

    return ok(updated.value)
  }
