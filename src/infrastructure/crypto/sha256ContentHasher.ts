import { createHash } from 'node:crypto'
import type { ContentHasher } from '../../application/ports/contentHasher'

/**
 * SHA-256 of the stored bytes, in lowercase hex.
 *
 * Behind a port not because the algorithm is likely to change, but because the upload
 * use case is the highest-risk code in the product and its test should not have to
 * hash real image data to assert an ordering.
 *
 * Hashed **after** the pipeline re-encodes, never before. Two phones photographing the
 * same scene produce different bytes, so hashing the input would catch nothing; the
 * same file uploaded twice produces identical output from a deterministic pipeline, so
 * hashing the output is what makes a retry idempotent.
 */
export const sha256ContentHasher: ContentHasher = {
  sha256Hex: (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex'),
}
