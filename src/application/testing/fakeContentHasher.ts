import type { ContentHasher } from '../ports/contentHasher'

/**
 * A `ContentHasher` a test can reason about: FNV-1a widened to 64 hex characters.
 *
 * Deterministic, so the same bytes hash the same — which is the whole of what makes ingest
 * idempotent — and different bytes hash differently. And a real `ContentHash`: the output
 * has the shape of a SHA-256 digest, so the domain accepts it. It is not SHA-256, and no
 * test should depend on that; `sha256ContentHasher` has its own test against the real digest.
 */
export class FakeContentHasher implements ContentHasher {
  private malformed = false

  /** A broken adapter — the one hash failure that is not the guest's photo's fault. */
  returnGarbage(): this {
    this.malformed = true
    return this
  }

  sha256Hex(bytes: Uint8Array): string {
    if (this.malformed) return 'not-a-digest'

    let state = 2166136261
    let digest = ''
    while (digest.length < 64) {
      for (const byte of bytes) state = Math.imul(state ^ byte, 16777619) >>> 0
      state = Math.imul(state ^ digest.length, 16777619) >>> 0
      digest += state.toString(16).padStart(8, '0')
    }
    return digest.slice(0, 64)
  }
}
