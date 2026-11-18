import { requestExport, type AlbumExport } from '../../../domain/exports/albumExport'
import { isExportActive } from '../../../domain/exports/albumExportStatus'
import {
  checkExportBytes,
  checkExportDailyLimit,
  checkExportRoom,
  checkExportTotal,
  exportRetryAfterSeconds,
  exportWindowStart,
} from '../../../domain/exports/exportCaps'
import { retentionApplies } from '../../../domain/events/eventStatus'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { ExportFileStore } from '../../ports/exportFileStore'
import type { Logger } from '../../ports/logger'
import type { GuestbookVoiceRepository } from '../../ports/guestbookVoiceRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { ALBUM_STATUSES } from '../shared/albumArchive'
import { albumEstimateOf } from './albumEstimate'
import { checkExportAccess } from './exportAccess'
import { archiveBytesHeld } from './archiveBytesHeld'

/**
 * The host asks the box to prepare a verified archive of the album (spec 22). A row is written
 * `queued` and the worker is woken; nothing is written to the disk here but that row.
 *
 * What is refused, in this order, each with its own answer, **before anything is written**:
 *
 * 1. an event the caller may not take the album out of (`exportAllowed`: taken down `404`, suspended
 *    without an offboarding `403`), the same call the streamed ZIP makes;
 * 2. the function switched off for the box (`EXPORT_ENABLED`): `export.unavailable`;
 * 3. an event still running or not yet started (`export.notClosed`): the album is still growing, and
 *    an archive of it would prove nothing;
 * 4. an archive already queued or running (`export.alreadyRunning`): one at a time per event;
 * 5. the fourth request of the day for an event (`export.dailyLimitReached`, counted in
 *    `event_export_requests` so replacing or deleting the archive cannot reset it);
 * 6. an archive that **cannot fit**, judged on a conservative estimate (the album's stored bytes,
 *    which count every rendition and so over-estimate): one over `EXPORT_MAX_BYTES`
 *    (`export.tooLarge`, 413), one that would take the box past `EXPORT_MAX_TOTAL_BYTES`, and one the
 *    free disk cannot take while still leaving the minimum free (`export.noRoom`, 409). **A disk that
 *    cannot be read is a refusal**, never "assume there is room".
 *
 * Asking again **replaces** the archive: the older file is deleted at once, so no earlier archive
 * lingers under a row that is no longer sealed.
 */

export interface RequestAlbumExportPolicy {
  readonly enabled: boolean
  readonly maxBytes: number
  readonly maxTotalBytes: number
  readonly maxPerEventPerDay: number
  /** `MIN_FREE_DISK_BYTES`: what must stay free after the archive is written. */
  readonly minFreeDiskBytes: number
}

export interface RequestAlbumExportDeps {
  readonly events: EventRepository
  readonly clients: Pick<ClientRepository, 'findById'>
  readonly photos: Pick<PhotoRepository, 'countsByStatus' | 'totalBytes'>
  /** Only the recordings' size and count: the estimate counts them (spec 25). */
  readonly voices: Pick<GuestbookVoiceRepository, 'totalBytes' | 'countReady'>
  readonly exports: AlbumExportRepository
  readonly exportFiles: Pick<ExportFileStore, 'delete' | 'listTemporary'>
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
  /** Free bytes where the archive will be written, or `null` when the disk cannot be read. */
  readonly freeDiskBytes: () => Promise<number | null>
  readonly policy: RequestAlbumExportPolicy
}

export interface RequestAlbumExportInput {
  readonly eventId: EventId
  /** The account that asked. */
  readonly actorId: UserId
}

export type RequestAlbumExport = (
  input: RequestAlbumExportInput,
) => Promise<Result<AlbumExport, DomainError>>

export const makeRequestAlbumExport =
  ({
    events,
    clients,
    photos,
    voices,
    exports,
    exportFiles,
    bus,
    clock,
    logger,
    freeDiskBytes,
    policy,
  }: RequestAlbumExportDeps): RequestAlbumExport =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const allowed = await checkExportAccess(clients, event)
    if (!allowed.ok) return allowed

    if (!policy.enabled) return err(DomainError.unexpected('export.unavailable'))
    if (!retentionApplies(event.status)) return err(DomainError.conflict('export.notClosed'))

    const existing = await exports.find(eventId)
    if (existing !== null && isExportActive(existing.status)) {
      return err(DomainError.conflict('export.alreadyRunning'))
    }

    const now = clock.now()
    const since = exportWindowStart(now)
    const requested = await exports.countRequestsSince(eventId, since)
    const oldest = requested === 0 ? null : await exports.firstRequestSince(eventId, since)
    const limit = checkExportDailyLimit(
      requested,
      policy.maxPerEventPerDay,
      oldest === null ? 1 : exportRetryAfterSeconds(oldest, now),
    )
    if (!limit.ok) return limit

    const counts = await photos.countsByStatus(eventId)
    const rows = ALBUM_STATUSES.reduce((sum, status) => sum + counts[status], 0)
    const estimate = await albumEstimateOf({ photos, voices }, eventId, rows)

    const size = checkExportBytes(estimate, policy.maxBytes)
    if (!size.ok) return size
    const held = await archiveBytesHeld(exports, exportFiles)
    const total = checkExportTotal(held, estimate, policy.maxTotalBytes)
    if (!total.ok) return total
    const room = checkExportRoom(await freeDiskBytes(), estimate, policy.minFreeDiskBytes)
    if (!room.ok) return room

    const archive = requestExport(eventId, actorId, now)
    await exports.request(archive)

    // The older file goes with the older row, now: it belongs to a row that is no longer sealed and
    // nothing would serve it, but a file nobody can read is still a copy of the album on the disk.
    // A failure is not the request's failure; the sweep collects what no sealed or running row owns.
    try {
      await exportFiles.delete(eventId)
    } catch (cause) {
      logger.warn('could not delete the previous archive; the sweep will', {
        eventId,
        cause: String(cause),
      })
    }

    // After the row says it is queued: a subscriber must never learn of work that cannot be done
    // yet. This is what wakes the worker.
    bus.publish({ type: 'export.changed', eventId })
    return ok(archive)
  }
