import type { EventId } from '../../domain/shared/ids'
import type { ByteRange } from './mediaStore'

/**
 * Where a finished archive lives: one ZIP per event, outside the event's own folder and outside the
 * backups (`<MEDIA_ROOT>/.exports/<eventId>.zip`), exactly where the photo book's PDF lives (spec 22).
 * The name comes from the `EventId` alone, never from the title the host typed, and no path ever
 * comes from a caller.
 */
export interface ExportFileStore {
  /**
   * Writes the stream to a temporary file and renames it into place, so a reader never sees a
   * half-written archive and an older file is replaced in one step. Answers the size.
   *
   * Stops, deletes the temporary file and rejects with `export.tooLarge` once more than `maxBytes`
   * were written, and also when the stream itself rejects.
   */
  write(
    eventId: EventId,
    bytes: AsyncIterable<Uint8Array>,
    options: { readonly maxBytes: number },
  ): Promise<number>

  /** The size, or `null` when there is no finished file. A temporary file is never reported. */
  stat(eventId: EventId): Promise<{ readonly size: number } | null>

  /** The bytes (or a range of them), or `null` when there is none. */
  openRead(eventId: EventId, range?: ByteRange): Promise<AsyncIterable<Uint8Array> | null>

  /** Idempotent. */
  delete(eventId: EventId): Promise<void>

  /** The events that have a finished file, for the sweep's orphan check. A temporary file is never listed. */
  list(): Promise<readonly EventId[]>

  /** Temporary files left by a write that never finished, and how old each is, so the sweep can collect them. */
  listTemporary(): Promise<readonly { readonly name: string; readonly modifiedAt: Date }[]>

  /** Deletes one temporary file by the name `listTemporary` gave. Idempotent. */
  deleteTemporary(name: string): Promise<void>

  /**
   * Bytes on the disk for archives, finished **and in the making** (temporary files included): what
   * `EXPORT_MAX_TOTAL_BYTES` is judged against, with the rows' own sizes.
   */
  totalBytes(): Promise<number>
}
