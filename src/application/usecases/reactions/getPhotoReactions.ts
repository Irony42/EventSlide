import { REACTION_KINDS, type ReactionKind } from '../../../domain/reactions/reactionKind'
import { totalReactions, type ReactionCounts } from '../../../domain/reactions/reactionTally'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { ReactionRepository } from '../../ports/reactionRepository'

/**
 * The badge counts under one photo, plus which of them this phone already sent.
 *
 * `counts` comes back from `countsFor`, which both the SQLite adapter and the fake
 * compute with the domain's `tally` — so the number the wall animates and the number
 * the phone shows cannot be produced by two different sums. Every kind is always
 * present and zeroed, so no client ever renders `NaN` for a kind nobody tapped.
 *
 * `total` is deliberately unweighted. `reactionWeight` sizes the badge that floats over
 * the projected photo; if it also scored this sum, the photo of the night would be won
 * by whoever tapped the prettiest button.
 */

export interface GetPhotoReactionsInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  /** `null` at a projector, which has no guest identity and therefore no `mine`. */
  readonly guestId: GuestId | null
}

export interface GetPhotoReactionsDeps {
  readonly photos: PhotoRepository
  readonly reactions: ReactionRepository
}

export interface PhotoReactionsView {
  readonly counts: ReactionCounts
  readonly total: number
  /** What this guest sent for **this** photo, so their buttons can show as pressed. */
  readonly mine: readonly ReactionKind[]
}

export type GetPhotoReactions = (
  input: GetPhotoReactionsInput,
) => Promise<Result<PhotoReactionsView, DomainError>>

export const makeGetPhotoReactions =
  ({ photos, reactions }: GetPhotoReactionsDeps): GetPhotoReactions =>
  async ({ eventId, photoId, guestId }) => {
    // Scoped read: passing eventId is what makes another event's photo unreachable.
    const photo = await photos.findById(eventId, photoId)
    if (photo === null) return err(DomainError.notFound('photo.notFound'))

    const counts = await reactions.countsFor(eventId, photoId)

    // Asked per kind against `(eventId, photoId, guestId, kind)`. `listByGuest` would
    // be one round trip instead of five, but its rows carry no photo id, so it answers
    // "which kinds has this guest ever used at this event" — which would light up the
    // badges under a photo they never touched.
    const mine: ReactionKind[] = []
    if (guestId !== null) {
      for (const kind of REACTION_KINDS) {
        const existing = await reactions.findOne(eventId, photoId, guestId, kind)
        if (existing !== null) mine.push(kind)
      }
    }

    return ok({ counts, total: totalReactions(counts), mine })
  }
