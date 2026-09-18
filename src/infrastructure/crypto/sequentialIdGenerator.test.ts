import { describe, expect, it } from 'vitest'
import { JoinCode } from '../../domain/shared/joinCode'
import { createSequentialIdGenerator } from './sequentialIdGenerator'

/**
 * The generator that makes a visual baseline reproducible.
 *
 * Held to the properties the end-to-end suite actually depends on: the same run twice
 * gives the same ids, ids stay UUID-shaped so the routes validate them exactly as they
 * validate a real one, and two events in one run still get different join codes.
 */

describe('createSequentialIdGenerator', () => {
  it('gives the same ids to two generators started fresh', () => {
    // The property the whole thing exists for. A snapshot of the polaroid wall tilts
    // each print by a hash of its photo id, so a fresh id per run meant a fresh angle
    // per run and a comparison that failed on tens of thousands of pixels of nothing.
    const first = createSequentialIdGenerator()
    const second = createSequentialIdGenerator()

    expect([first.photoId(), first.photoId(), first.eventId()]).toEqual([
      second.photoId(),
      second.photoId(),
      second.eventId(),
    ])
  })

  it('never repeats an id within a run', () => {
    const ids = createSequentialIdGenerator()

    const seen = new Set([ids.photoId(), ids.photoId(), ids.photoId()])

    expect(seen.size).toBe(3)
  })

  it('counts each kind separately, so a photo and a guest never collide', () => {
    const ids = createSequentialIdGenerator()

    expect(String(ids.photoId())).not.toBe(String(ids.guestId()))
  })

  it('keeps the canonical UUID shape the routes validate', () => {
    // The HTTP layer parses ids with zod `.uuid()`, which turns a malformed id into a
    // 400 before it reaches a query. A test generator that produced something else
    // would exercise a different path from production.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

    const ids = createSequentialIdGenerator()

    for (const id of [
      ids.eventId(),
      ids.photoId(),
      ids.guestId(),
      ids.userId(),
      ids.reactionId(),
    ]) {
      expect(String(id)).toMatch(uuid)
    }
  })

  it('gives two events different join-code entropy', () => {
    // Several specs seed more than one event in a run, and the join code is unique in
    // the schema — a constant here would fail the second insert rather than the test.
    const ids = createSequentialIdGenerator()

    expect([...ids.bytes(8)]).not.toEqual([...ids.bytes(8)])
  })

  it('gives a different join code to every event a worker seeds, not just to two in a row', () => {
    /**
     * The rule this generator's own comment states — "two join codes in one run still
     * differ" — checked at the level it is about, which is the code rather than the bytes.
     *
     * The assertion above it compares one call to the next and passed for a generator
     * whose seventeenth code was its first one again. A walking byte sequence aliases
     * against the alphabet: six consecutive integers, thirty-two characters, and a step of
     * six means the cursor returns to the same residues after ninety-six bytes. So the
     * seventeenth event created on an end-to-end worker drew a code the first event already
     * held, the four retries after it drew events two to five, and `createEvent` gave up
     * with `event.joinCodeExhausted` — a 500 out of the seed endpoint, on a suite where a
     * worker routinely seeds more than sixteen events.
     *
     * A hundred rather than seventeen, because the next aliasing period would be just as
     * invisible to a test that stopped at the first one.
     */
    const ids = createSequentialIdGenerator()

    const codes = Array.from({ length: 100 }, () => {
      const code = JoinCode.fromBytes(ids.bytes(JoinCode.entropyBytes))
      if (!code.ok) throw new Error(`the generator produced bytes no join code accepts`)
      return code.value.value
    })

    expect(new Set(codes).size).toBe(codes.length)
  })

  it('refuses to hand out zero bytes of entropy', () => {
    // Same refusal as the real generator: it would silently produce a constant join
    // code, which is a bug rather than a state to model.
    const ids = createSequentialIdGenerator()

    expect(() => ids.bytes(0)).toThrow()
    expect(() => ids.bytes(1.5)).toThrow()
  })
})
