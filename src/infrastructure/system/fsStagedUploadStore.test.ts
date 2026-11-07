import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fsStagedUploadStore } from './fsStagedUploadStore'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eventslide-staged-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('fsStagedUploadStore', () => {
  it('reads the file as a view over exactly its bytes', async () => {
    const path = join(dir, 'a.bin')
    await writeFile(path, Buffer.from([1, 2, 3, 4, 5]))

    const bytes = await fsStagedUploadStore.read(path)

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5])
    expect(bytes.byteLength).toBe(5)
  })

  it('rejects when the file does not exist', async () => {
    await expect(fsStagedUploadStore.read(join(dir, 'missing.bin'))).rejects.toThrow()
  })

  it('removes the file', async () => {
    const path = join(dir, 'b.bin')
    await writeFile(path, 'x')

    await fsStagedUploadStore.remove(path)

    expect(await readdir(dir)).toEqual([])
  })

  it('treats a file that is already gone as removed', async () => {
    await expect(fsStagedUploadStore.remove(join(dir, 'gone.bin'))).resolves.toBeUndefined()
  })

  it('rejects when the path cannot be removed for another reason', async () => {
    // A non-empty directory is not removed by a non-recursive `rm`, and `force` only
    // forgives a missing path.
    await writeFile(join(dir, 'inner'), 'x')

    await expect(fsStagedUploadStore.remove(dir)).rejects.toThrow()
  })
})
