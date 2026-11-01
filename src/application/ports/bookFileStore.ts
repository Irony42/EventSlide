import type { EventId } from '../../domain/shared/ids'
import type { ByteRange } from './mediaStore'

/**
 * Where a finished book lives: one PDF per event, outside the event's own folder and outside
 * the backups (`<MEDIA_ROOT>/.books/<eventId>.pdf`). The name comes from the `EventId` alone,
 * never from the title the host typed, and no path ever comes from a caller.
 */
export interface BookFileStore {
  /**
   * Writes the stream to a temporary file and renames it into place, so a reader never sees a
   * half-written book and an older file is replaced in one step. Answers the size.
   *
   * Stops, deletes the temporary file and rejects with `book.tooLarge` once more than
   * `maxBytes` were written, and also when the stream itself rejects.
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

  /** The events that have a finished file, for the sweep's orphan check. */
  list(): Promise<readonly EventId[]>
}
