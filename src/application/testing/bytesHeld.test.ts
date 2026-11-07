import { describe, expect, it } from 'vitest'
import { bytesHeld } from './bytesHeld'
import { InMemoryMediaStore } from './inMemoryMediaStore'
import { ContentHash } from '../../domain/photos/contentHash'
import { asEventId } from '../../domain/shared/ids'

const WEDDING = asEventId('wedding')
const GALA = asEventId('gala')
const hashOf = (digit: string): ContentHash => {
  const result = ContentHash.create(digit.repeat(64))
  if (!result.ok) throw new Error('bad fixture hash')
  return result.value
}
const HASH_A = hashOf('a')
const HASH_B = hashOf('b')

describe('bytesHeld', () => {
  it('sums every rendition of every digest of one event, and only that event', async () => {
    const store = new InMemoryMediaStore()
    await store.put(WEDDING, HASH_A, 'display', new Uint8Array(3))
    await store.put(WEDDING, HASH_A, 'thumb', new Uint8Array(4))
    await store.put(WEDDING, HASH_B, 'display', new Uint8Array(5))
    await store.put(GALA, HASH_A, 'display', new Uint8Array(100))

    expect(await bytesHeld(store, WEDDING)).toBe(12)
    expect(await bytesHeld(store, GALA)).toBe(100)
  })

  it('is zero for an event that stored nothing', async () => {
    expect(await bytesHeld(new InMemoryMediaStore(), WEDDING)).toBe(0)
  })
})
