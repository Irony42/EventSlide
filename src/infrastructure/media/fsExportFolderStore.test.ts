import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFsExportFolderStore } from './fsExportFolderStore'

const bytes = (text: string): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield new TextEncoder().encode(text)
  })()

const withRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'es-folder-'))
  try {
    await run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const read = async (stream: AsyncIterable<Uint8Array> | null): Promise<string> => {
  let text = ''
  for await (const chunk of stream ?? []) text += new TextDecoder().decode(chunk)
  return text
}

describe('createFsExportFolderStore', () => {
  it('creates nothing until something is written', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(join(root, 'nas'))

      expect(await store.stat('a-2026-01-01')).toBeNull()
      expect(await store.openRead('a-2026-01-01')).toBeNull()
      expect(existsSync(join(root, 'nas'))).toBe(false)
    }))

  it('writes album.zip into its own folder, with no temporary file left', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(join(root, 'nas'))

      expect(await store.write('a-2026-01-01', bytes('zipped'), { maxBytes: 100 })).toBe(6)

      expect(readdirSync(join(root, 'nas', 'a-2026-01-01'))).toEqual(['album.zip'])
      expect(await store.stat('a-2026-01-01')).toEqual({ size: 6 })
      expect(await read(await store.openRead('a-2026-01-01'))).toBe('zipped')
      expect(await read(await store.openRead('a-2026-01-01', { start: 1, end: 2 }))).toBe('ip')
    }))

  it('replaces an earlier copy in one step', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)
      await store.write('a-2026-01-01', bytes('old'), { maxBytes: 100 })
      await store.write('a-2026-01-01', bytes('newer'), { maxBytes: 100 })

      expect(readFileSync(join(root, 'a-2026-01-01', 'album.zip'), 'utf8')).toBe('newer')
    }))

  it('stops past maxBytes and keeps no temporary file', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)

      await expect(store.write('a-2026-01-01', bytes('too long'), { maxBytes: 3 })).rejects.toThrow()

      expect(readdirSync(join(root, 'a-2026-01-01'))).toEqual([])
    }))

  it('writes the manifest beside the archive and deletes both, and the folder with them', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)
      await store.write('a-2026-01-01', bytes('z'), { maxBytes: 100 })
      await store.writeManifest('a-2026-01-01', 'abc  x.jpg\n')

      expect(readdirSync(join(root, 'a-2026-01-01')).sort()).toEqual(['MANIFEST.sha256', 'album.zip'])

      await store.delete('a-2026-01-01')
      await store.delete('a-2026-01-01')

      expect(existsSync(join(root, 'a-2026-01-01'))).toBe(false)
    }))

  it('publishes a staged copy over an earlier one, manifest included, and removes the staging', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)
      await store.write('a-2026-01-01', bytes('old'), { maxBytes: 100 })
      await store.writeManifest('a-2026-01-01', 'old manifest')
      await store.write('a-2026-01-01.partial', bytes('newer'), { maxBytes: 100 })
      await store.writeManifest('a-2026-01-01.partial', 'new manifest')

      await store.publish('a-2026-01-01.partial', 'a-2026-01-01')

      expect(readFileSync(join(root, 'a-2026-01-01', 'album.zip'), 'utf8')).toBe('newer')
      expect(readFileSync(join(root, 'a-2026-01-01', 'MANIFEST.sha256'), 'utf8')).toBe('new manifest')
      expect(existsSync(join(root, 'a-2026-01-01.partial'))).toBe(false)
    }))

  it('never leaves an archive beside the manifest of the one it replaced', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)
      await store.write('a', bytes('old'), { maxBytes: 100 })
      await store.writeManifest('a', 'old manifest')
      await store.write('a.partial', bytes('newer'), { maxBytes: 100 })

      await store.publish('a.partial', 'a')

      expect(readdirSync(join(root, 'a'))).toEqual(['album.zip'])
    }))

  it('publishes into a folder that does not exist yet', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)
      await store.write('b.partial', bytes('z'), { maxBytes: 100 })

      await store.publish('b.partial', 'b')

      expect(readdirSync(join(root, 'b'))).toEqual(['album.zip'])
    }))

  it('keeps the earlier copy when a staged write fails', () =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)
      await store.write('a', bytes('old'), { maxBytes: 100 })
      await store.writeManifest('a', 'm')

      await expect(store.write('a.partial', bytes('too long'), { maxBytes: 3 })).rejects.toThrow()
      await store.delete('a.partial')

      expect(readFileSync(join(root, 'a', 'album.zip'), 'utf8')).toBe('old')
      expect(readFileSync(join(root, 'a', 'MANIFEST.sha256'), 'utf8')).toBe('m')
      expect(existsSync(join(root, 'a.partial'))).toBe(false)
    }))

  it.each(['../evil', 'a/b', '..', '', '.hidden'])('refuses the unsafe folder name %j', (name) =>
    withRoot(async (root) => {
      const store = createFsExportFolderStore(root)

      await expect(store.write(name, bytes('x'), { maxBytes: 10 })).rejects.toThrow(/unsafe name/)
    }),
  )
})
