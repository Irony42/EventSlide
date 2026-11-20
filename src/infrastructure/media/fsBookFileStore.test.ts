import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BookChunk, BookFileKind } from '../../application/ports/bookFileStore'
import { bookFileStoreContract } from '../../application/testing/contracts/bookFileStoreContract'
import { asEventId } from '../../domain/shared/ids'
import { createFsBookFileStore, writeFully } from './fsBookFileStore'

const tempRoot = (): string => mkdtempSync(join(tmpdir(), 'es-books-'))

bookFileStoreContract('filesystem', async () => {
  const root = tempRoot()
  return {
    store: createFsBookFileStore(root),
    dispose: async () => rmSync(root, { recursive: true, force: true }),
  }
})

describe('createFsBookFileStore', () => {
  const bytes = (text: string): AsyncIterable<Uint8Array> =>
    (async function* () {
      yield new TextEncoder().encode(text)
    })()

  it('keeps books in a dot-folder at the root, named by the event id alone', async () => {
    const root = tempRoot()
    try {
      await createFsBookFileStore(root).write(asEventId('evt-a'), bytes('x'), { maxBytes: 10 })

      expect(readdirSync(join(root, '.books')).sort()).toEqual(['.tmp', 'evt-a.pdf'])
      expect(readdirSync(join(root, '.books', '.tmp'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['../evil', 'a/b', '..', '', '.hidden', 'a\b'])('refuses the unsafe event id %j', async (id) => {
    const root = tempRoot()
    try {
      const store = createFsBookFileStore(root)

      await expect(store.write(asEventId(id), bytes('x'), { maxBytes: 10 })).rejects.toThrow(
        /unsafe event id/,
      )
      await expect(store.stat(asEventId(id))).rejects.toThrow(/unsafe event id/)
      await expect(store.delete(asEventId(id))).rejects.toThrow(/unsafe event id/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('never lists a temporary file, nor a file that is not a book', async () => {
    const root = tempRoot()
    try {
      const store = createFsBookFileStore(root)
      await store.write(asEventId('evt-a'), bytes('x'), { maxBytes: 10 })
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(root, '.books', 'notes.txt'), 'x')
      writeFileSync(join(root, '.books', '.tmp', 'evt-b.1.tmp'), 'half')

      expect(await store.list()).toEqual(['evt-a'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('createFsBookFileStore: the printer version', () => {
  const chunks = (...parts: [BookFileKind, string][]): AsyncIterable<BookChunk> =>
    (async function* () {
      for (const [kind, text] of parts) yield { kind, bytes: new TextEncoder().encode(text) }
    })()
  const LIMITS = { maxBytes: { screen: 100, print: 100 } }

  it('names the three files after the event id and leaves no temporary file', async () => {
    const root = tempRoot()
    try {
      await createFsBookFileStore(root).writeSet(
        asEventId('evt-a'),
        chunks(['screen', 's'], ['printInterior', 'i'], ['printCover', 'c']),
        LIMITS,
      )

      expect(readdirSync(join(root, '.books')).sort()).toEqual([
        '.tmp',
        'evt-a.cover.pdf',
        'evt-a.pdf',
        'evt-a.print.pdf',
      ])
      expect(readdirSync(join(root, '.books', '.tmp'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists an event from any of its three names, and an orphaned printer file too', async () => {
    const root = tempRoot()
    try {
      const store = createFsBookFileStore(root)
      await store.writeSet(asEventId('evt-a'), chunks(['screen', 's']), LIMITS)
      writeFileSync(join(root, '.books', 'evt-b.print.pdf'), 'x')
      writeFileSync(join(root, '.books', 'evt-c.cover.pdf'), 'x')

      expect([...(await store.list())].sort()).toEqual(['evt-a', 'evt-b', 'evt-c'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['evt.print', 'evt.cover'])(
    'refuses an event id that would read as another event’s printer file: %j',
    async (id) => {
      const root = tempRoot()
      try {
        await expect(
          createFsBookFileStore(root).writeSet(asEventId(id), chunks(['screen', 's']), LIMITS),
        ).rejects.toThrow(/unsafe event id/)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})

describe('writeFully', () => {
  it('keeps writing until every byte is down, whatever a single write accepts', async () => {
    const written: number[] = []
    const calls: [number, number][] = []
    const handle = {
      write: async (bytes: Uint8Array, offset: number, length: number) => {
        const count = Math.min(2, length)
        calls.push([offset, length])
        written.push(...bytes.subarray(offset, offset + count))
        return { bytesWritten: count, buffer: bytes }
      },
    }

    await writeFully(handle as never, new Uint8Array([1, 2, 3, 4, 5]))

    expect(written).toEqual([1, 2, 3, 4, 5])
    expect(calls).toEqual([
      [0, 5],
      [2, 3],
      [4, 1],
    ])
  })

  it('writes nothing for an empty chunk', async () => {
    const handle = { write: async () => ({ bytesWritten: 0, buffer: new Uint8Array() }) }

    await expect(writeFully(handle as never, new Uint8Array())).resolves.toBeUndefined()
  })
})

describe('createFsBookFileStore: a set that cannot be put in place', () => {
  it('removes the printer files it already renamed when the screen book cannot be (and leaves no temporary file)', async () => {
    const root = tempRoot()
    try {
      const store = createFsBookFileStore(root)
      // A directory where the screen book must go: the last rename fails.
      mkdirSync(join(root, '.books', 'evt-a.pdf'), { recursive: true })

      await expect(
        store.writeSet(
          asEventId('evt-a'),
          (async function* (): AsyncIterable<BookChunk> {
            yield { kind: 'screen', bytes: new TextEncoder().encode('s') }
            yield { kind: 'printInterior', bytes: new TextEncoder().encode('i') }
            yield { kind: 'printCover', bytes: new TextEncoder().encode('c') }
          })(),
          { maxBytes: { screen: 10, print: 10 } },
        ),
      ).rejects.toThrow()

      expect(await store.stat(asEventId('evt-a'), 'printInterior')).toBeNull()
      expect(await store.stat(asEventId('evt-a'), 'printCover')).toBeNull()
      expect(readdirSync(join(root, '.books', '.tmp'))).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
