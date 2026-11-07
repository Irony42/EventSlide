import type { Photo } from '../../../domain/photos/photo'
import type { EventId, GuestId } from '../../../domain/shared/ids'
import type { GuestRepository } from '../../ports/guestRepository'

/**
 * The name of every guest who sent one of these photos, in **one** repository read.
 *
 * A screen of photos is many photos by few guests, so the shape is batch-then-join: collect the
 * distinct senders, ask once, and let the caller map the answer back onto its rows. A
 * `findById` inside the loop would be an N+1 on the two surfaces that refetch all evening, the
 * wall and the moderation console.
 *
 * Deduplicated by guest, so the request grows with the guests in the room rather than with the
 * photos on the screen. Scoped by `eventId` before anything else: a name read that could reach
 * another event's guest list would be a leak, not a missing feature. Host-uploaded photos never
 * enter the lookup — there is no guest behind them — and a guest who stayed anonymous, or whose
 * row is gone, is simply absent from the answer: "no name", never a fabricated one.
 */
export const authorNamesOf = (
  guests: Pick<GuestRepository, 'findNamesByIds'>,
  eventId: EventId,
  photos: readonly Photo[],
): Promise<ReadonlyMap<GuestId, string>> => {
  const senders = new Set<GuestId>()
  for (const photo of photos) {
    if (photo.author.kind === 'guest') senders.add(photo.author.guestId)
  }
  return guests.findNamesByIds(eventId, [...senders])
}
