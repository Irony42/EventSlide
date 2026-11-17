import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import { exportHasFile } from '../../../domain/exports/albumExportStatus'
import { exportExpiresAt, isExportExpired } from '../../../domain/exports/exportExpiry'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { ClientRepository } from '../../ports/clientRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { ExportFileStore } from '../../ports/exportFileStore'
import type { ByteRange } from '../../ports/mediaStore'
import { checkExportAccess } from './exportAccess'

/**
 * The sealed archive, as a stream with its size and its digest (spec 22).
 *
 * **One answer for every reason there is nothing to give**: no archive, not `sealed` (queued,
 * running, failed, and above all **stale**: a photograph left, so the file is not served even if a
 * failed delete left it on the disk), expired, file gone: `export.notFound`. An event the caller may
 * not take the album out of is answered as for the streamed ZIP.
 *
 * `open` takes the byte range of a `Range` request, so a download that loses its signal resumes. A
 * `sealed` row whose file is missing is not served; the sweep turns it `stale`.
 *
 * **`markServed` is the route's to call, once, and only when a `200` carried the whole file to the
 * socket** (rule 5): it stamps `served_at` and pulls the expiry in to 48 hours later when that is
 * sooner. A `206` is never marked, and neither is a `304` or a response the client abandoned.
 */

export interface AlbumExportFile {
  readonly byteSize: number
  /** SHA-256 of the whole ZIP, lowercase hex: the download's `ETag`. */
  readonly sha256: string
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
  /** Records that the whole file was sent. Never throws: a download is not undone by its own bookkeeping. */
  readonly markServed: () => Promise<void>
}

export interface DownloadAlbumExportDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly exports: Pick<AlbumExportRepository, 'find' | 'markServed'>
  readonly exportFiles: Pick<ExportFileStore, 'stat' | 'openRead'>
  readonly bus: EventBus
  readonly clock: Clock
  readonly policy: { readonly ttlDays: number; readonly capNoticeDays: number }
}

export type DownloadAlbumExport = (input: {
  readonly eventId: EventId
}) => Promise<Result<AlbumExportFile, DomainError>>

const notFound = (): Result<never, DomainError> => err(DomainError.notFound('export.notFound'))

export const makeDownloadAlbumExport =
  ({
    events,
    clients,
    exports,
    exportFiles,
    bus,
    clock,
    policy,
  }: DownloadAlbumExportDeps): DownloadAlbumExport =>
  async ({ eventId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const allowed = await checkExportAccess(clients, event)
    if (!allowed.ok) return allowed

    const archive = await exports.find(eventId)
    if (
      archive === null ||
      !exportHasFile(archive.status) ||
      archive.sha256 === null ||
      archive.sealedAt === null
    ) {
      return notFound()
    }
    if (archive.expiresAt === null || isExportExpired(archive.expiresAt, clock.now())) {
      return notFound()
    }

    const stored = await exportFiles.stat(eventId)
    if (stored === null) return notFound()

    const { sealedAt, sha256, expiresAt: currentExpiry } = archive

    const markServed = async (): Promise<void> => {
      const at = clock.now()
      const client = event.clientId === null ? null : await clients.findById(event.clientId)
      const sooner = exportExpiresAt({
        sealedAt,
        servedAt: at,
        deadline: purgeDeadline(event, client, policy.capNoticeDays),
        ttlDays: policy.ttlDays,
      })
      // Never later than it already was: a send brings the end closer, it does not extend a life.
      const expiresAt = sooner.getTime() < currentExpiry.getTime() ? sooner : currentExpiry
      if (await exports.markServed(eventId, at, expiresAt)) {
        bus.publish({ type: 'export.changed', eventId })
      }
    }

    return ok({
      byteSize: stored.size,
      sha256,
      open: (range) => exportFiles.openRead(eventId, range),
      markServed,
    })
  }
