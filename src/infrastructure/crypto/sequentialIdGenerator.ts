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
 * The same ids on every run, for the end-to-end suite alone.
 *
 * Wired only when `E2E_HOOKS=1`, which the config module refuses to accept in
 * production — the same gate the wall's timing hooks use. Nothing here is unguessable
 * and it must never reach a real deployment.
 *
 * It exists because a visual baseline cannot be stable while the pixels depend on a
 * random id. The polaroid wall tilts each print by a hash of its photo id, so that two
 * projectors showing the same photo tilt it the same way — correct in production, and
 * fatal to a snapshot, because every seeded run produced fresh ids and therefore fresh
 * angles. The three prints landed differently on every render and the comparison failed
 * on 47 000 pixels of nothing. The same applies to the join code printed on the wall: it
 * is derived from `bytes`, so it was six random characters in the corner of every
 * full-page baseline, spending thousands of pixels of the diff tolerance before a real
 * regression could use any.
 *
 * Ids keep the canonical UUID shape, because the HTTP layer validates them with zod
 * `.uuid()` and a test that fed the routes something else would be exercising a
 * different path from production.
 */

/** One counter per kind, so a photo and a guest do not share a sequence. */
type Kind = 'event' | 'photo' | 'guest' | 'user' | 'reaction' | 'clipJob'

const PREFIX: Record<Kind, string> = {
  event: 'e0000000',
  photo: 'f0000000',
  guest: '10000000',
  user: '20000000',
  reaction: '30000000',
  clipJob: '40000000',
}

export const createSequentialIdGenerator = (): IdGenerator => {
  const counters = new Map<Kind, number>()
  let byteCursor = 0

  /**
   * A valid v4-shaped UUID whose last field counts.
   *
   * The version and variant nibbles are kept so the value passes the same `.uuid()`
   * checks a real one does; everything distinguishing is in the final field.
   */
  const next = (kind: Kind): string => {
    const n = (counters.get(kind) ?? 0) + 1
    counters.set(kind, n)
    return `${PREFIX[kind]}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
  }

  return {
    eventId: (): EventId => asEventId(next('event')),
    photoId: (): PhotoId => asPhotoId(next('photo')),
    guestId: (): GuestId => asGuestId(next('guest')),
    userId: (): UserId => asUserId(next('user')),
    reactionId: (): ReactionId => asReactionId(next('reaction')),
    clipJobId: (): ClipJobId => asClipJobId(next('clipJob')),

    bytes: (count: number): Uint8Array => {
      if (!Number.isInteger(count) || count < 1) {
        // Same refusal as the real generator: zero bytes of entropy would silently
        // produce a constant join code, which is a bug rather than a state to model.
        throw new Error(`sequentialIdGenerator.bytes requires a positive integer, got ${count}`)
      }
      // A walking sequence rather than a constant, so two join codes in one run still
      // differ — several specs seed more than one event and would otherwise collide on
      // the unique join-code column.
      const out = new Uint8Array(count)
      for (let index = 0; index < count; index += 1) {
        byteCursor = (byteCursor + 1) % 251
        out[index] = byteCursor
      }
      return out
    },
  }
}
