import { DomainError } from '../../domain/shared/errors'
import type { EventId } from '../../domain/shared/ids'
import type { BookFileStore } from '../ports/bookFileStore'
import type { ByteRange } from '../ports/mediaStore'

/** In-memory `BookFileStore`: one buffer per event, the same refusal past `maxBytes`. */
export class FakeBookFileStore implements BookFileStore {
  private readonly files = new Map<EventId, Uint8Array>()
  /** Set to make the next `write` fail after reading its stream. */
  failNextWriteWith: unknown = null

  async write(
    eventId: EventId,
    bytes: AsyncIterable<Uint8Array>,
    options: { readonly maxBytes: number },
  ): Promise<number> {
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of bytes) {
      size += chunk.byteLength
      if (size > options.maxBytes) throw DomainError.quotaExceeded('book.tooLarge')
      chunks.push(chunk)
    }
    if (this.failNextWriteWith !== null) {
      const failure = this.failNextWriteWith
      this.failNextWriteWith = null
      throw failure
    }
    const whole = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) {
      whole.set(chunk, at)
      at += chunk.byteLength
    }
    this.files.set(eventId, whole)
    return size
  }

  async stat(eventId: EventId): Promise<{ readonly size: number } | null> {
    const file = this.files.get(eventId)
    return file === undefined ? null : { size: file.byteLength }
  }

  async openRead(eventId: EventId, range?: ByteRange): Promise<AsyncIterable<Uint8Array> | null> {
    const file = this.files.get(eventId)
    if (file === undefined) return null
    const part = range === undefined ? file : file.slice(range.start, range.end + 1)
    return (async function* () {
      yield part
    })()
  }

  async delete(eventId: EventId): Promise<void> {
    this.files.delete(eventId)
  }

  async list(): Promise<readonly EventId[]> {
    return [...this.files.keys()]
  }

  /** Test seam: put a file there without going through `write`. */
  seed(eventId: EventId, bytes: Uint8Array): void {
    this.files.set(eventId, bytes)
  }

  has(eventId: EventId): boolean {
    return this.files.has(eventId)
  }
}
