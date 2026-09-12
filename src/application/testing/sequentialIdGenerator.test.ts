import { describe, expect, it } from 'vitest'
import { JoinCode } from '../../domain/shared/joinCode'
import { SequentialIdGenerator } from './sequentialIdGenerator'

describe('SequentialIdGenerator', () => {
  it('numbers each kind of id from one', async () => {
    const ids = new SequentialIdGenerator()

    expect([ids.eventId(), ids.photoId(), ids.guestId(), ids.userId(), ids.reactionId()]).toEqual([
      'event-1',
      'photo-1',
      'guest-1',
      'user-1',
      'reaction-1',
    ])
  })

  it('counts each kind separately, so an assertion says which one it means', async () => {
    const ids = new SequentialIdGenerator()
    ids.photoId()
    ids.photoId()

    expect([ids.photoId(), ids.eventId()]).toEqual(['photo-3', 'event-1'])
  })

  it('derives an exact join code from its first bytes', async () => {
    const code = JoinCode.fromBytes(new SequentialIdGenerator().bytes(JoinCode.entropyBytes))

    expect(code.ok && code.value.value).toBe('012345')
  })

  it('derives a different join code for the next event', async () => {
    const ids = new SequentialIdGenerator()
    ids.bytes(JoinCode.entropyBytes)

    const code = JoinCode.fromBytes(ids.bytes(JoinCode.entropyBytes))

    expect(code.ok && code.value.value).toBe('6789AB')
  })

  it('produces the same sequence in a fresh generator, so a test is repeatable', async () => {
    expect([...new SequentialIdGenerator().bytes(6)]).toEqual([
      ...new SequentialIdGenerator().bytes(6),
    ])
  })

  it('returns exactly the requested number of bytes', async () => {
    expect(new SequentialIdGenerator().bytes(32)).toHaveLength(32)
  })

  it('stays inside a byte when the sequence runs long', async () => {
    const bytes = new SequentialIdGenerator().bytes(300)

    expect(Math.max(...bytes)).toBeLessThanOrEqual(255)
  })

  it.each([0, -1, 1.5])('refuses a request for %s bytes of entropy', async (count) => {
    // Mirrors the real generator: no entropy would mean one constant join code for
    // every event on the box.
    expect(() => new SequentialIdGenerator().bytes(count)).toThrow()
  })

  it('starts over on reset', async () => {
    const ids = new SequentialIdGenerator()
    ids.eventId()
    ids.bytes(6)

    ids.reset()

    expect([ids.eventId(), [...ids.bytes(2)]]).toEqual(['event-1', [0, 1]])
  })

  it('returns itself from reset, so a beforeEach reads in one line', async () => {
    const ids = new SequentialIdGenerator()

    expect(ids.reset()).toBe(ids)
  })
})
