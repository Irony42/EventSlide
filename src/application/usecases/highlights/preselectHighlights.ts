import { isHighlightable } from '../../../domain/highlights/highlightEligibility'
import { rankedPhotos } from '../../../domain/reactions/reactionTally'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReactionRepository } from '../../ports/reactionRepository'
import { requireWritable } from '../shared/eventRole'

/**
 * "Pre-select the most liked": stars the photographs the room reacted to most (spec 08).
 *
 * The only use of the reaction ranking in the best-of. It never removes a star, and it skips
 * a photograph that is not published or is already starred, so `added` counts the stars it
 * actually put. The limit counts photographs that can take a star, as the ranking panel's
 * does: the ranking is walked from the top until that many have been met.
 */

export interface PreselectHighlightsInput {
  readonly eventId: EventId
  readonly limit: number
}

export interface PreselectHighlightsDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly photos: PhotoRepository
  readonly reactions: ReactionRepository
  readonly clock: Clock
}

export type PreselectHighlights = (
  input: PreselectHighlightsInput,
) => Promise<Result<{ readonly added: number }, DomainError>>

export const makePreselectHighlights =
  ({ events, photos, reactions, clock }: PreselectHighlightsDeps): PreselectHighlights =>
  async ({ eventId, limit }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const writable = requireWritable(event)
    if (!writable.ok) return writable
    if (!event.allowsModeration()) {
      return err(DomainError.conflict('event.notModeratable', { status: event.status }))
    }

    const byPhoto = await reactions.countsForEvent(eventId)
    let considered = 0
    let added = 0
    for (const photoId of rankedPhotos(byPhoto)) {
      if (considered === limit) break
      const photo = await photos.findById(eventId, photoId)
      if (photo === null || !isHighlightable(photo.status)) continue

      considered += 1
      if (photo.isHighlighted) continue
      if (await photos.setHighlighted(eventId, photoId, clock.now())) added += 1
    }
    return ok({ added })
  }
