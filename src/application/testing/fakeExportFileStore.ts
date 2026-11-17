import { DomainError } from '../../domain/shared/errors'
import type { EventId } from '../../domain/shared/ids'
import type { ExportFileStore, TemporaryExportFile } from '../ports/exportFileStore'
import type { ByteRange } from '../ports/mediaStore'

/** In-memory `ExportFileStore`: one buffer per event, the same refusal past `maxBytes`. */
export class FakeExportFileStore implements ExportFileStore {
  private readonly files = new Map<EventId, Uint8Array>()
  private readonly temporaries = new Map<string, { size: number; modifiedAt: Date }>()
  /** Set to make the next `write` fail after reading its stream. */
  failNextWriteWith: unknown = null
  /**
   * Makes the disk lie once: the next `write` stores what this returns for the bytes it was given
   * (cut short, one byte flipped) and still answers the size it was handed, as a disk that fills
   * up and truncates without an error does.
   */
  alterNextWrite: ((bytes: Uint8Array) => Uint8Array) | null = null
  /** Runs while a write is part-way, after the first chunk: where a test makes the world move. */
  duringWrite: (() => Promise<void>) | null = null

  async write(
    eventId: EventId,
    bytes: AsyncIterable<Uint8Array>,
    options: { readonly maxBytes: number },
  ): Promise<number> {
    const chunks: Uint8Array[] = []
    let size = 0
    let first = true
    for await (const chunk of bytes) {
      size += chunk.byteLength
      if (size > options.maxBytes) throw DomainError.quotaExceeded('export.tooLarge')
      chunks.push(chunk)
      if (first && this.duringWrite !== null) {
        first = false
        await this.duringWrite()
      }
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
    this.files.set(eventId, this.alterNextWrite === null ? whole : this.alterNextWrite(whole))
    this.alterNextWrite = null
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

  async listTemporary(): Promise<readonly TemporaryExportFile[]> {
    return [...this.temporaries].map(([name, { size, modifiedAt }]) => ({ name, size, modifiedAt }))
  }

  async deleteTemporary(name: string): Promise<void> {
    this.temporaries.delete(name)
  }

  /** Test seam: put a file there without going through `write`. */
  seed(eventId: EventId, bytes: Uint8Array): void {
    this.files.set(eventId, bytes)
  }

  /** Test seam: a temporary file a write left behind. */
  seedTemporary(name: string, size: number, modifiedAt: Date): void {
    this.temporaries.set(name, { size, modifiedAt })
  }

  has(eventId: EventId): boolean {
    return this.files.has(eventId)
  }

  /** Test seam: the stored bytes, for a test that reads the archive back. */
  bytesOf(eventId: EventId): Uint8Array | null {
    return this.files.get(eventId) ?? null
  }
}
