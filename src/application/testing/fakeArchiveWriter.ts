import type { ArchiveEntry, ArchiveWriter } from '../ports/archiveWriter'

/** The four bytes every ZIP local file header opens with: `PK\x03\x04`. */
export const ZIP_LOCAL_FILE_HEADER: Uint8Array = Uint8Array.from([0x50, 0x4b, 0x03, 0x04])

/** What the writer was handed for one entry, and how many bytes it pulled from it. */
export interface RecordedArchiveEntry {
  readonly name: string
  readonly modifiedAt: Date
  readonly bytesRead: number
}

export interface FakeArchiveWriterOptions {
  /**
   * What the stream carries.
   *
   * - `'marker'` (the default): one byte per entry, its running number. Enough for a test of
   *   what went *into* the archive, which it reads from `entries` and `names`.
   * - `'content'`: a ZIP local file header, then each entry's name and bytes as they arrive.
   *   For a route test, whose concern is that the chunks reach the socket in order and that a
   *   failure does not become a truncated 200.
   * - `'zip'`: the `'content'` bytes, then the 22-byte end-of-central-directory record a ZIP ends
   *   with, announcing the number of entries. Not a ZIP a tool could open, but one whose end the
   *   archive's re-reading (`readZipEnd`) can check, which is all a use case test of the box's own
   *   archive needs.
   */
  readonly emits?: 'marker' | 'content' | 'zip'
  /**
   * Rejects the stream when it meets its first entry — the rejection `archiverWriter.test.ts`
   * already proves the real writer performs when an entry's bytes disappear part-way through
   * a multi-gigabyte download. `undefined` means never fail: a rejection value of any other
   * shape is a failure.
   */
  readonly failsWith?: unknown
}

/**
 * An `ArchiveWriter` that records what it was asked to archive, so a test can assert on the
 * album's contents without a real ZIP.
 *
 * It keeps the port's two promises about reading: it asks for the next entry only after it
 * has dealt with the previous one, and when the consumer stops reading it stops pulling, which
 * closes the entries it was handed. Not `archiver`: `src/interface` may not import
 * `src/infrastructure`, and `archiverWriter.test.ts` holds the real one to the same promises.
 *
 * There were three of these — one recording names, one recording sizes and one emitting a
 * header — and each covered a different half of what a use case or a route needs to see.
 */
export class FakeArchiveWriter implements ArchiveWriter {
  readonly entries: RecordedArchiveEntry[] = []

  constructor(private readonly options: FakeArchiveWriterOptions = {}) {}

  /** The names of the entries, in the order they were archived. */
  get names(): readonly string[] {
    return this.entries.map((entry) => entry.name)
  }

  stream(entries: AsyncIterable<ArchiveEntry>): AsyncIterable<Uint8Array> {
    const { emits = 'marker', failsWith } = this.options
    const recorded = this.entries
    return (async function* () {
      const content = emits === 'content' || emits === 'zip'
      if (content) yield new Uint8Array(ZIP_LOCAL_FILE_HEADER)

      for await (const entry of entries) {
        if (failsWith !== undefined) throw failsWith
        if (content) yield new TextEncoder().encode(entry.name)

        let bytesRead = 0
        for await (const chunk of entry.bytes) {
          bytesRead += chunk.length
          if (content) yield chunk
        }

        recorded.push({ name: entry.name, modifiedAt: entry.modifiedAt, bytesRead })
        if (emits === 'marker') yield Uint8Array.of(recorded.length)
      }

      if (emits === 'zip') {
        const end = new Uint8Array(22)
        const view = new DataView(end.buffer)
        view.setUint32(0, 0x06054b50, true)
        view.setUint16(8, recorded.length, true)
        view.setUint16(10, recorded.length, true)
        yield end
      }
    })()
  }
}
