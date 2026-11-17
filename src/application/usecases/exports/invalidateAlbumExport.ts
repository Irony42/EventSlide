import type { ExportStaleReason } from '../../../domain/exports/albumExportStatus'
import type { EventId } from '../../../domain/shared/ids'
import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { ExportFileStore } from '../../ports/exportFileStore'
import type { Logger } from '../../ports/logger'

/**
 * Something the archive holds left the evening, or the album is not the one it describes any more:
 * the archive is no longer fit to give (spec 22, section 7). **This is what keeps a guest who erased
 * themselves out of a copy the box keeps.**
 *
 * Called, and awaited, by every path that takes content out of the evening, **before the bytes
 * go**: a failure then leaves an archive needlessly stale, never an archive that still holds what
 * was removed. The bus is not the mechanism (it is fire and forget);
 * `exportInvalidation.guard.test.ts` fails the build when a new removing path forgets the call.
 *
 * `sealed` becomes `stale` and **the file is deleted at once**, not at the next sweep; `queued` and
 * `running` only record the instant, and the build rules when its write ends. Idempotent
 * (`eraseGuestContribution` removes many photographs), and it never throws: the removal the caller
 * was asked for must not fail because a ZIP could not be tidied. A file that could not be deleted is
 * collected by the sweep, and `downloadAlbumExport` answers only for a `sealed` row, so it is not
 * served meanwhile.
 */

export interface InvalidateAlbumExportDeps {
  readonly exports: AlbumExportRepository
  readonly exportFiles: Pick<ExportFileStore, 'delete'>
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
}

export type InvalidateExport = (eventId: EventId, reason: ExportStaleReason) => Promise<void>

export const makeInvalidateAlbumExport =
  ({ exports, exportFiles, bus, clock, logger }: InvalidateAlbumExportDeps): InvalidateExport =>
  async (eventId, reason) => {
    try {
      const current = await exports.find(eventId)
      if (current === null) return

      const after = await exports.invalidate(eventId, reason, clock.now())
      if (after === null || after.status !== 'stale') return

      // Whenever the row is stale, so a delete that failed once is retried by the next call.
      await exportFiles.delete(eventId)
      if (current.status === 'sealed') bus.publish({ type: 'export.changed', eventId })
    } catch (cause) {
      logger.warn('could not retire an archive; the sweep will finish it', {
        eventId,
        cause: String(cause),
      })
    }
  }
