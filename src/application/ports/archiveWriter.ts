/**
 * Builds the album ZIP a host downloads after the event.
 *
 * Both sides stream. A four-thousand-photo wedding album is several gigabytes: the
 * entries arrive from an async iterable over database rows, the bytes of each photo
 * arrive from the media store, and the archive is emitted as chunks the HTTP layer
 * pipes to the response. Nothing is materialised.
 *
 * The port emits `AsyncIterable<Uint8Array>` rather than taking a writable stream, so
 * it stays free of any framework type and can be tested by collecting the chunks.
 */

export interface ArchiveEntry {
  /** Path inside the archive. The caller guarantees it is unique and traversal-free. */
  readonly name: string
  readonly bytes: AsyncIterable<Uint8Array>
  /** Known size, so the archive can be written without buffering the entry. */
  readonly byteSize: number
  readonly modifiedAt: Date
}

export interface ArchiveWriter {
  /**
   * Photos are already compressed, so the adapter stores them without a second
   * compression pass — deflating a JPEG spends CPU to gain nothing.
   *
   * If an entry's bytes fail mid-archive the iterable rejects; the HTTP layer can only
   * abort the response at that point, since headers are long since sent. That is why
   * the caller checks that every file exists before starting.
   */
  stream(entries: AsyncIterable<ArchiveEntry>): AsyncIterable<Uint8Array>
}
