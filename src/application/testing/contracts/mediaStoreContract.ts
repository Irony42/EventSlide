import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_MEDIA_VARIANTS } from '../../ports/mediaStore'
import type { MediaStore, MediaVariant } from '../../ports/mediaStore'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asEventId } from '../../../domain/shared/ids'

/**
 * The shared `MediaStore` contract, run against the filesystem adapter on a temporary
 * directory and against `InMemoryMediaStore`.
 *
 * It exists because the double had already drifted from the adapter while two hand-written
 * test files each described "their" store: the double labelled a staged source `image/jpeg`
 * where the adapter says `application/octet-stream`, kept the caller's buffer by reference
 * where the adapter writes a copy to disk, and forgot an event the moment its last object
 * was deleted where the adapter's directory stays. Every use case test that reads a store
 * through the double is a statement about the adapter only while this suite is green on both.
 *
 * Where the two disagreed, the adapter's behaviour is the contract: it is what production
 * does, and the double is there to stand in for it.
 *
 * What stays in `fsMediaStore.test.ts` because it cannot be said of any store: the layout
 * on disk, an unsafe event id or digest refused before a path is built, the `.tmp` of an
 * interrupted `put` (left alone while young, reaped by `list` once abandoned, never listed),
 * a file the store could not have written, and what a failing filesystem does. What stays
 * in `inMemoryMediaStore.test.ts`: the scripted conditions (`failWritesAfter`, `failDeletes`,
 * `vanishAfterStat`), the `opened` count and the `forbidEnumeration` tripwire.
 */

export interface MediaStoreSubject {
  readonly store: MediaStore
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const hashOf = (seed: string): ContentHash => {
  const result = ContentHash.create(seed.repeat(64).slice(0, 64))
  if (!result.ok) throw new Error(`bad contract fixture hash: ${seed}`)
  return result.value
}

const HASH_A = hashOf('a1')
const HASH_B = hashOf('b2')

/** What the adapter declares for each rendition: a still is a JPEG, a clip an mp4, a staged source "some bytes". */
const CONTENT_TYPES: readonly (readonly [MediaVariant, string])[] = [
  ['original', 'image/jpeg'],
  ['display', 'image/jpeg'],
  ['thumb', 'image/jpeg'],
  ['video', 'video/mp4'],
  ['poster', 'image/jpeg'],
  ['source', 'application/octet-stream'],
]

const collect = async (chunks: AsyncIterable<Uint8Array> | null): Promise<number[]> => {
  if (chunks === null) throw new Error('expected a readable object, got null')
  const out: number[] = []
  for await (const chunk of chunks) for (const byte of chunk) out.push(byte)
  return out
}

/** `count` bytes counting up and wrapping, so a slice that starts at the wrong offset shows. */
const counting = (count: number): Uint8Array =>
  Uint8Array.from({ length: count }, (_, i) => i % 251)

export const mediaStoreContract = (
  name: string,
  makeSubject: () => Promise<MediaStoreSubject>,
): void => {
  describe(`MediaStore contract: ${name}`, () => {
    let subject: MediaStoreSubject
    let store: MediaStore

    beforeEach(async () => {
      subject = await makeSubject()
      store = subject.store
      return async () => {
        await subject.dispose?.()
      }
    })

    describe('keeping and reading bytes', () => {
      it.each(ALL_MEDIA_VARIANTS)(
        'round-trips the bytes of a %s through put and read',
        async (variant) => {
          await store.put(WEDDING, HASH_A, variant, Uint8Array.of(1, 2, 3))

          expect(await store.exists(WEDDING, HASH_A, variant)).toBe(true)
          expect([...((await store.read(WEDDING, HASH_A, variant)) ?? [])]).toEqual([1, 2, 3])
        },
      )

      it('reports an object that was never stored as absent, without throwing', async () => {
        expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(false)
        expect(await store.read(WEDDING, HASH_A, 'display')).toBeNull()
        expect(await store.stat(WEDDING, HASH_A, 'display')).toBeNull()
        expect(await store.openRead(WEDDING, HASH_A, 'display')).toBeNull()
      })

      it('keeps two events apart, even for identical bytes under the same digest', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))

        expect(await store.exists(GALA, HASH_A, 'display')).toBe(false)
        expect(await store.read(GALA, HASH_A, 'display')).toBeNull()
      })

      it('keeps the renditions of one digest apart', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.put(WEDDING, HASH_A, 'thumb', Uint8Array.of(2))

        expect([...((await store.read(WEDDING, HASH_A, 'display')) ?? [])]).toEqual([1])
        expect([...((await store.read(WEDDING, HASH_A, 'thumb')) ?? [])]).toEqual([2])
        expect(await store.exists(WEDDING, HASH_A, 'original')).toBe(false)
      })

      it('replaces what an address holds when it is written again, and counts it once', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1, 1, 1, 1))
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(9, 9))

        expect([...((await store.read(WEDDING, HASH_A, 'display')) ?? [])]).toEqual([9, 9])
        expect(await store.usedBytes(WEDDING)).toBe(2)
      })

      it('writes a copy of what it is given, so the caller reusing its buffer changes nothing', async () => {
        // The adapter puts the bytes on disk, so a buffer the caller recycles afterwards (the
        // upload pipeline does) cannot reach them. A double that keeps the reference would
        // let a use case test pass on a mutation production never sees.
        const bytes = Uint8Array.of(1, 2, 3)
        await store.put(WEDDING, HASH_A, 'display', bytes)

        bytes.fill(0)

        expect([...((await store.read(WEDDING, HASH_A, 'display')) ?? [])]).toEqual([1, 2, 3])
      })

      it('hands out a copy, so a caller changing what it read changes nothing', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1, 2, 3))

        const first = await store.read(WEDDING, HASH_A, 'display')
        first?.fill(0)

        expect([...((await store.read(WEDDING, HASH_A, 'display')) ?? [])]).toEqual([1, 2, 3])
      })

      it('keeps an empty object, which exists and has no bytes and no satisfiable range', async () => {
        await store.put(WEDDING, HASH_A, 'display', new Uint8Array(0))

        expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(true)
        expect((await store.stat(WEDDING, HASH_A, 'display'))?.byteSize).toBe(0)
        expect(await store.read(WEDDING, HASH_A, 'display')).toHaveLength(0)
        expect(await collect(await store.openRead(WEDDING, HASH_A, 'display'))).toEqual([])
        expect(await store.openRead(WEDDING, HASH_A, 'display', { start: 0, end: 0 })).toBeNull()
      })
    })

    describe('describing an object', () => {
      it.each(CONTENT_TYPES)('declares a %s as %s', async (variant, contentType) => {
        await store.put(WEDDING, HASH_A, variant, Uint8Array.of(1))

        expect((await store.stat(WEDDING, HASH_A, variant))?.contentType).toBe(contentType)
      })

      it('reports the size in bytes', async () => {
        await store.put(WEDDING, HASH_A, 'video', counting(1234))

        expect((await store.stat(WEDDING, HASH_A, 'video'))?.byteSize).toBe(1234)
      })

      it('never reports a write time earlier after a rewrite', async () => {
        // The reconciliation sweep re-asks `stat` right before it unlinks: a guest who
        // re-uploads an abandoned clip rewrites the same content-addressed path, and the
        // sweep must see the fresh time. A store with no clock of its own cannot show it move,
        // so the double's own test does, with one; this holds the direction for the adapter.
        await store.put(WEDDING, HASH_A, 'source', Uint8Array.of(1))
        const first = (await store.stat(WEDDING, HASH_A, 'source'))?.modifiedAt

        await store.put(WEDDING, HASH_A, 'source', Uint8Array.of(2))
        const second = (await store.stat(WEDDING, HASH_A, 'source'))?.modifiedAt

        expect(first).toBeInstanceOf(Date)
        expect(second).toBeInstanceOf(Date)
        expect(second?.getTime()).toBeGreaterThanOrEqual(first?.getTime() ?? Number.NaN)
      })
    })

    describe('streaming an object', () => {
      // Larger than one chunk of the adapter's read stream (64 KiB), so a range that starts in
      // the first chunk and ends past it shows an offset that restarts per chunk.
      const BIG = counting(200_000)

      it('streams the whole object, in order, when no range is asked for', async () => {
        await store.put(WEDDING, HASH_A, 'video', BIG)

        expect(await collect(await store.openRead(WEDDING, HASH_A, 'video'))).toEqual([...BIG])
      })

      it('streams a copy, so a caller changing a chunk it was handed changes nothing', async () => {
        await store.put(WEDDING, HASH_A, 'video', Uint8Array.of(0, 1, 2, 3, 4))

        for await (const chunk of (await store.openRead(WEDDING, HASH_A, 'video')) ?? [])
          chunk.fill(9)
        for await (const chunk of (await store.openRead(WEDDING, HASH_A, 'video', {
          start: 1,
          end: 2,
        })) ?? [])
          chunk.fill(9)

        expect([...((await store.read(WEDDING, HASH_A, 'video')) ?? [])]).toEqual([0, 1, 2, 3, 4])
      })

      it('serves a range inclusively at both ends, as Range means it', async () => {
        await store.put(WEDDING, HASH_A, 'video', Uint8Array.of(0, 1, 2, 3, 4))

        expect(
          await collect(await store.openRead(WEDDING, HASH_A, 'video', { start: 1, end: 3 })),
        ).toEqual([1, 2, 3])
        expect(
          await collect(await store.openRead(WEDDING, HASH_A, 'video', { start: 0, end: 0 })),
        ).toEqual([0])
        expect(
          await collect(await store.openRead(WEDDING, HASH_A, 'video', { start: 4, end: 4 })),
        ).toEqual([4])
      })

      it('serves a range that crosses the chunks a large object is read in', async () => {
        await store.put(WEDDING, HASH_A, 'video', BIG)

        expect(
          await collect(
            await store.openRead(WEDDING, HASH_A, 'video', { start: 65_000, end: 140_000 }),
          ),
        ).toEqual([...BIG.slice(65_000, 140_001)])
      })

      it('cuts a range that runs past the end of the object at the end', async () => {
        await store.put(WEDDING, HASH_A, 'video', Uint8Array.of(0, 1, 2, 3, 4))

        expect(
          await collect(await store.openRead(WEDDING, HASH_A, 'video', { start: 3, end: 999 })),
        ).toEqual([3, 4])
      })

      it.each([
        ['starts at the size', { start: 5, end: 9 }],
        ['starts past the size', { start: 50, end: 90 }],
        ['ends before it starts', { start: 3, end: 2 }],
      ])('answers nothing, as for a missing object, for a range that %s', async (_label, range) => {
        // The caller has already read `stat` and turns this into a 416; an empty stream under
        // a 206 would leave a player waiting for bytes that never come.
        await store.put(WEDDING, HASH_A, 'video', Uint8Array.of(0, 1, 2, 3, 4))

        expect(await store.openRead(WEDDING, HASH_A, 'video', range)).toBeNull()
      })

      it('answers nothing for a range of an object that is not there', async () => {
        expect(await store.openRead(WEDDING, HASH_A, 'video', { start: 0, end: 1 })).toBeNull()
      })
    })

    describe('removing objects', () => {
      it('removes every rendition under a digest, including a staged source and the ones the digest never had', async () => {
        await store.put(WEDDING, HASH_A, 'video', Uint8Array.of(1))
        await store.put(WEDDING, HASH_A, 'source', Uint8Array.of(2))
        await store.put(WEDDING, HASH_A, 'poster', Uint8Array.of(3))

        await store.delete(WEDDING, HASH_A)

        for (const variant of ALL_MEDIA_VARIANTS) {
          expect(await store.exists(WEDDING, HASH_A, variant), variant).toBe(false)
        }
        expect(await store.usedBytes(WEDDING)).toBe(0)
      })

      it('leaves another digest of the same event, and the same digest of another event, alone', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.put(WEDDING, HASH_B, 'display', Uint8Array.of(2))
        await store.put(GALA, HASH_A, 'display', Uint8Array.of(3))

        await store.delete(WEDDING, HASH_A)

        expect(await store.exists(WEDDING, HASH_B, 'display')).toBe(true)
        expect(await store.exists(GALA, HASH_A, 'display')).toBe(true)
      })

      it('is idempotent: removing what was never stored, or removing twice, is not an error', async () => {
        await store.delete(WEDDING, HASH_A)
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.delete(WEDDING, HASH_A)
        await store.delete(WEDDING, HASH_A)

        expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(false)
      })

      it('drops an event’s whole album and nobody else’s', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.put(WEDDING, HASH_B, 'thumb', Uint8Array.of(2))
        await store.put(GALA, HASH_A, 'display', Uint8Array.of(3))

        await store.deleteEvent(WEDDING)

        expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(false)
        expect(await store.usedBytes(WEDDING)).toBe(0)
        expect(await store.list(WEDDING)).toEqual([])
        expect(await store.exists(GALA, HASH_A, 'display')).toBe(true)
      })

      it('purges an event that stored nothing without an error', async () => {
        await store.deleteEvent(WEDDING)
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.deleteEvent(WEDDING)
        await store.deleteEvent(WEDDING)

        expect(await store.exists(WEDDING, HASH_A, 'display')).toBe(false)
      })
    })

    describe('what an event occupies', () => {
      it('sums every rendition of every digest for one event only', async () => {
        await store.put(WEDDING, HASH_A, 'display', counting(3))
        await store.put(WEDDING, HASH_A, 'thumb', counting(4))
        await store.put(WEDDING, HASH_B, 'source', counting(5))
        await store.put(GALA, HASH_A, 'display', counting(100))

        expect(await store.usedBytes(WEDDING)).toBe(12)
        expect(await store.usedBytes(GALA)).toBe(100)
      })

      it('reports zero for an event with no media, and less after a delete', async () => {
        expect(await store.usedBytes(WEDDING)).toBe(0)

        await store.put(WEDDING, HASH_A, 'display', counting(3))
        await store.put(WEDDING, HASH_B, 'display', counting(4))
        await store.delete(WEDDING, HASH_A)

        expect(await store.usedBytes(WEDDING)).toBe(4)
      })
    })

    describe('the inventory the reconciliation sweep reads', () => {
      it('lists no event and no object for a store that has never been written to', async () => {
        expect(await store.listEvents()).toEqual([])
        expect(await store.list(WEDDING)).toEqual([])
      })

      it('names every event it holds bytes for, once each', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.put(WEDDING, HASH_B, 'thumb', Uint8Array.of(1))
        await store.put(GALA, HASH_A, 'thumb', Uint8Array.of(1))

        expect([...(await store.listEvents())].sort()).toEqual([GALA, WEDDING].sort())
      })

      it('goes on naming an event whose objects were deleted one by one, until the event itself is purged', async () => {
        // The adapter's event directory outlives its last object, and `deleteEvent` is what
        // removes it. The sweep takes the answer to `list`, which is empty, so nothing
        // depends on which way this goes — but a double that answered the other way would
        // make a sweep test describe a store production is not.
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.delete(WEDDING, HASH_A)

        expect(await store.listEvents()).toEqual([WEDDING])
        expect(await store.list(WEDDING)).toEqual([])

        await store.deleteEvent(WEDDING)

        expect(await store.listEvents()).toEqual([])
      })

      it('reports each object with its digest, rendition, size and write time', async () => {
        await store.put(WEDDING, HASH_A, 'display', counting(7))

        const [object, ...rest] = await store.list(WEDDING)

        expect(rest).toEqual([])
        expect(object?.hash.value).toBe(HASH_A.value)
        expect(object?.variant).toBe('display')
        expect(object?.byteSize).toBe(7)
        // The same fact `stat` gives, which is what lets the sweep re-ask before it unlinks.
        expect(object?.modifiedAt).toEqual(
          (await store.stat(WEDDING, HASH_A, 'display'))?.modifiedAt,
        )
      })

      it('lists every rendition of every digest, including the one nothing may serve', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.put(WEDDING, HASH_A, 'thumb', Uint8Array.of(1))
        await store.put(WEDDING, HASH_B, 'source', Uint8Array.of(1))

        const objects = await store.list(WEDDING)

        expect(
          objects.map((object) => `${object.hash.value.slice(0, 2)}:${object.variant}`).sort(),
        ).toEqual(['a1:display', 'a1:thumb', 'b2:source'])
      })

      it('never lists another event’s objects', async () => {
        await store.put(GALA, HASH_B, 'display', Uint8Array.of(1))

        expect(await store.list(WEDDING)).toEqual([])
      })

      it('stops listing an object once it is deleted', async () => {
        await store.put(WEDDING, HASH_A, 'display', Uint8Array.of(1))
        await store.put(WEDDING, HASH_B, 'display', Uint8Array.of(1))

        await store.delete(WEDDING, HASH_A)

        expect((await store.list(WEDDING)).map((object) => object.hash.value)).toEqual([
          HASH_B.value,
        ])
      })
    })
  })
}
