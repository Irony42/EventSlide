import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * The host takes their logo down (spec 03). Owner only, **idempotent** (removing what is not
 * there answers the event unchanged), and row first, bytes second: the row is what makes a file
 * reachable, so a delete that then fails leaves an unreachable file for the sweep rather than a
 * settings row naming bytes that are gone.
 *
 * A held event refuses it, like putting one up: taking the logo down destroys a file the hold
 * exists to keep.
 *
 * The event is read again just before the save, with no await between, so a settings save that
 * began earlier cannot be undone by this one (nor this one by it).
 */

export interface RemoveEventLogoInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface RemoveEventLogoDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
  readonly media: MediaStore
  readonly bus: EventBus
  readonly logger: Logger
}

export type RemoveEventLogo = (input: RemoveEventLogoInput) => Promise<Result<Event, DomainError>>

export const makeRemoveEventLogo =
  ({ events, memberships, media, bus, logger }: RemoveEventLogoDeps): RemoveEventLogo =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'manage')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    if (event.isPurgeHeld()) return err(DomainError.unexpected('logo.saveFailed'))

    const current = await events.findById(eventId)
    if (current === null) return err(DomainError.notFound('event.notFound'))

    const previous = current.settings.logo
    if (previous === null) return ok(current)

    const updated = current.withSettings(current.settings.withLogo(null))
    if (!updated.ok) return updated

    await events.save(updated.value)
    bus.publish({ type: 'event.settingsChanged', eventId })

    try {
      await media.delete(eventId, previous)
    } catch (cause) {
      logger.warn('could not remove a logo; leaving it for the sweep', {
        eventId,
        cause: String(cause),
      })
    }

    return ok(updated.value)
  }
