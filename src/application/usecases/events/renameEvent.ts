import type { Event } from '../../../domain/events/event'
import { EventName } from '../../../domain/events/eventName'
import { canManageEvent } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * The host corrects the event's name.
 *
 * Owner only, like settings and the lifecycle: the name is on the wall and on the
 * printed cards, so changing it is the host's decision rather than that of whoever was
 * handed the moderation laptop for the evening.
 *
 * The slug is deliberately left alone. It is the address of the projector page and of
 * every media URL already in flight; deriving it again from a corrected name would
 * change those links mid-event, which is a far worse outcome than a slug that no longer
 * matches the title.
 */

export interface RenameEventInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly name: string
}

export interface RenameEventDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
}

export type RenameEvent = (input: RenameEventInput) => Promise<Result<Event, DomainError>>

export const makeRenameEvent =
  ({ events, memberships, bus }: RenameEventDeps): RenameEvent =>
  async ({ eventId, actorId, name }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const role = await memberships.roleFor(eventId, actorId)
    // `notFound` rather than `forbidden` for a caller with no part in the event, so
    // this cannot be used to discover that the event exists. Same choice every other
    // event use case and `requireRole` make.
    if (role === null) return err(DomainError.notFound('event.notFound'))
    if (!canManageEvent(role)) {
      return err(DomainError.forbidden('auth.forbidden', { required: 'owner' }))
    }

    const parsed = EventName.create(name)
    if (!parsed.ok) return parsed

    // The archived rule lives in the entity, which says it once for every kind of edit.
    const renamed = event.rename(parsed.value)
    if (!renamed.ok) return renamed

    await events.save(renamed.value)
    // No dedicated fact: `settingsChanged` is the "refetch the event" signal the host
    // console and the wall already listen to, and the name is what the wall shows.
    bus.publish({ type: 'event.settingsChanged', eventId: renamed.value.id })

    return ok(renamed.value)
  }
