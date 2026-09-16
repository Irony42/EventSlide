import { randomBytes, randomUUID } from 'node:crypto'
import type { IdGenerator } from '../../application/ports/idGenerator'
import {
  asClipJobId,
  asEventId,
  asGuestId,
  asPhotoId,
  asReactionId,
  asUserId,
  type ClipJobId,
  type EventId,
  type GuestId,
  type PhotoId,
  type ReactionId,
  type UserId,
} from '../../domain/shared/ids'

/**
 * UUIDv4 for ids, `randomBytes` for the entropy a join code is derived from.
 *
 * Ids are unguessable because they appear in URLs. 1.0 used
 * `INTEGER PRIMARY KEY AUTOINCREMENT`, so `/admin/getpic/3` was an invitation to try
 * `/admin/getpic/4` — and since the media route derived the path from the session's
 * `partyId`, the only thing standing between the two was that the row happened to
 * belong to a different party.
 *
 * UUIDs rather than a shorter random string: 128 bits with a canonical text form that
 * a zod `.uuid()` on the route can validate, which turns a malformed id into a 400
 * before it reaches a query.
 */
export const randomIdGenerator: IdGenerator = {
  eventId: (): EventId => asEventId(randomUUID()),
  photoId: (): PhotoId => asPhotoId(randomUUID()),
  guestId: (): GuestId => asGuestId(randomUUID()),
  userId: (): UserId => asUserId(randomUUID()),
  reactionId: (): ReactionId => asReactionId(randomUUID()),
  clipJobId: (): ClipJobId => asClipJobId(randomUUID()),

  bytes: (count: number): Uint8Array => {
    if (!Number.isInteger(count) || count < 1) {
      // A caller asking for zero bytes of entropy is a bug worth crashing on, not a
      // condition to model: it would silently produce a constant join code.
      throw new Error(`randomIdGenerator.bytes requires a positive integer, got ${count}`)
    }
    return new Uint8Array(randomBytes(count))
  },
}
