import type { Reaction } from '../../domain/reactions/reaction'
import type { ReactionKind } from '../../domain/reactions/reactionKind'
import type { ReactionCounts, TallyEntry } from '../../domain/reactions/reactionTally'
import type { EventId, GuestId, PhotoId } from '../../domain/shared/ids'

export interface ReactionRepository {
  /**
   * One reaction of each kind per guest per photo. A unique index on
   * `(photo_id, guest_id, kind)` is the real enforcement; this read lets the use case
   * answer "already reacted" without relying on a constraint violation as control flow.
   */
  findOne(
    eventId: EventId,
    photoId: PhotoId,
    guestId: GuestId,
    kind: ReactionKind,
  ): Promise<Reaction | null>

  save(reaction: Reaction): Promise<void>

  /** Withdrawing a reaction is a delete, because a reaction has no other state. */
  delete(eventId: EventId, photoId: PhotoId, guestId: GuestId, kind: ReactionKind): Promise<void>

  countsFor(eventId: EventId, photoId: PhotoId): Promise<ReactionCounts>

  /** Powers the "photo of the night" panel and the end-of-event recap. */
  countsForEvent(eventId: EventId): Promise<ReadonlyMap<PhotoId, ReactionCounts>>

  /** What a guest has already reacted to, so their phone can show it as pressed. */
  listByGuest(eventId: EventId, guestId: GuestId): Promise<readonly TallyEntry[]>

  /** Feeds the pure anti-spam arithmetic in `domain/reactions/reactionBudget.ts`. */
  countByGuestSince(eventId: EventId, guestId: GuestId, since: Date): Promise<number>
}
