import {
  asEventId,
  asGuestId,
  asPhotoId,
  asReactionId,
  asUserId,
  type EventId,
  type GuestId,
  type PhotoId,
  type ReactionId,
  type UserId,
} from '../../domain/shared/ids'
import type { IdGenerator } from '../ports/idGenerator'

/**
 * Readable, deterministic ids: `event-1`, `photo-1`, `photo-2`, `guest-1`.
 *
 * A counter per kind rather than one shared counter, so an assertion reads
 * `photo-2` — the second photo — instead of `id-7`, which says nothing about what the
 * test just did.
 *
 * `bytes` is a fixed sequence rather than randomness, because a join code is derived
 * from it by a pure domain function: keeping the entropy behind this port is what lets
 * a test assert the exact code a host would print instead of matching a pattern.
 */
export class SequentialIdGenerator implements IdGenerator {
  private events = 0
  private photos = 0
  private guests = 0
  private users = 0
  private reactions = 0

  /**
   * How far the byte sequence has run. It advances across calls so two events created
   * in one test do not derive the same join code — which the repositories reject as a
   * uniqueness violation, exactly as the unique index would.
   */
  private byteOffset = 0

  eventId(): EventId {
    this.events += 1
    return asEventId(`event-${this.events}`)
  }

  photoId(): PhotoId {
    this.photos += 1
    return asPhotoId(`photo-${this.photos}`)
  }

  guestId(): GuestId {
    this.guests += 1
    return asGuestId(`guest-${this.guests}`)
  }

  userId(): UserId {
    this.users += 1
    return asUserId(`user-${this.users}`)
  }

  reactionId(): ReactionId {
    this.reactions += 1
    return asReactionId(`reaction-${this.reactions}`)
  }

  /**
   * `0, 1, 2, …` continuing where the previous call stopped, wrapped at a byte.
   *
   * `JoinCode.fromBytes` maps `byte % 32` onto its alphabet, so the first six bytes
   * spell `012345`, the next six `6789AB`, and so on: an exact, printable expectation.
   */
  bytes(count: number): Uint8Array {
    if (!Number.isInteger(count) || count < 1) {
      // Mirrors the real generator: asking for no entropy is a bug worth crashing on,
      // since it would silently produce a constant join code for every event.
      throw new Error(`SequentialIdGenerator.bytes requires a positive integer, got ${count}`)
    }
    const out = new Uint8Array(count)
    for (let index = 0; index < count; index += 1) {
      out[index] = (this.byteOffset + index) % 256
    }
    this.byteOffset += count
    return out
  }

  /** Back to `event-1`. Lets one test build two worlds without a second instance. */
  reset(): this {
    this.events = 0
    this.photos = 0
    this.guests = 0
    this.users = 0
    this.reactions = 0
    this.byteOffset = 0
    return this
  }
}
