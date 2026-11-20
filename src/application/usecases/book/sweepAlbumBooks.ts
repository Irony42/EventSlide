import type { EventId } from '../../../domain/shared/ids'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { BookFileStore } from '../../ports/bookFileStore'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { Logger } from '../../ports/logger'

/**
 * The housekeeping of finished books, run on the book worker's own timer (not in
 * `retentionSweeper`, which is the purge's and the audit's and would be stopped by
 * `RETENTION_SWEEP_INTERVAL_MINUTES=off`).
 *
 * 1. **Expired books go**: the row and the file, once `expires_at` has passed.
 * 2. **A `done` row whose file is gone is `stale`** (`fileMissing`): a restored backup, a manual
 *    cleanup. A book with a printer version expects its two printer files as well: one missing
 *    voids the book, since the host was told they could download it. The host is told to rebuild instead of being served a 404.
 * 3. **A file no book owns is deleted**: left by a crash, or by a book that went stale. A file
 *    is owned by a book that is `done` **or still being made**: a rebuild keeps its older file
 *    until the new one replaces it, and the sweep must not take it from under the render.
 *
 * The files are listed **before** the rows are read, so a book finishing in between is in the
 * rows and never mistaken for an orphan.
 */
export interface SweepAlbumBooksDeps {
  readonly books: AlbumBookRepository
  readonly bookFiles: BookFileStore
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
}

export interface SweepAlbumBooksReport {
  readonly expired: number
  readonly missing: number
  readonly orphans: number
}

export type SweepAlbumBooks = () => Promise<SweepAlbumBooksReport>

export const makeSweepAlbumBooks = ({
  books,
  bookFiles,
  bus,
  clock,
  logger,
}: SweepAlbumBooksDeps): SweepAlbumBooks => {
  const isComplete = async (eventId: EventId, expectsPrint: boolean): Promise<boolean> => {
    if ((await bookFiles.stat(eventId, 'screen')) === null) return false
    if (!expectsPrint) return true
    return (
      (await bookFiles.stat(eventId, 'printInterior')) !== null &&
      (await bookFiles.stat(eventId, 'printCover')) !== null
    )
  }

  return async () => {
    const now = clock.now()
    const onDisk = await bookFiles.list()

    const expiredEvents = await books.listExpired(now)
    for (const eventId of expiredEvents) {
      await bookFiles.delete(eventId)
      await books.delete(eventId)
      bus.publish({ type: 'book.changed', eventId })
    }

    let missing = 0
    const withPrint = new Set(await books.listDoneWithPrintEventIds())
    for (const eventId of await books.listDoneEventIds()) {
      if (await isComplete(eventId, withPrint.has(eventId))) continue
      await books.invalidate(eventId, 'fileMissing', now)
      bus.publish({ type: 'book.changed', eventId })
      missing += 1
    }

    const owned = new Set([
      ...(await books.listDoneEventIds()),
      ...(await books.listActiveEventIds()),
    ])
    let orphans = 0
    for (const eventId of onDisk) {
      if (owned.has(eventId) || expiredEvents.includes(eventId)) continue
      await bookFiles.delete(eventId)
      orphans += 1
    }

    if (expiredEvents.length + missing + orphans > 0) {
      logger.info('photo books swept', { expired: expiredEvents.length, missing, orphans })
    }
    return { expired: expiredEvents.length, missing, orphans }
  }
}
