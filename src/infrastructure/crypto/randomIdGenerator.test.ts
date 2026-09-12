import { describe, expect, it } from 'vitest'
import { randomIdGenerator } from './randomIdGenerator'
import type { IdGenerator } from '../../application/ports/idGenerator'
import { JoinCode } from '../../domain/shared/joinCode'

/**
 * Ring 3, against the real `node:crypto`. This adapter is one of the two places in the
 * server allowed to be non-deterministic, so the properties worth pinning are the ones
 * a caller depends on: ids are unguessable and unique because they appear in URLs, and
 * `bytes` refuses a request that would silently produce a constant join code.
 */

/** UUIDv4 in canonical form — the shape the routes' `z.string().uuid()` accepts. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const MINTERS: ReadonlyArray<[string, (ids: IdGenerator) => string]> = [
  ['eventId', (ids) => ids.eventId()],
  ['photoId', (ids) => ids.photoId()],
  ['guestId', (ids) => ids.guestId()],
  ['userId', (ids) => ids.userId()],
  ['reactionId', (ids) => ids.reactionId()],
]

describe('randomIdGenerator', () => {
  it.each(MINTERS)(
    'mints a %s in the canonical UUIDv4 form the routes validate, so a malformed id is a 400 before it reaches a query',
    (_name, mint) => {
      expect(mint(randomIdGenerator)).toMatch(UUID_V4)
    },
  )

  it.each(MINTERS)(
    'never repeats a %s across a thousand calls, so an id in a URL is not a guess away from the next one',
    (_name, mint) => {
      const minted = new Set(Array.from({ length: 1_000 }, () => mint(randomIdGenerator)))

      expect(minted.size).toBe(1_000)
    },
  )

  it('mints ids that collide across no two kinds, so a photo id can never be read as an event id', () => {
    const minted = MINTERS.map(([, mint]) => mint(randomIdGenerator))

    expect(new Set(minted).size).toBe(MINTERS.length)
  })

  describe('bytes', () => {
    it('returns exactly the number of bytes asked for, because a join code is derived from a fixed width', () => {
      expect(randomIdGenerator.bytes(16)).toHaveLength(16)
    })

    it('returns entropy the domain join-code function accepts at the width it asks for', () => {
      // The only caller (createEvent / rotateJoinCode) hands this straight to
      // JoinCode.fromBytes, which refuses anything but exactly `entropyBytes`. This is
      // the seam where the adapter and the pure derivation have to agree; asserting
      // `instanceof Uint8Array` instead would pass for a Buffer, an Int8Array, or any
      // other view, and prove nothing a caller can observe.
      const result = JoinCode.fromBytes(randomIdGenerator.bytes(JoinCode.entropyBytes))

      expect(result.ok).toBe(true)
    })

    it('returns different bytes on every call, so two events cannot be issued the same join code', () => {
      const drawn = new Set(
        Array.from({ length: 200 }, () => Buffer.from(randomIdGenerator.bytes(16)).toString('hex')),
      )

      expect(drawn.size).toBe(200)
    })

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'throws on a request for %s bytes rather than returning a constant join code',
      (count) => {
        expect(() => randomIdGenerator.bytes(count)).toThrow(/requires a positive integer/)
      },
    )
  })
})
