import type { Reaction } from '../../domain/reactions/reaction'
import type { ReactionKind } from '../../domain/reactions/reactionKind'
import { tally, type ReactionCounts, type TallyEntry } from '../../domain/reactions/reactionTally'
import type { EventId, GuestId, PhotoId } from '../../domain/shared/ids'
import type { ReactionRepository } from '../ports/reactionRepository'

/**
 * In-memory `ReactionRepository`.
 *
 * Two different keys are at work, and conflating them is the bug this double exists to
 * catch:
 *
 * - **Reads are event-scoped**, keyed by `${eventId}:${photoId}:${guestId}:${kind}`,
 *   so a reaction looked up under the wrong event misses like every other row here.
 * - **Uniqueness is not.** `idx_reactions_unique` is on `(photo_id, guest_id, kind)`
 *   alone, because a photo id already belongs to exactly one event. A second row for
 *   the same triple therefore rejects whatever event id it claims — which is what
 *   stops a double tap on a flaky phone connection inflating a count.
 *
 * Counting goes through the domain's own `tally`, so the fake cannot disagree with the
 * arithmetic the wall renders.
 */

/** Code-unit order, not locale order: an id sort must not depend on the host's ICU. */
const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)

const newestFirst = (left: Reaction, right: Reaction): number =>
  right.createdAt.getTime() - left.createdAt.getTime() || compareIds(left.id, right.id)

const key = (eventId: EventId, photoId: PhotoId, guestId: GuestId, kind: ReactionKind): string =>
  `${eventId}:${photoId}:${guestId}:${kind}`

const toEntry = (reaction: Reaction): TallyEntry => ({
  kind: reaction.kind,
  guestId: reaction.guestId,
})

export class FakeReactionRepository implements ReactionRepository {
  private readonly rows = new Map<string, Reaction>()

  seed(...reactions: readonly Reaction[]): this {
    for (const reaction of reactions) this.insert(reaction)
    return this
  }

  private insert(reaction: Reaction): void {
    for (const row of this.rows.values()) {
      if (row.id === reaction.id) continue
      if (
        row.photoId === reaction.photoId &&
        row.guestId === reaction.guestId &&
        row.kind === reaction.kind
      ) {
        // Mirrors better-sqlite3's message, so a rejection reads the same way against
        // either implementation.
        throw new Error(
          `UNIQUE constraint failed: reactions.photo_id, reactions.guest_id, reactions.kind ` +
            `(${reaction.photoId}/${reaction.guestId}/${reaction.kind})`,
        )
      }
    }
    this.rows.set(
      key(reaction.eventId, reaction.photoId, reaction.guestId, reaction.kind),
      reaction,
    )
  }

  private forEvent(eventId: EventId): Reaction[] {
    return [...this.rows.values()].filter((reaction) => reaction.eventId === eventId)
  }

  async findOne(
    eventId: EventId,
    photoId: PhotoId,
    guestId: GuestId,
    kind: ReactionKind,
  ): Promise<Reaction | null> {
    return this.rows.get(key(eventId, photoId, guestId, kind)) ?? null
  }

  async save(reaction: Reaction): Promise<void> {
    this.insert(reaction)
  }

  /** Idempotent: withdrawing a reaction that is already gone is not an error. */
  async delete(
    eventId: EventId,
    photoId: PhotoId,
    guestId: GuestId,
    kind: ReactionKind,
  ): Promise<void> {
    this.rows.delete(key(eventId, photoId, guestId, kind))
  }

  async countsFor(eventId: EventId, photoId: PhotoId): Promise<ReactionCounts> {
    return tally(
      this.forEvent(eventId)
        .filter((reaction) => reaction.isFor(photoId))
        .map(toEntry),
    )
  }

  /**
   * Only photos that carry at least one reaction appear, because a `GROUP BY` produces
   * no row for a photo nobody reacted to — and `topPhotos` must not rank a silent
   * photo above nothing.
   */
  async countsForEvent(eventId: EventId): Promise<ReadonlyMap<PhotoId, ReactionCounts>> {
    const byPhoto = new Map<PhotoId, TallyEntry[]>()
    for (const reaction of this.forEvent(eventId)) {
      const entries = byPhoto.get(reaction.photoId) ?? []
      entries.push(toEntry(reaction))
      byPhoto.set(reaction.photoId, entries)
    }

    const counts = new Map<PhotoId, ReactionCounts>()
    for (const [photoId, entries] of byPhoto) counts.set(photoId, tally(entries))
    return counts
  }

  async listByGuest(eventId: EventId, guestId: GuestId): Promise<readonly TallyEntry[]> {
    return this.forEvent(eventId)
      .filter((reaction) => reaction.isBy(guestId))
      .sort(newestFirst)
      .map(toEntry)
  }

  /** Feeds the anti-spam window. Inclusive of the boundary instant. */
  async countByGuestSince(eventId: EventId, guestId: GuestId, since: Date): Promise<number> {
    return this.forEvent(eventId).filter(
      (reaction) => reaction.isBy(guestId) && reaction.createdAt.getTime() >= since.getTime(),
    ).length
  }
}
