import { canModerate } from '../../../domain/events/eventRole'
import {
  targetStatusFor,
  type ModerationDecision,
} from '../../../domain/moderation/moderationDecision'
import type { PhotoActor, Reviewer } from '../../../domain/photos/photo'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { MembershipRepository } from '../../ports/userRepository'

/**
 * One decision on one photo — the operation the whole product is built around.
 *
 * Three rules are delegated rather than restated, because 1.0 restated all three in
 * every route handler and they drifted: `targetStatusFor` is the only bridge from the
 * host's verb to a stored status, `Photo.transitionTo` is the only judge of whether the
 * move is legal, and `canModerate` is the only definition of who may ask.
 *
 * Nothing is announced unless something changed. A `photo.moderated` frame makes every
 * projector in the room re-read its playlist, so publishing one for a refused
 * transition would make an illegal keystroke look like a successful one on screen.
 */

export interface ModeratePhotoInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly decision: ModerationDecision
  /** A guest is a legitimate principal on other routes, so it must be refused here. */
  readonly actor: PhotoActor
}

export interface ModeratePhotoDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export interface ModeratedPhoto {
  readonly photoId: PhotoId
  readonly status: PhotoStatus
}

export type ModeratePhoto = (
  input: ModeratePhotoInput,
) => Promise<Result<ModeratedPhoto, DomainError>>

export const makeModeratePhoto =
  ({ events, photos, memberships, bus, clock }: ModeratePhotoDeps): ModeratePhoto =>
  async ({ eventId, photoId, decision, actor }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    // A guest holds a device token for this event, so its existence is not a secret
    // from them: 403 is honest here and reveals nothing. There is deliberately no role
    // that could grant moderation to a phone — what the room sees is the host's alone.
    if (actor.kind === 'guest') {
      return err(DomainError.forbidden('auth.forbidden', { required: 'moderator' }))
    }

    const role = await memberships.roleFor(eventId, actor.userId)
    // A signed-in user with no part in this event is answered exactly as one asking
    // about an event that does not exist, so this cannot be used to discover other
    // people's weddings. `canModerate` is asked rather than the qualifying roles being
    // listed, so a role added later is refused by default.
    if (role === null || !canModerate(role)) return err(DomainError.notFound('event.notFound'))

    // An archived event is a record: its media may already have been tiered off, and a
    // decision recorded now would apply to an album nobody can act on.
    if (!event.allowsModeration()) {
      return err(DomainError.conflict('event.notModeratable', { status: event.status }))
    }

    // Scoped read: passing eventId is what makes another event's photo unreachable.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    const reviewer: Reviewer = { kind: 'host', userId: actor.userId }
    const moved = photo.transitionTo(targetStatusFor(decision), reviewer, clock.now())
    if (!moved.ok) return moved

    await photos.save(moved.value)
    bus.publish({ type: 'photo.moderated', eventId, photoId, status: moved.value.status })

    return ok({ photoId, status: moved.value.status })
  }
