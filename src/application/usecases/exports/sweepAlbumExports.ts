import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { ExportFileStore } from '../../ports/exportFileStore'
import type { Logger } from '../../ports/logger'

/**
 * The housekeeping of archives, run on the archive worker's own timer (not in `retentionSweeper`,
 * which is the purge's and would be stopped by `RETENTION_SWEEP_INTERVAL_MINUTES=off`).
 *
 * 1. **Expired archives go**: the file and the row, once `expires_at` has passed (the first of the
 *    48 hours after a complete send, the ttl and the album's deadline: `exportExpiresAt`).
 * 2. **A `sealed` row whose file is gone is `stale`** (`fileMissing`): a restored backup, a manual
 *    clean-up. The host is told to make it again instead of being served a 404.
 * 3. **A file no archive owns is deleted**: left by a crash, by an archive that went stale whose
 *    delete failed, or by an event the purge removed. A file is owned by an archive that is
 *    `sealed` **or still being made**: the sweep must not take it from under a write.
 * 4. **A temporary file older than a quarter of an hour is deleted**: a write cut short by a power
 *    cut. A write in progress touches its file all the time, so it is never that old.
 *
 * The files are listed **before** the rows are read, so an archive finishing in between is in the
 * rows and never mistaken for an orphan.
 */

/** A temporary file this much older than now is wreckage. */
export const TEMPORARY_FILE_MAX_AGE_MS = 15 * 60_000

export interface SweepAlbumExportsDeps {
  readonly exports: AlbumExportRepository
  readonly exportFiles: ExportFileStore
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
}

export interface SweepAlbumExportsReport {
  readonly expired: number
  readonly missing: number
  readonly orphans: number
  readonly temporaries: number
}

export type SweepAlbumExports = () => Promise<SweepAlbumExportsReport>

export const makeSweepAlbumExports = ({
  exports,
  exportFiles,
  bus,
  clock,
  logger,
}: SweepAlbumExportsDeps): SweepAlbumExports => {
  return async () => {
    const now = clock.now()
    const onDisk = await exportFiles.list()

    const expiredEvents = await exports.listExpired(now)
    for (const eventId of expiredEvents) {
      await exportFiles.delete(eventId)
      await exports.delete(eventId)
      bus.publish({ type: 'export.changed', eventId })
    }

    let missing = 0
    for (const eventId of await exports.listSealedEventIds()) {
      if ((await exportFiles.stat(eventId)) !== null) continue
      await exports.invalidate(eventId, 'fileMissing', now)
      bus.publish({ type: 'export.changed', eventId })
      missing += 1
    }

    const owned = new Set([
      ...(await exports.listSealedEventIds()),
      ...(await exports.listActiveEventIds()),
    ])
    let orphans = 0
    for (const eventId of onDisk) {
      if (owned.has(eventId) || expiredEvents.includes(eventId)) continue
      await exportFiles.delete(eventId)
      orphans += 1
    }

    let temporaries = 0
    for (const { name, modifiedAt } of await exportFiles.listTemporary()) {
      if (now.getTime() - modifiedAt.getTime() <= TEMPORARY_FILE_MAX_AGE_MS) continue
      await exportFiles.deleteTemporary(name)
      temporaries += 1
    }

    if (expiredEvents.length + missing + orphans + temporaries > 0) {
      logger.info('album archives swept', {
        expired: expiredEvents.length,
        missing,
        orphans,
        temporaries,
      })
    }
    return { expired: expiredEvents.length, missing, orphans, temporaries }
  }
}
