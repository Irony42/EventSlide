import type {
  ClipJobId,
  EventId,
  GuestId,
  PhotoId,
  ReactionId,
  UserId,
} from '../../domain/shared/ids'

/**
 * The only source of randomness in the application.
 *
 * Ids appear in URLs, so they are opaque and unguessable rather than sequential —
 * 1.0's `INTEGER PRIMARY KEY AUTOINCREMENT` meant `/admin/getpic/3` invited you to try
 * `/admin/getpic/4`.
 *
 * `bytes` exists because a join code is derived from raw entropy by a pure domain
 * function (`JoinCode.fromBytes`). Keeping the randomness behind this port is what lets
 * a test assert an exact join code instead of matching a pattern.
 */
export interface IdGenerator {
  eventId(): EventId
  photoId(): PhotoId
  guestId(): GuestId
  userId(): UserId
  reactionId(): ReactionId
  /**
   * A queued transcode. Opaque for the same reason every other id is: a guest polls it
   * from their phone, so it appears in a URL and must not enumerate the evening's clips.
   */
  clipJobId(): ClipJobId

  /** Cryptographically strong bytes. Used for join codes and guest device tokens. */
  bytes(count: number): Uint8Array
}
