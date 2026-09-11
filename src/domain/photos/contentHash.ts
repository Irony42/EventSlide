import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * SHA-256 of the **stored** image bytes, in lowercase hexadecimal.
 *
 * It does three jobs at once, which is why it is a first-class value rather than an
 * incidental column:
 *
 * 1. **It is the storage key.** Content-addressed files mean the media store never
 *    holds a guest-supplied name, so a filename can no longer be a path. 1.0 built its
 *    path from `Date.now()` plus a normalised original name and relied on a regex to
 *    keep `..` out.
 * 2. **It makes uploads idempotent.** A unique index on `(event_id, content_hash)`
 *    turns a double-tapped submit, or a retry after the network dropped mid-upload,
 *    into a no-op instead of the same photo appearing twice on the wall.
 * 3. **It makes the cache safe.** Because the name changes when the bytes change,
 *    media responses can carry `Cache-Control: immutable` with a one-year lifetime.
 *
 * Hashed after re-encoding, not before: two phones sending the same scene produce
 * different bytes, but the same file uploaded twice produces identical output from a
 * deterministic pipeline.
 */

const HEX_64 = /^[0-9a-f]{64}$/

export class ContentHash {
  private constructor(readonly value: string) {}

  static create(raw: unknown): Result<ContentHash, DomainError> {
    if (typeof raw !== 'string') return err(DomainError.invalid('contentHash.invalid'))
    // Uppercase hex is still a valid digest; normalise rather than reject, so the
    // stored form stays consistent and the unique index keeps working.
    const candidate = raw.trim().toLowerCase()
    if (!HEX_64.test(candidate)) return err(DomainError.invalid('contentHash.malformed'))
    return ok(new ContentHash(candidate))
  }

  /** First 12 characters, for logs and for a human-readable filename in the export. */
  get short(): string {
    return this.value.slice(0, 12)
  }

  equals(other: ContentHash): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }

  static readonly hexLength = 64
}
