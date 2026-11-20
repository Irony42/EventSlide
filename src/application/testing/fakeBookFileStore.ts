import { DomainError } from '../../domain/shared/errors'
import type { EventId } from '../../domain/shared/ids'
import type {
  BookChunk,
  BookFileKind,
  BookFileSetResult,
  BookFileStore,
} from '../ports/bookFileStore'
import type { ByteRange } from '../ports/mediaStore'

const KINDS: readonly BookFileKind[] = ['screen', 'printInterior', 'printCover']

const join = (parts: readonly Uint8Array[], size: number): Uint8Array => {
  const whole = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.byteLength
  }
  return whole
}

/** In-memory `BookFileStore`: one buffer per event and kind, the same refusals as the disk one. */
export class FakeBookFileStore implements BookFileStore {
  private readonly files = new Map<string, Uint8Array>()
  /** Set to make the next `write` or `writeSet` fail after reading its stream. */
  failNextWriteWith: unknown = null

  private key(eventId: EventId, kind: BookFileKind): string {
    return `${eventId}|${kind}`
  }

  private failIfAsked(): void {
    if (this.failNextWriteWith === null) return
    const failure = this.failNextWriteWith
    this.failNextWriteWith = null
    throw failure
  }

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
    this.failIfAsked()
    this.files.set(this.key(eventId, 'screen'), join(chunks, size))
    return size
  }

  async writeSet(
    eventId: EventId,
    chunks: AsyncIterable<BookChunk>,
    options: { readonly maxBytes: { readonly screen: number; readonly print: number } },
  ): Promise<BookFileSetResult> {
    const parts = new Map<BookFileKind, Uint8Array[]>()
    const sizes = new Map<BookFileKind, number>()
    let printTotal = 0
    let printSkipped: 'tooLarge' | null = null
    for await (const chunk of chunks) {
      if (chunk.kind !== 'screen') {
        if (printSkipped !== null) continue
        printTotal += chunk.bytes.byteLength
        if (printTotal > options.maxBytes.print) {
          printSkipped = 'tooLarge'
          parts.delete('printInterior')
          parts.delete('printCover')
          continue
        }
      }
      const size = (sizes.get(chunk.kind) ?? 0) + chunk.bytes.byteLength
      if (chunk.kind === 'screen' && size > options.maxBytes.screen) {
        throw DomainError.quotaExceeded('book.tooLarge')
      }
      sizes.set(chunk.kind, size)
      parts.set(chunk.kind, [...(parts.get(chunk.kind) ?? []), chunk.bytes])
    }
    this.failIfAsked()
    const screen = parts.get('screen')
    const interior = parts.get('printInterior')
    const cover = parts.get('printCover')
    if (screen === undefined) throw new Error('book store: the render produced no screen book')
    if ((interior === undefined) !== (cover === undefined)) {
      throw new Error('book store: the printer version needs both its files')
    }
    for (const kind of KINDS) {
      const written = parts.get(kind)
      if (written === undefined) this.files.delete(this.key(eventId, kind))
      else this.files.set(this.key(eventId, kind), join(written, sizes.get(kind) ?? 0))
    }
    return {
      screen: sizes.get('screen') ?? 0,
      printInterior: interior === undefined ? null : (sizes.get('printInterior') ?? 0),
      printCover: cover === undefined ? null : (sizes.get('printCover') ?? 0),
      printSkipped,
    }
  }

  async stat(
    eventId: EventId,
    kind: BookFileKind = 'screen',
  ): Promise<{ readonly size: number } | null> {
    const file = this.files.get(this.key(eventId, kind))
    return file === undefined ? null : { size: file.byteLength }
  }

  async openRead(
    eventId: EventId,
    range?: ByteRange,
    kind: BookFileKind = 'screen',
  ): Promise<AsyncIterable<Uint8Array> | null> {
    const file = this.files.get(this.key(eventId, kind))
    if (file === undefined) return null
    const part = range === undefined ? file : file.slice(range.start, range.end + 1)
    return (async function* () {
      yield part
    })()
  }

  async delete(eventId: EventId): Promise<void> {
    for (const kind of KINDS) this.files.delete(this.key(eventId, kind))
  }

  async list(): Promise<readonly EventId[]> {
    return [...new Set([...this.files.keys()].map((key) => key.split('|')[0] as EventId))]
  }

  /** Test seam: put a file there without going through `write`. */
  seed(eventId: EventId, bytes: Uint8Array, kind: BookFileKind = 'screen'): void {
    this.files.set(this.key(eventId, kind), bytes)
  }

  has(eventId: EventId, kind: BookFileKind = 'screen'): boolean {
    return this.files.has(this.key(eventId, kind))
  }
}
