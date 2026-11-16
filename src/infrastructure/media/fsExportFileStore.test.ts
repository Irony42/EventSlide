import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportFileStoreContract } from '../../application/testing/contracts/exportFileStoreContract'
import { asEventId } from '../../domain/shared/ids'
import { createFsExportFileStore } from './fsExportFileStore'

const tempRoot = (): string => mkdtempSync(join(tmpdir(), 'es-exports-'))

exportFileStoreContract('filesystem', async () => {
  const root = tempRoot()
  return {
    store: createFsExportFileStore(root),
    dispose: async () => rmSync(root, { recursive: true, force: true }),
  }
})

const bytes = (text: string): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield new TextEncoder().encode(text)
  })()

const withRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = tempRoot()
  try {
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('createFsExportFileStore', () => {
  it('keeps archives in a dot-folder at the root, named by the event id alone', () =>
    withRoot(async (root) => {
      await createFsExportFileStore(root).write(asEventId('evt-a'), bytes('x'), { maxBytes: 10 })

      expect(readdirSync(join(root, '.exports')).sort()).toEqual(['.tmp', 'evt-a.zip'])
      expect(readdirSync(join(root, '.exports', '.tmp'))).toEqual([])
    }))

  it.each(['../evil', 'a/b', '..', '', '.hidden', 'a\b'])(
    'refuses the unsafe event id %j',
    (id) =>
      withRoot(async (root) => {
        const store = createFsExportFileStore(root)

        await expect(store.write(asEventId(id), bytes('x'), { maxBytes: 10 })).rejects.toThrow(
          /unsafe event id/,
        )
        await expect(store.stat(asEventId(id))).rejects.toThrow(/unsafe event id/)
        await expect(store.delete(asEventId(id))).rejects.toThrow(/unsafe event id/)
      }),
  )

  it('never lists a temporary file as an archive, nor a file that is not one', () =>
    withRoot(async (root) => {
      const store = createFsExportFileStore(root)
      await store.write(asEventId('evt-a'), bytes('x'), { maxBytes: 10 })
      writeFileSync(join(root, '.exports', 'notes.txt'), 'x')
      writeFileSync(join(root, '.exports', '.tmp', 'evt-b.1.tmp'), 'half')

      expect(await store.list()).toEqual(['evt-a'])
    }))

  it('lists a temporary file with its age, counts it in the total and deletes it by name', () =>
    withRoot(async (root) => {
      const store = createFsExportFileStore(root)
      await store.write(asEventId('evt-a'), bytes('xy'), { maxBytes: 10 })
      const half = join(root, '.exports', '.tmp', 'evt-b.1.tmp')
      writeFileSync(half, 'half')
      const old = new Date('2026-01-01T00:00:00Z')
      utimesSync(half, old, old)

      expect(await store.listTemporary()).toEqual([{ name: 'evt-b.1.tmp', modifiedAt: old }])
      expect(await store.totalBytes()).toBe(6)

      await store.deleteTemporary('evt-b.1.tmp')
      await store.deleteTemporary('evt-b.1.tmp')

      expect(await store.listTemporary()).toEqual([])
      expect(await store.totalBytes()).toBe(2)
    }))

  it('refuses to delete a temporary file by a name that is a path', () =>
    withRoot(async (root) => {
      const store = createFsExportFileStore(root)

      await expect(store.deleteTemporary('../evt-a.zip')).rejects.toThrow(/unsafe file name/)
    }))

  it('removes the temporary file when the stream goes past the ceiling', () =>
    withRoot(async (root) => {
      const store = createFsExportFileStore(root)

      await expect(
        store.write(asEventId('evt-a'), bytes('123456789'), { maxBytes: 4 }),
      ).rejects.toMatchObject({ code: 'export.tooLarge' })

      expect(readdirSync(join(root, '.exports', '.tmp'))).toEqual([])
    }))
})
