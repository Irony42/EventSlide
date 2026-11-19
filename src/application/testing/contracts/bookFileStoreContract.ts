import { describe, expect, it } from 'vitest'
import type { BookChunk, BookFileKind, BookFileStore } from '../../ports/bookFileStore'
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

const chunks = async function* (...parts: [BookFileKind, string][]): AsyncIterable<BookChunk> {
  for (const [kind, text] of parts) yield { kind, bytes: new TextEncoder().encode(text) }
}

const LIMITS = { maxBytes: { screen: 100, print: 100 } } as const

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

    // ------------------------------------------------------------ the printer version --

    it('writes the three files of one render from interleaved chunks, answering each size', () =>
      withStore(async (store) => {
        const result = await store.writeSet(
          A,
          chunks(
            ['screen', 'SC'],
            ['printInterior', 'INT'],
            ['printCover', 'CO'],
            ['screen', 'REEN'],
            ['printInterior', 'ERIOR'],
          ),
          LIMITS,
        )

        expect(result).toEqual({ screen: 6, printInterior: 8, printCover: 2, printSkipped: null })
        expect(await collect(await store.openRead(A))).toBe('SCREEN')
        expect(await collect(await store.openRead(A, undefined, 'printInterior'))).toBe('INTERIOR')
        expect(await collect(await store.openRead(A, undefined, 'printCover'))).toBe('CO')
        expect(await store.stat(A, 'printInterior')).toEqual({ size: 8 })
        expect(await store.stat(A, 'printCover')).toEqual({ size: 2 })
        expect(await store.list()).toEqual([A])
      }))

    it('reads a range of a printer file, and keeps the kinds apart', () =>
      withStore(async (store) => {
        await store.writeSet(
          A,
          chunks(['screen', 'abcdef'], ['printInterior', '0123456789'], ['printCover', 'xyz']),
          LIMITS,
        )

        expect(await collect(await store.openRead(A, { start: 2, end: 4 }, 'printInterior'))).toBe(
          '234',
        )
        expect(await collect(await store.openRead(A, { start: 2, end: 4 }))).toBe('cde')
      }))

    it('writes a screen book alone, and says there is no printer file', () =>
      withStore(async (store) => {
        const result = await store.writeSet(A, chunks(['screen', 'only']), LIMITS)

        expect(result).toEqual({
          screen: 4,
          printInterior: null,
          printCover: null,
          printSkipped: null,
        })
        expect(await store.stat(A, 'printInterior')).toBeNull()
        expect(await store.openRead(A, undefined, 'printCover')).toBeNull()
      }))

    it('removes the printer files an older book left when the new set has none', () =>
      withStore(async (store) => {
        await store.writeSet(
          A,
          chunks(['screen', 's'], ['printInterior', 'i'], ['printCover', 'c']),
          LIMITS,
        )
        await store.writeSet(A, chunks(['screen', 'new']), LIMITS)

        expect(await store.stat(A)).toEqual({ size: 3 })
        expect(await store.stat(A, 'printInterior')).toBeNull()
        expect(await store.stat(A, 'printCover')).toBeNull()
      }))

    it('abandons the printer version past its ceiling, both files together, and keeps the screen book', () =>
      withStore(async (store) => {
        const result = await store.writeSet(
          A,
          chunks(
            ['screen', 'book'],
            ['printInterior', '123456'],
            ['printCover', '12345'],
            ['screen', 'more'],
            ['printInterior', 'ignored'],
          ),
          { maxBytes: { screen: 100, print: 10 } },
        )

        expect(result).toEqual({
          screen: 8,
          printInterior: null,
          printCover: null,
          printSkipped: 'tooLarge',
        })
        expect(await collect(await store.openRead(A))).toBe('bookmore')
        expect(await store.stat(A, 'printInterior')).toBeNull()
        expect(await store.stat(A, 'printCover')).toBeNull()
      }))

    it('accepts a screen book of exactly its ceiling in a set, and refuses one byte more', () =>
      withStore(async (store) => {
        const exact = await store.writeSet(A, chunks(['screen', '12345678']), {
          maxBytes: { screen: 8, print: 100 },
        })
        expect(exact.screen).toBe(8)

        await expect(
          store.writeSet(A, chunks(['screen', '123456789']), {
            maxBytes: { screen: 8, print: 100 },
          }),
        ).rejects.toMatchObject({ code: 'book.tooLarge' })
      }))

    it('accepts a printer version of exactly its ceiling', () =>
      withStore(async (store) => {
        const result = await store.writeSet(
          A,
          chunks(['screen', 's'], ['printInterior', '123456'], ['printCover', '1234']),
          { maxBytes: { screen: 100, print: 10 } },
        )

        expect(result.printSkipped).toBeNull()
        expect(result.printInterior).toBe(6)
      }))

    it('drops the printer files of an older book when the new printer version is abandoned', () =>
      withStore(async (store) => {
        await store.writeSet(
          A,
          chunks(['screen', 's'], ['printInterior', 'i'], ['printCover', 'c']),
          LIMITS,
        )
        await store.writeSet(
          A,
          chunks(['screen', 'new'], ['printInterior', '123456'], ['printCover', '123456']),
          { maxBytes: { screen: 100, print: 10 } },
        )

        expect(await store.stat(A, 'printInterior')).toBeNull()
        expect(await store.stat(A, 'printCover')).toBeNull()
      }))

    it('refuses a screen book past its ceiling with book.tooLarge and leaves every older file alone', () =>
      withStore(async (store) => {
        await store.writeSet(
          A,
          chunks(['screen', 'keep'], ['printInterior', 'i'], ['printCover', 'c']),
          LIMITS,
        )

        await expect(
          store.writeSet(
            A,
            chunks(
              ['screen', '12345'],
              ['printInterior', 'x'],
              ['printCover', 'y'],
              ['screen', '67890'],
            ),
            { maxBytes: { screen: 8, print: 100 } },
          ),
        ).rejects.toMatchObject({ code: 'book.tooLarge' })

        expect(await collect(await store.openRead(A))).toBe('keep')
        expect(await collect(await store.openRead(A, undefined, 'printInterior'))).toBe('i')
        expect(await store.list()).toEqual([A])
      }))

    it('leaves nothing behind when the chunks fail part-way', () =>
      withStore(async (store) => {
        const failing = (async function* (): AsyncIterable<BookChunk> {
          yield { kind: 'screen', bytes: new TextEncoder().encode('half') }
          yield { kind: 'printInterior', bytes: new TextEncoder().encode('half') }
          throw new Error('boom')
        })()

        await expect(store.writeSet(A, failing, LIMITS)).rejects.toThrow('boom')

        expect(await store.list()).toEqual([])
      }))

    it('refuses a printer version that has one file only, and writes nothing', () =>
      withStore(async (store) => {
        await expect(
          store.writeSet(A, chunks(['screen', 's'], ['printInterior', 'i']), LIMITS),
        ).rejects.toThrow('both its files')

        expect(await store.list()).toEqual([])
      }))

    it('refuses a set with no screen book', () =>
      withStore(async (store) => {
        await expect(
          store.writeSet(A, chunks(['printInterior', 'i'], ['printCover', 'c']), LIMITS),
        ).rejects.toThrow('no screen book')

        expect(await store.list()).toEqual([])
      }))

    it('deletes all three files of one event only, and lists an event once', () =>
      withStore(async (store) => {
        await store.writeSet(
          A,
          chunks(['screen', 'a'], ['printInterior', 'a'], ['printCover', 'a']),
          LIMITS,
        )
        await store.writeSet(B, chunks(['screen', 'b']), LIMITS)

        expect([...(await store.list())].sort()).toEqual([A, B])
        await store.delete(A)

        expect(await store.stat(A)).toBeNull()
        expect(await store.stat(A, 'printInterior')).toBeNull()
        expect(await store.stat(A, 'printCover')).toBeNull()
        expect(await store.list()).toEqual([B])
      }))
  })
}
