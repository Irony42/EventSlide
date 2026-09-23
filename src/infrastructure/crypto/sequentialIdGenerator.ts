import type { IdGenerator } from '../../application/ports/idGenerator'
import {
  asClipJobId,
  asEventId,
  asGuestId,
  asMissionId,
  asPhotoId,
  asReactionId,
  asShareLinkId,
  asUserId,
  type ClipJobId,
  type EventId,
  type GuestId,
  type MissionId,
  type PhotoId,
  type ReactionId,
  type ShareLinkId,
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
 *
 * **"The same ids on every run" is a claim about this process, and it is narrower than it
 * reads.** The counters below start at zero when the server boots, so what a given test
 * is handed depends on how many calls preceded it — and the end-to-end suite boots one
 * server per Playwright *worker*, shared by every test that worker happens to take, in an
 * order the runner decides rather than the spec. So the polaroid's tilts and the join code
 * on every full-page wall shot moved between two renders of one commit, which is precisely
 * the failure this file was written to prevent, one level up from where it was looking.
 * A baseline that photographs anything minted here therefore takes a server of its own —
 * `freshServerTest` in `tests/e2e/fixtures/app.ts` — and nothing about that belongs in
 * this adapter: it cannot know who else is calling it.
 */

/**
 * The size of the join code's alphabet, which is what `bytes` has to count in.
 *
 * Not imported from `JoinCode`: an infrastructure adapter may read the domain, but the
 * number that matters here is a property of the mapping in `fromBytes`, and a test in
 * `sequentialIdGenerator.test.ts` holds the two together by generating real codes.
 */
const JOIN_CODE_ALPHABET_SIZE = 32

/** One counter per kind, so a photo and a guest do not share a sequence. */
type Kind = 'event' | 'photo' | 'guest' | 'user' | 'reaction' | 'clipJob' | 'mission' | 'shareLink'

const PREFIX: Record<Kind, string> = {
  event: 'e0000000',
  photo: 'f0000000',
  guest: '10000000',
  user: '20000000',
  reaction: '30000000',
  clipJob: '40000000',
  mission: '50000000',
  shareLink: '60000000',
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
    missionId: (): MissionId => asMissionId(next('mission')),
    shareLinkId: (): ShareLinkId => asShareLinkId(next('shareLink')),

    bytes: (count: number): Uint8Array => {
      if (!Number.isInteger(count) || count < 1) {
        // Same refusal as the real generator: zero bytes of entropy would silently
        // produce a constant join code, which is a bug rather than a state to model.
        throw new Error(`sequentialIdGenerator.bytes requires a positive integer, got ${count}`)
      }
      /**
       * The call's own number, written in the base the join code reads its bytes in.
       *
       * **A walking sequence was here and it aliased.** `JoinCode.fromBytes` maps each
       * byte through a 32-character alphabet, so six *consecutive* integers advancing six
       * per call return to the same residues every sixteen calls: the seventeenth event
       * seeded on an end-to-end worker drew the first event's code, its four retries drew
       * events two to five, and `createEvent` gave up with `event.joinCodeExhausted` — a
       * 500 out of the seed fixture, twelve to fourteen times in every CI run, absorbed by
       * Playwright starting a fresh worker on retry and therefore never traced back.
       *
       * Each byte is a digit below 32, so the modulo in `fromBytes` is the identity and a
       * distinct call cannot produce a repeated code until the counter wraps 32^6 — a
       * billion events, against a suite that seeds tens. It also keeps what the generator
       * is for: the same run twice still produces the same codes, and the first ones are
       * readable in a trace.
       */
      byteCursor += 1
      const out = new Uint8Array(count)
      let remaining = byteCursor
      for (let index = count - 1; index >= 0; index -= 1) {
        out[index] = remaining % JOIN_CODE_ALPHABET_SIZE
        remaining = Math.floor(remaining / JOIN_CODE_ALPHABET_SIZE)
      }
      return out
    },
  }
}
