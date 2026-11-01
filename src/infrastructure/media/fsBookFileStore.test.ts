import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bookFileStoreContract } from '../../application/testing/contracts/bookFileStoreContract'
import { asEventId } from '../../domain/shared/ids'
import { createFsBookFileStore } from './fsBookFileStore'

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
