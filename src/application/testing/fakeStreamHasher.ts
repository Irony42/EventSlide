import type { IncrementalHash, StreamHasher } from '../ports/streamHasher'
import { FakeContentHasher } from './fakeContentHasher'

/**
 * A `StreamHasher` for tests: it keeps the chunks and answers `FakeContentHasher`'s digest of
 * them put end to end, so a test that wants "the digest of these bytes" asks the content hasher
 * and gets what the stream produced. Test-sized buffers only; the real one never accumulates.
 */
export class FakeStreamHasher implements StreamHasher {
  private readonly whole = new FakeContentHasher()

  start(): IncrementalHash {
    const chunks: Uint8Array[] = []
    return {
      update: (chunk) => {
        chunks.push(chunk)
      },
      digestHex: () => this.whole.sha256Hex(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))),
    }
  }
}
