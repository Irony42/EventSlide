import { readFile, rm } from 'node:fs/promises'
import type { StagedUploadStore } from '../../application/ports/stagedUploadStore'

/**
 * The real `StagedUploadStore`: plain `node:fs/promises` on a path multer wrote.
 *
 * The view is built with an explicit offset and length because a small read can come from
 * Node's shared buffer pool, where the `Buffer` is a window onto a larger allocation and
 * `.buffer` alone would hand on the whole pool.
 */
export const fsStagedUploadStore: StagedUploadStore = {
  read: async (path) => {
    const read = await readFile(path)
    return new Uint8Array(read.buffer, read.byteOffset, read.byteLength)
  },
  remove: async (path) => {
    await rm(path, { force: true })
  },
}
