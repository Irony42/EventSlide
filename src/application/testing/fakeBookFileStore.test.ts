import { describe, expect, it } from 'vitest'
import type { BookChunk, BookFileKind } from '../ports/bookFileStore'
import { asEventId } from '../../domain/shared/ids'
import { bookFileStoreContract } from './contracts/bookFileStoreContract'
import { FakeBookFileStore } from './fakeBookFileStore'

bookFileStoreContract('fake', async () => ({ store: new FakeBookFileStore() }))

describe('FakeBookFileStore', () => {
  const A = asEventId('evt-a')
  const chunk = (kind: BookFileKind, text: string): BookChunk => ({
    kind,
    bytes: new TextEncoder().encode(text),
  })
  const of = async function* (...parts: BookChunk[]): AsyncIterable<BookChunk> {
    yield* parts
  }
  const LIMITS = { maxBytes: { screen: 100, print: 100 } }

  it('fails the next write or set on request, once, after reading the whole stream', async () => {
    const store = new FakeBookFileStore()
    store.failNextWriteWith = new Error('disk')
    await expect(store.writeSet(A, of(chunk('screen', 's')), LIMITS)).rejects.toThrow('disk')
    expect(await store.list()).toEqual([])

    store.failNextWriteWith = new Error('disk again')
    await expect(
      store.write(
        A,
        (async function* () {
          yield new Uint8Array([1])
        })(),
        { maxBytes: 10 },
      ),
    ).rejects.toThrow('disk again')

    await store.writeSet(A, of(chunk('screen', 's')), LIMITS)
    expect(store.has(A)).toBe(true)
  })

  it('seeds and reports a file of any kind', async () => {
    const store = new FakeBookFileStore()
    store.seed(A, new Uint8Array([1, 2]), 'printCover')

    expect(store.has(A)).toBe(false)
    expect(store.has(A, 'printCover')).toBe(true)
    expect(await store.stat(A, 'printCover')).toEqual({ size: 2 })
  })
})
