import type { EventId } from '../../domain/shared/ids'
import type { BookPrintSkipped } from '../../domain/book/albumBookStatus'
import type { ByteRange } from './mediaStore'

/** The three files a book can have: the screen book and the two of the printer version. */
export type BookFileKind = 'screen' | 'printInterior' | 'printCover'

/** One piece of one of the files, as the renderer produces them, interleaved. */
export interface BookChunk {
  readonly kind: BookFileKind
  readonly bytes: Uint8Array
}

/** What `writeSet` produced. The printer sizes are `null` together: both files, or neither. */
export interface BookFileSetResult {
  readonly screen: number
  readonly printInterior: number | null
  readonly printCover: number | null
  /** `tooLarge` when the printer version was abandoned for outgrowing its ceiling; the screen book is kept. */
  readonly printSkipped: Extract<BookPrintSkipped, 'tooLarge'> | null
}

/**
 * Where a finished book lives, outside the event's own folder and outside the backups
 * (`<MEDIA_ROOT>/.books/`): `<eventId>.pdf`, and for the printer version `<eventId>.print.pdf` and
 * `<eventId>.cover.pdf`. A name comes from the `EventId` alone, never from the title the host
 * typed, and no path ever comes from a caller.
 */
export interface BookFileStore {
  /**
   * Writes the stream to a temporary file and renames it into place, so a reader never sees a
   * half-written book and an older file is replaced in one step. Answers the size. This is the
   * screen book alone (the 3.14 worker); {@link BookFileStore.writeSet} is the whole set.
   *
   * Stops, deletes the temporary file and rejects with `book.tooLarge` once more than
   * `maxBytes` were written, and also when the stream itself rejects.
   */
  write(
    eventId: EventId,
    bytes: AsyncIterable<Uint8Array>,
    options: { readonly maxBytes: number },
  ): Promise<number>

  /**
   * Writes the interleaved chunks of one render into up to three temporary files **in one loop** (the
   * back-pressure is the loop's, not three concurrent streams'), then renames **every** file produced
   * before it answers: the caller's verdict never precedes a file.
   *
   * - Past `maxBytes.screen` it stops and rejects with `book.tooLarge`, as `write` does.
   * - Past `maxBytes.print` (the interior and the cover **together**) it drops the printer files and
   *   carries on with the screen book: `printSkipped` is `'tooLarge'`.
   * - A printer file with no counterpart at the end of the stream is a renderer bug: it rejects.
   * - When the set has no printer version, the files an older book left are deleted with the swap.
   * - Whatever happens, no temporary file is left and a file already in place is never half-replaced.
   */
  writeSet(
    eventId: EventId,
    chunks: AsyncIterable<BookChunk>,
    options: {
      readonly maxBytes: { readonly screen: number; readonly print: number }
      /** Called once, as soon as the printer files are dropped for outgrowing their ceiling: the renderer stops feeding them. */
      readonly onPrintDropped?: () => void
    },
  ): Promise<BookFileSetResult>

  /** The size, or `null` when there is no finished file. A temporary file is never reported. */
  stat(eventId: EventId, kind?: BookFileKind): Promise<{ readonly size: number } | null>

  /** The bytes (or a range of them), or `null` when there is none. */
  openRead(
    eventId: EventId,
    range?: ByteRange,
    kind?: BookFileKind,
  ): Promise<AsyncIterable<Uint8Array> | null>

  /** Every file of the event, the printer version's included. Idempotent. */
  delete(eventId: EventId): Promise<void>

  /** The events that have at least one file of the three, for the sweep's orphan check. */
  list(): Promise<readonly EventId[]>
}
