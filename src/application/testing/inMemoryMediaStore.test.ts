import { beforeEach, describe, expect, it } from 'vitest'
import { ContentHash } from '../../domain/photos/contentHash'
import { asEventId } from '../../domain/shared/ids'
import { mediaStoreContract } from './contracts/mediaStoreContract'
import { FakeClock } from './fakeClock'
import { InMemoryMediaStore } from './inMemoryMediaStore'

mediaStoreContract('in-memory', async () => ({ store: new InMemoryMediaStore() }))

const WEDDING = asEventId('evt-wedding')

const hashOf = (seed: string): ContentHash => {
  const result = ContentHash.create(seed.padEnd(64, '0').slice(0, 64))
  if (!result.ok) throw new Error(`bad fixture hash: ${seed}`)
  return result.value
}

describe('InMemoryMediaStore', () => {
  let media: InMemoryMediaStore

  beforeEach(() => {
    media = new InMemoryMediaStore()
  })

  it('can be told to run out of disk part-way through a request', async () => {
    media.failWritesAfter(1)

    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(1))

    await expect(media.put(WEDDING, hashOf('bb'), 'poster', Uint8Array.of(1))).rejects.toThrow()
  })

  it('stamps an object with the injected clock, and with the epoch when it has none', async () => {
    // The sweep refuses to collect anything written recently; an unwired store reads as old
    // enough to collect, which is the answer that makes a sweep test say something.
    const clock = new FakeClock()
    const timed = new InMemoryMediaStore(clock)
    await timed.put(WEDDING, hashOf('aa'), 'display', Uint8Array.of(1))
    await media.put(WEDDING, hashOf('aa'), 'display', Uint8Array.of(1))

    expect((await timed.stat(WEDDING, hashOf('aa'), 'display'))?.modifiedAt).toEqual(clock.now())
    expect((await media.stat(WEDDING, hashOf('aa'), 'display'))?.modifiedAt).toEqual(new Date(0))
  })

  it('moves an object’s write time forward when it is rewritten', async () => {
    // The sweep re-asks `stat` before it unlinks, so a clip re-uploaded after the listing must
    // read as fresh. The contract cannot move a clock it does not own; this one can.
    const clock = new FakeClock()
    const timed = new InMemoryMediaStore(clock)
    await timed.put(WEDDING, hashOf('aa'), 'source', Uint8Array.of(1))
    const first = (await timed.stat(WEDDING, hashOf('aa'), 'source'))?.modifiedAt

    clock.advance(60_000)
    await timed.put(WEDDING, hashOf('aa'), 'source', Uint8Array.of(2))

    expect((await timed.stat(WEDDING, hashOf('aa'), 'source'))?.modifiedAt.getTime()).toBe(
      (first?.getTime() ?? Number.NaN) + 60_000,
    )
  })

  it('lists the renditions it holds for one digest', async () => {
    await media.put(WEDDING, hashOf('aa'), 'poster', Uint8Array.of(1))
    await media.put(WEDDING, hashOf('aa'), 'video', Uint8Array.of(1))

    expect(media.variantsOf(WEDDING, hashOf('aa'))).toEqual(['video', 'poster'])
  })
})
