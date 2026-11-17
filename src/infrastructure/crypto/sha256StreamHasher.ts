import { createHash } from 'node:crypto'
import type { StreamHasher } from '../../application/ports/streamHasher'

/** `node:crypto`'s SHA-256, fed a chunk at a time. */
export const sha256StreamHasher: StreamHasher = {
  start: () => {
    const hash = createHash('sha256')
    return {
      update: (chunk) => {
        hash.update(chunk)
      },
      digestHex: () => hash.digest('hex'),
    }
  },
}
