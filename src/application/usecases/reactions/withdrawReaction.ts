import { isReactionKind } from '../../../domain/reactions/reactionKind'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, GuestId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ReactionRepository } from '../../ports/reactionRepository'

/**
 * A guest taking back a reaction. Their own, and only their own.
 *
 * "Only their own" is a property of the lookup rather than a check: the row is
 * addressed by `(eventId, photoId, guestId, kind)`, so another guest's reaction is not
 * forbidden — it is simply not there to withdraw, and the caller learns nothing about
 * whether it exists. A reaction has no other state, so a withdrawal is a delete.
 *
 * Deliberately not gated on `settings.allowReactions`. A host turning reactions off
 * mid-evening must not trap a guest with a reaction they can no longer remove; the
 * setting governs sending, not undoing.
 */

export interface WithdrawReactionInput {
  readonly eventId: EventId
  readonly photoId: PhotoId
  readonly guestId: GuestId
  readonly kind: string
}

export interface WithdrawReactionDeps {
  readonly reactions: ReactionRepository
}

export type WithdrawReaction = (input: WithdrawReactionInput) => Promise<Result<void, DomainError>>

export const makeWithdrawReaction =
  ({ reactions }: WithdrawReactionDeps): WithdrawReaction =>
  async ({ eventId, photoId, guestId, kind }) => {
    if (!isReactionKind(kind)) return err(DomainError.invalid('reaction.kindUnknown'))

    const existing = await reactions.findOne(eventId, photoId, guestId, kind)
    if (existing === null) return err(DomainError.notFound('reaction.notFound'))

    await reactions.delete(eventId, photoId, guestId, kind)

    // Nothing is announced: `DomainEvent` carries no removal fact, and minting one here
    // would be a new frame shape every existing subscriber has to understand. The wall
    // recounts on its next read, which for a withdrawn badge is soon enough.
    return ok(undefined)
  }
