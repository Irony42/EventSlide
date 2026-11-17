import { DomainError } from '../../domain/shared/errors'
import type { ExportFolderStore } from '../ports/exportFolderStore'
import type { ByteRange } from '../ports/mediaStore'

/** In-memory `ExportFolderStore`: an archive and a manifest per folder name. */
export class FakeExportFolderStore implements ExportFolderStore {
  private readonly archives = new Map<string, Uint8Array>()
  private readonly manifests = new Map<string, string>()
  /** Makes the disk lie once: the next `write` stores what this returns and still answers the size it was handed. */
  alterNextWrite: ((bytes: Uint8Array) => Uint8Array) | null = null
  /** Set to make the next `write` fail after reading its stream. */
  failNextWriteWith: unknown = null
  /** Every folder a `write` was started for, in order, even one that then failed. */
  readonly writes: string[] = []

  async write(
    folder: string,
    bytes: AsyncIterable<Uint8Array>,
    options: { readonly maxBytes: number },
  ): Promise<number> {
    this.writes.push(folder)
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of bytes) {
      size += chunk.byteLength
      if (size > options.maxBytes) throw DomainError.quotaExceeded('export.tooLarge')
      chunks.push(chunk)
    }
    const whole = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) {
      whole.set(chunk, at)
      at += chunk.byteLength
    }
    if (this.failNextWriteWith !== null) {
      const failure = this.failNextWriteWith
      this.failNextWriteWith = null
      throw failure
    }
    this.archives.set(folder, this.alterNextWrite === null ? whole : this.alterNextWrite(whole))
    this.alterNextWrite = null
    return size
  }

  async stat(folder: string): Promise<{ readonly size: number } | null> {
    const found = this.archives.get(folder)
    return found === undefined ? null : { size: found.byteLength }
  }

  async openRead(folder: string, range?: ByteRange): Promise<AsyncIterable<Uint8Array> | null> {
    const found = this.archives.get(folder)
    if (found === undefined) return null
    const part = range === undefined ? found : found.slice(range.start, range.end + 1)
    return (async function* () {
      yield part
    })()
  }

  async writeManifest(folder: string, text: string): Promise<void> {
    this.manifests.set(folder, text)
  }

  async delete(folder: string): Promise<void> {
    this.archives.delete(folder)
    this.manifests.delete(folder)
  }

  bytesOf(folder: string): Uint8Array | null {
    return this.archives.get(folder) ?? null
  }

  manifestOf(folder: string): string | null {
    return this.manifests.get(folder) ?? null
  }

  folders(): readonly string[] {
    return [...new Set([...this.archives.keys(), ...this.manifests.keys()])].sort()
  }
}
