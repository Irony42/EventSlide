import { beforeEach, describe, expect, it } from 'vitest'
import { ContentHash } from '../../domain/photos/contentHash'
import { asEventId } from '../../domain/shared/ids'
import { InMemoryMediaStore } from './inMemoryMediaStore'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const hashOf = (seed: string): ContentHash => {
  const result = ContentHash.create(seed.padEnd(64, '0').slice(0, 64))
  if (!result.ok) throw new Error(`bad fixture hash: ${seed}`)
  return result.value
}

const drain = async (chunks: AsyncIterable<Uint8Array> | null): Promise<number[]> => {
  if (chunks === null) throw new Error('expected a readable object')
  const out: number[] = []
  for await (const chunk of chunks) out.push(...chunk)
  return out
}

describe('InMemoryMediaStore', () => {
  let media: InMemoryMediaStore

  beforeEach(() => {
    media = new InMemoryMediaStore()
  })

  it('keys bytes by event, so another event genuinely misses', async () => {
    await media.put(WEDDING, hashOf('aa'), 'display', Uint8Array.of(1, 2, 3))

    expect(await media.read(GALA, hashOf('aa'), 'display')).toBeNull()
  })

  it('reports the bytes one event occupies, which the quota rules are decided from', async () => {
    await media.put(WEDDING, hashOf('aa'), 'display', Uint8Array.of(1, 2, 3))
    await media.put(GALA, hashOf('bb'), 'display', Uint8Array.of(1))

    expect(await media.usedBytes(WEDDING)).toBe(3)
  })

  it('removes every rendition under a digest, including a staged source', async () => {
    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(1))
    await media.put(WEDDING, hashOf('aa'), 'source', Uint8Array.of(2))

    await media.delete(WEDDING, hashOf('aa'))

    expect(media.objectCount).toBe(0)
  })

  it('serves a byte range inclusively at both ends, as Range means it', async () => {
    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(0, 1, 2, 3, 4))

    expect(
      await drain(await media.openRead(WEDDING, hashOf('aa'), 'video', { start: 1, end: 3 })),
    ).toEqual([1, 2, 3])
  })

  it('answers nothing for a range the object cannot satisfy', async () => {
    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(0, 1))

    expect(await media.openRead(WEDDING, hashOf('aa'), 'video', { start: 9, end: 12 })).toBeNull()
  })

  it('declares a clip as video and everything else as an image', async () => {
    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(1))
    await media.put(WEDDING, hashOf('aa'), 'poster', Uint8Array.of(1))

    expect((await media.stat(WEDDING, hashOf('aa'), 'video'))?.contentType).toBe('video/mp4')
    expect((await media.stat(WEDDING, hashOf('aa'), 'poster'))?.contentType).toBe('image/jpeg')
  })

  it('can be told to run out of disk part-way through a request', async () => {
    media.failWritesAfter(1)

    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(1))

    await expect(media.put(WEDDING, hashOf('bb'), 'poster', Uint8Array.of(1))).rejects.toThrow()
  })

  it('lists the renditions it holds for one digest', async () => {
    await media.put(WEDDING, hashOf('aa'), 'poster', Uint8Array.of(1))
    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(1))

    expect(media.variantsOf(WEDDING, hashOf('aa'))).toEqual(['video', 'poster'])
  })

  it('drops an event’s whole album in one call', async () => {
    await media.put(WEDDING, hashOf('aa'), 'display', Uint8Array.of(1))
    await media.put(GALA, hashOf('bb'), 'display', Uint8Array.of(1))

    await media.deleteEvent(WEDDING)

    expect(await media.exists(WEDDING, hashOf('aa'), 'display')).toBe(false)
    expect(await media.exists(GALA, hashOf('bb'), 'display')).toBe(true)
  })

  it('reads a whole object when no range is asked for', async () => {
    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(7, 8))

    expect(await drain(await media.openRead(WEDDING, hashOf('aa'), 'video'))).toEqual([7, 8])
    expect(await media.openRead(WEDDING, hashOf('cc'), 'video')).toBeNull()
  })
})
