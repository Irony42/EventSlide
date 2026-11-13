import type { DomainError } from '../../../domain/shared/errors'
import { ok, type Result } from '../../../domain/shared/result'
import { ZIP_LOCAL_FILE_HEADER } from '../../../application/testing/fakeArchiveWriter'

/**
 * An export use case whose archive stays open until the test lets it end.
 *
 * What the host-export limiter counts is how many are **open**, and a fake that finishes in a
 * tick is never open at the moment the next request arrives. Each call writes the ZIP header
 * and then waits: `opened` says how many have started, `releaseAll` lets the waiting ones finish,
 * and `holding = false` makes the calls after that one finish on their own, so a test can probe
 * with a request that must be answered without having to read a half-open response.
 *
 * Used for both `exportAlbum` and `exportHighlights`: the two share a result type.
 */
export class HeldExport {
  /** Archives that have started writing, whether or not they have finished. */
  opened = 0
  /** When false, the next archives write their header and end at once. */
  holding = true

  private waiting: (() => void)[] = []

  readonly use = (): Promise<Result<AsyncIterable<Uint8Array>, DomainError>> =>
    Promise.resolve(ok(this.archive()))

  private async *archive(): AsyncGenerator<Uint8Array> {
    this.opened += 1
    yield new Uint8Array(ZIP_LOCAL_FILE_HEADER)
    if (this.holding) await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  releaseAll(): void {
    for (const release of this.waiting.splice(0)) release()
  }
}
