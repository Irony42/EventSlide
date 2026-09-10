import { isVisibleOnWall } from '../../../domain/photos/photoStatus'
import { Reaction } from '../../../domain/reactions/reaction'
import { canReact } from '../../../domain/reactions/reactionBudget'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReactionRepository } from '../../ports/reactionRepository'

/**
 * A guest tapping a badge on their phone while the photo is on the wall.
 *
 * This is the only write a guest can repeat as fast as a thumb moves, and each one
 * fans out to every browser holding the wall open — a spam channel on the projector and
 * a denial of service on a self-hosted box at the same time. Four gates, in this order:
 * the host allows reactions at all, the photo is actually on the wall, the guest has
 * not already sent this kind, and the guest's own recent count still fits the budget.
 */

/**
 * The anti-spam window, injected rather than hardcoded: it is an operator setting, and
 * a misconfigured one has to be refused loudly instead of quietly letting a flood
 * through. The arithmetic itself lives in `domain/reactions/reactionBudget.ts`.
 */
export interface ReactionBudgetPolicy {
  readonly windowMs: number
  readonly maxPerWindow: number
}

export interface ReactToPhotoInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly guestId: GuestId
  /** Raw, so the closed set is parsed once — by the domain, in `Reaction.create`. */
  readonly kind: string
}

export interface ReactToPhotoDeps {
  readonly events: EventRepository
  readonly photos: PhotoRepository
  readonly reactions: ReactionRepository
  readonly bus: EventBus
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly budget: ReactionBudgetPolicy
}

export type ReactToPhoto = (input: ReactToPhotoInput) => Promise<Result<void, DomainError>>

export const makeReactToPhoto =
  ({ events, photos, reactions, bus, clock, ids, budget }: ReactToPhotoDeps): ReactToPhoto =>
  async ({ eventId, photoId, guestId, kind }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (!event.settings.allowReactions) {
      return err(DomainError.forbidden('event.reactionsDisabled'))
    }

    // Scoped read: passing eventId is what makes another event's photo unreachable.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    // You react to what is on the wall. A pending photo has had no decision, so a
    // reaction to it would be a vote on something the host never showed the room — and
    // the count would already be waiting on the projector if it were later published.
    if (!isVisibleOnWall(photo.status)) {
      return err(DomainError.conflict('reaction.notPublished', { status: photo.status }))
    }

    const now = clock.now()
    const reaction = Reaction.create({ eventId, photoId, guestId, kind }, ids.reactionId(), now)
    if (!reaction.ok) return reaction

    // Asked rather than left to the unique index: a constraint violation as control
    // flow cannot tell a double tap on a flaky connection from a real conflict.
    const existing = await reactions.findOne(eventId, photoId, guestId, reaction.value.kind)
    if (existing !== null) return err(DomainError.conflict('reaction.alreadyExists'))

    const recentCount = await reactions.countByGuestSince(
      eventId,
      guestId,
      new Date(now.getTime() - budget.windowMs),
    )
    const allowed = canReact({
      recentCount,
      windowMs: budget.windowMs,
      maxPerWindow: budget.maxPerWindow,
    })
    if (!allowed.ok) return allowed
    if (!allowed.value) return err(DomainError.rateLimited('reaction.rateLimited'))

    await reactions.save(reaction.value)
    bus.publish({ type: 'reaction.added', eventId, photoId, kind: reaction.value.kind })

    return ok(undefined)
  }
