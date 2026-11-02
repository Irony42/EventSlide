import { describe, expect, it } from 'vitest'
import type { BookFileStore } from '../../ports/bookFileStore'
import { asEventId } from '../../../domain/shared/ids'

const A = asEventId('evt-a')
const B = asEventId('evt-b')

const stream = async function* (...parts: string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield new TextEncoder().encode(part)
}

const collect = async (bytes: AsyncIterable<Uint8Array> | null): Promise<string | null> => {
  if (bytes === null) return null
  const parts: string[] = []
  for await (const chunk of bytes) parts.push(new TextDecoder().decode(chunk))
  return parts.join('')
}

export interface BookFileStoreSubject {
  readonly store: BookFileStore
  readonly dispose?: () => Promise<void>
}

export const bookFileStoreContract = (
  name: string,
  makeSubject: () => Promise<BookFileStoreSubject>,
): void => {
  describe(`BookFileStore contract: ${name}`, () => {
    const withStore = async (run: (store: BookFileStore) => Promise<void>): Promise<void> => {
      const subject = await makeSubject()
      try {
        await run(subject.store)
      } finally {
        await subject.dispose?.()
      }
    }

    it('writes a stream and reads it back, answering the size', () =>
      withStore(async (store) => {
        const size = await store.write(A, stream('%PDF-', 'body'), { maxBytes: 100 })

        expect(size).toBe(9)
        expect(await store.stat(A)).toEqual({ size: 9 })
        expect(await collect(await store.openRead(A))).toBe('%PDF-body')
      }))

    it('reads a range, both ends included', () =>
      withStore(async (store) => {
        await store.write(A, stream('0123456789'), { maxBytes: 100 })

        expect(await collect(await store.openRead(A, { start: 2, end: 4 }))).toBe('234')
      }))

    it('finds nothing for an event with no book', () =>
      withStore(async (store) => {
        expect(await store.stat(A)).toBeNull()
        expect(await store.openRead(A)).toBeNull()
        expect(await store.list()).toEqual([])
      }))

    it('replaces an older book in one step', () =>
      withStore(async (store) => {
        await store.write(A, stream('old'), { maxBytes: 100 })
        await store.write(A, stream('newer'), { maxBytes: 100 })

        expect(await collect(await store.openRead(A))).toBe('newer')
      }))

    it('refuses a book past the ceiling with book.tooLarge and leaves the older one alone', () =>
      withStore(async (store) => {
        await store.write(A, stream('keep'), { maxBytes: 100 })

        await expect(
          store.write(A, stream('12345', '67890'), { maxBytes: 8 }),
        ).rejects.toMatchObject({ code: 'book.tooLarge' })

        expect(await collect(await store.openRead(A))).toBe('keep')
      }))

    it('accepts a book of exactly the ceiling', () =>
      withStore(async (store) => {
        expect(await store.write(A, stream('12345678'), { maxBytes: 8 })).toBe(8)
      }))

    it('leaves nothing behind when the stream fails part-way', () =>
      withStore(async (store) => {
        const failing = (async function* () {
          yield new TextEncoder().encode('half')
          throw new Error('boom')
        })()

        await expect(store.write(A, failing, { maxBytes: 100 })).rejects.toThrow('boom')

        expect(await store.stat(A)).toBeNull()
        expect(await store.list()).toEqual([])
      }))

    it('keeps one event’s book apart from another’s, and lists them', () =>
      withStore(async (store) => {
        await store.write(A, stream('a'), { maxBytes: 100 })
        await store.write(B, stream('b'), { maxBytes: 100 })

        expect(await collect(await store.openRead(B))).toBe('b')
        expect([...(await store.list())].sort()).toEqual([A, B])
      }))

    it('deletes one event’s book only, and deleting nothing is fine', () =>
      withStore(async (store) => {
        await store.write(A, stream('a'), { maxBytes: 100 })
        await store.write(B, stream('b'), { maxBytes: 100 })

        await store.delete(A)
        await store.delete(A)

        expect(await store.stat(A)).toBeNull()
        expect(await store.stat(B)).toEqual({ size: 1 })
      }))
  })
}
