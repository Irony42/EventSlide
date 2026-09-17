import { describe, expect, it } from 'vitest'
import { asEventId } from '../../domain/shared/ids'
import { ContentHash } from '../../domain/photos/contentHash'
import { CallLog } from './callLog'
import { InMemoryMediaStore } from './inMemoryMediaStore'

/**
 * The recorder is itself a test double, so it gets the same treatment the others do: a
 * double that lies is worse than no double, and this one's whole job is a claim about
 * what happened and in what order.
 */

const EVENT = asEventId('event-1')

const hashOf = (seed: string): ContentHash => {
  const result = ContentHash.create(seed.padEnd(64, '0').slice(0, 64))
  if (!result.ok) throw new Error(`bad fixture hash: ${seed}`)
  return result.value
}

describe('CallLog', () => {
  it('records the calls made through it, in the order they were made', async () => {
    const calls = new CallLog()
    const media = calls.watch('media', new InMemoryMediaStore())

    await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))
    await media.delete(EVENT, hashOf('ab1'))

    expect(calls.names).toEqual(['media.put', 'media.delete'])
  })

  it('passes the call through to the real double rather than standing in for it', async () => {
    // The reason this is a wrapper and not a stub: the use case under test must reach the
    // same in-memory implementation every other ring-2 test reaches.
    const calls = new CallLog()
    const media = calls.watch('media', new InMemoryMediaStore())

    await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1, 2))

    expect(await media.read(EVENT, hashOf('ab1'), 'display')).toEqual(Uint8Array.of(1, 2))
  })

  it('keeps two watched doubles apart, so an ordering rule can span them', async () => {
    const calls = new CallLog()
    const first = calls.watch('first', new InMemoryMediaStore())
    const second = calls.watch('second', new InMemoryMediaStore())

    await first.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))
    await second.delete(EVENT, hashOf('ab1'))

    expect(calls.names).toEqual(['first.put', 'second.delete'])
  })

  it('answers with only the named calls, in the order they happened', async () => {
    const calls = new CallLog()
    const media = calls.watch('media', new InMemoryMediaStore())

    await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))
    await media.exists(EVENT, hashOf('ab1'), 'display')
    await media.delete(EVENT, hashOf('ab1'))

    expect(calls.sequenceOf('media.delete', 'media.put')).toEqual(['media.put', 'media.delete'])
  })

  it('records nothing for a property a test merely read', async () => {
    // `clips.all` and `objectCount` are how a test looks at a double. Counting them would
    // put the observer in the sequence it is observing.
    const calls = new CallLog()
    const media = calls.watch('media', new InMemoryMediaStore())
    await media.put(EVENT, hashOf('ab1'), 'display', Uint8Array.of(1))

    expect(media.objectCount).toBe(1)
    expect(calls.names).toEqual(['media.put'])
  })
})
