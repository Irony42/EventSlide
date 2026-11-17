import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import type { Event } from '../../../domain/events/event'
import type { ExportSeal } from '../../../domain/exports/albumExport'
import type { ExportFailureCode } from '../../../domain/exports/albumExportStatus'
import {
  checkExportBytes,
  checkExportRoom,
  checkExportTotal,
  estimateExportBytes,
} from '../../../domain/exports/exportCaps'
import { retentionApplies } from '../../../domain/events/eventStatus'
import { exportExpiresAt } from '../../../domain/exports/exportExpiry'
import { readZipEnd, ZIP_TAIL_BYTES } from '../../../domain/exports/zipEndRecord'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId } from '../../../domain/shared/ids'
import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'
import type { ClientRepository } from '../../ports/clientRepository'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { ExportFileStore } from '../../ports/exportFileStore'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { StreamHasher } from '../../ports/streamHasher'
import { ALBUM_STATUSES, albumArchiveOf } from '../shared/albumArchive'
import { checkExportAccess } from './exportAccess'
import { archiveBytesHeld } from './archiveBytesHeld'

/**
 * One pass of the archive queue: claims the oldest asked-for archive and writes it, **verified**
 * (spec 22, section 6). It follows `buildNextAlbumBook`: a use case, so that every decision (does it
 * wait behind a transcode, is the event still one anybody may take out, does the file say what its
 * digest says, did a photograph arrive while it was written) is tested at 100 %, and
 * `src/main/exportWorker.ts` owns only a timer.
 *
 * **"Verified" is four checks of the server's, all passed, in this order, and a missed one is no
 * archive, never an archive that is almost right:**
 *
 * 1. **Room**, before a byte is written: the estimate against the free disk, the size ceiling and
 *    the box-wide total; and again every page (200 entries) while writing, so a wedding that sends
 *    its videos meanwhile does not have its uploads refused for an archive's sake.
 * 2. **Each file against its digest** while it is written (`albumArchiveOf`): the name of a stored
 *    file is its digest, so a disk that corrupted one is seen for free. A mismatch is
 *    `export.corrupt`, the writing stops, nothing is sealed, and the log says so.
 * 3. **The count**: the rows of the album at the start equal the files written plus the files
 *    skipped, and are the rows at the end. A photograph that arrived or left while it was written
 *    makes the archive `stale`, not sealed.
 * 4. **The finished file read again from the disk**, not from the stream: its SHA-256 equals the one
 *    computed while writing, its size equals the bytes written, and its end-of-central-directory
 *    record announces `files + 1` entries (the manifest). A disk that filled up and truncated
 *    without an error, an interrupted write, a missed rename, all end here as `unverified`.
 *
 * **"Complete" is a different word from "verified".** A row whose file is missing from the disk is a
 * photograph already lost: the archive is still sealed, with `skipped` saying how many, and the
 * host's early deletion is never offered without the word for it.
 *
 * **A fact that voided the archive while it was written wins over the file** (`settleExport`): the
 * row is read again, atomically, after the file exists, and a removal stamped meanwhile makes it
 * `stale` and the file is deleted. The question "may this still be given" is asked again before the
 * last step, after the long part.
 *
 * **The date promised to the guests does not move.** An event purged while its archive is written
 * has no row to receive a verdict (`superseded`) and the file is deleted with it.
 */

/** Rows per read of the album; the disk is read again every page (`albumEntries` pages the same). */
const PAGE_SIZE = 200

export interface BuildAlbumExportPolicy {
  readonly maxBytes: number
  readonly ttlDays: number
  /** Bytes of archives the box keeps at once. */
  readonly maxTotalBytes: number
  /** How long an archive waits behind video transcodes before it starts anyway. */
  readonly maxWaitMs: number
  /** The notice a lowered retention ceiling gives (for the purge date the archive must not outlive). */
  readonly capNoticeDays: number
  /** `MIN_FREE_DISK_BYTES`. */
  readonly minFreeDiskBytes: number
}

export interface BuildNextAlbumExportDeps {
  readonly events: EventRepository
  readonly clients: ClientRepository
  readonly guests: GuestRepository
  readonly guestbook: GuestbookRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly archive: ArchiveWriter
  readonly streamHasher: StreamHasher
  readonly exports: AlbumExportRepository
  readonly exportFiles: ExportFileStore
  /** Only `countActive`: the archive and the transcoder share one core. */
  readonly clips: Pick<ClipJobRepository, 'countActive'>
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: BuildAlbumExportPolicy
  /** Free bytes where the archive is written, or `null` when the disk cannot be read. */
  readonly freeDiskBytes: () => Promise<number | null>
}

export type BuildNextAlbumExportOutcome =
  | { readonly kind: 'idle' }
  /** A transcode is running and the oldest request has not waited long enough yet. */
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'sealed'
      readonly eventId: EventId
      readonly entries: number
      readonly skipped: number
      readonly bytes: number
    }
  /** A fact voided the archive, or the album changed under it: the file is gone, the host asks again. */
  | { readonly kind: 'stale'; readonly eventId: EventId }
  | { readonly kind: 'failed'; readonly eventId: EventId; readonly code: ExportFailureCode }
  /** The row was deleted or replaced while it was written: the file is gone, nothing else happened. */
  | { readonly kind: 'superseded'; readonly eventId: EventId }
  /** Shutdown interrupted the writing: the row stays `running`, boot recovery re-queues it. */
  | { readonly kind: 'aborted'; readonly eventId: EventId }

export type BuildNextAlbumExport = (signal?: AbortSignal) => Promise<BuildNextAlbumExportOutcome>

/** The failures a build chooses to report as themselves; anything else is `unexpected`. */
const FAILURE_OF: Readonly<Record<string, ExportFailureCode>> = {
  'export.corrupt': 'corrupt',
  'export.tooLarge': 'tooLarge',
  'export.noRoom': 'noRoom',
}

const failureCodeOf = (error: unknown): ExportFailureCode =>
  (DomainError.is(error) ? FAILURE_OF[error.code] : undefined) ?? 'unexpected'

const collect = async (bytes: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = []
  let length = 0
  for await (const chunk of bytes) {
    parts.push(chunk)
    length += chunk.byteLength
  }
  const whole = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.byteLength
  }
  return whole
}

export const makeBuildNextAlbumExport = ({
  events,
  clients,
  guests,
  guestbook,
  photos,
  media,
  archive,
  streamHasher,
  exports,
  exportFiles,
  clips,
  bus,
  clock,
  logger,
  policy,
  freeDiskBytes,
}: BuildNextAlbumExportDeps): BuildNextAlbumExport => {
  /** The event and its purge date, or `null` when nobody may be given an archive of it now. */
  const readable = async (
    eventId: EventId,
  ): Promise<{ readonly event: Event; readonly purgeDate: Date | null } | null> => {
    const event = await events.findById(eventId)
    if (event === null) return null
    // An archive is for an evening that is over: a request queued before the event was reopened
    // (which only stamps the queued row) must not be sealed for an album that grows again.
    if (!retentionApplies(event.status)) return null
    if (!(await checkExportAccess(clients, event)).ok) return null
    const client = event.clientId === null ? null : await clients.findById(event.clientId)
    return { event, purgeDate: purgeDeadline(event, client, policy.capNoticeDays) }
  }

  /** What the album holds now: the rows an archive must account for. */
  const albumRows = async (eventId: EventId): Promise<number> => {
    const counts = await photos.countsByStatus(eventId)
    return ALBUM_STATUSES.reduce((sum, status) => sum + counts[status], 0)
  }

  const announce = (eventId: EventId): void => bus.publish({ type: 'export.changed', eventId })

  /** The file is deleted whenever the row will not call it sealed: a file with no sealed row is a copy nobody may read. */
  const discardFile = async (eventId: EventId): Promise<void> => {
    try {
      await exportFiles.delete(eventId)
    } catch (cause) {
      logger.warn('could not delete an archive file; the sweep will', {
        eventId,
        cause: String(cause),
      })
    }
  }

  const giveUp = async (
    claimed: { readonly eventId: EventId },
    code: ExportFailureCode,
  ): Promise<BuildNextAlbumExportOutcome> => {
    const { eventId } = claimed
    // Atomic in the repository: a row the host replaced or the purge removed during the write has
    // no failure to record, and nothing is written.
    const finished = await exports.finish(eventId, { kind: 'failed', code }, clock.now())
    await discardFile(eventId)
    logger.warn('album archive failed', { eventId, code })
    announce(eventId)
    return finished === 'superseded'
      ? { kind: 'superseded', eventId }
      : { kind: 'failed', eventId, code }
  }

  /**
   * The finished file read again from the disk (check 4). Answers `true` when the three things the
   * server can affirm all hold.
   */
  const verifiedOnDisk = async (
    eventId: EventId,
    written: { readonly bytes: number; readonly sha256: string; readonly entries: number },
  ): Promise<boolean> => {
    const stored = await exportFiles.stat(eventId)
    if (stored === null || stored.size !== written.bytes) return false

    const hash = streamHasher.start()
    const whole = await exportFiles.openRead(eventId)
    if (whole === null) return false
    for await (const chunk of whole) hash.update(chunk)
    if (hash.digestHex() !== written.sha256) return false

    const start = Math.max(0, written.bytes - ZIP_TAIL_BYTES)
    const tail = await exportFiles.openRead(eventId, { start, end: written.bytes - 1 })
    if (tail === null) return false
    const end = readZipEnd(await collect(tail))
    // The manifest is the one entry the count in the row leaves out.
    return end !== null && end.entries === written.entries + 1
  }

  /** Everything after the claim. */
  const buildClaimed = async (
    claimed: { readonly eventId: EventId },
    signal: AbortSignal | undefined,
  ): Promise<BuildNextAlbumExportOutcome> => {
    const { eventId } = claimed
    const startedAt = clock.now()
    announce(eventId)

    const context = await readable(eventId)
    if (context === null) return giveUp(claimed, 'unavailable')

    // ------------------------------------------------------- check 1: the room --
    const rowsAtStart = await albumRows(eventId)
    const estimate = estimateExportBytes(await photos.totalBytes(eventId), rowsAtStart)
    if (!checkExportBytes(estimate, policy.maxBytes).ok) return giveUp(claimed, 'tooLarge')
    // Judged the way the request judged it.
    const held = await archiveBytesHeld(exports, exportFiles)
    if (!checkExportTotal(held, estimate, policy.maxTotalBytes).ok) return giveUp(claimed, 'noRoom')
    if (!checkExportRoom(await freeDiskBytes(), estimate, policy.minFreeDiskBytes).ok) {
      return giveUp(claimed, 'noRoom')
    }

    // ------------------------------------------------------ checks 2 and 3: write --
    const { entries, report } = albumArchiveOf(
      { photos, guestbook, guests, media, streamHasher, clock, logger },
      context.event,
    )

    /** The entries, with the room read again every page and the shutdown honoured between two. */
    const guarded = async function* (): AsyncIterable<ArchiveEntry> {
      let count = 0
      for await (const entry of entries) {
        if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
        count += 1
        if (count % PAGE_SIZE === 0) {
          const free = await freeDiskBytes()
          if (free === null || free < policy.minFreeDiskBytes) {
            throw DomainError.conflict('export.noRoom')
          }
        }
        yield entry
      }
    }

    const writtenHash = streamHasher.start()
    const hashedZip = async function* (): AsyncIterable<Uint8Array> {
      for await (const chunk of archive.stream(guarded())) {
        writtenHash.update(chunk)
        yield chunk
      }
    }

    let size: number
    try {
      size = await exportFiles.write(eventId, hashedZip(), { maxBytes: policy.maxBytes })
    } catch (error) {
      if (signal?.aborted === true) return { kind: 'aborted', eventId }
      if (!DomainError.is(error)) logger.error('album archive write failed', { eventId })
      return giveUp(claimed, failureCodeOf(error))
    }
    const sha256 = writtenHash.digestHex()
    const found = report()

    // After the long part: may this still be given? The event may have been taken down or the
    // client suspended while the photographs were being written.
    if ((await readable(eventId)) === null) return giveUp(claimed, 'unavailable')

    // ---------------------------------------------------------- check 3: the count --
    const rowsAtEnd = await albumRows(eventId)
    if (rowsAtStart !== rowsAtEnd || found.photos + found.missing !== rowsAtStart) {
      const finished = await exports.finish(
        eventId,
        { kind: 'stale', reason: 'albumChanged' },
        clock.now(),
      )
      await discardFile(eventId)
      announce(eventId)
      logger.info('album archive voided: the album changed while it was written', { eventId })
      return finished === 'superseded'
        ? { kind: 'superseded', eventId }
        : { kind: 'stale', eventId }
    }

    // ------------------------------------------------ check 4: read it back again --
    if (!(await verifiedOnDisk(eventId, { bytes: size, sha256, entries: found.written }))) {
      logger.error('album archive failed its re-reading', { eventId })
      return giveUp(claimed, 'unverified')
    }

    // --------------------------------------------------------------- the verdict --
    const sealedAt = clock.now()
    const seal: ExportSeal = {
      entries: found.written,
      skipped: found.missing,
      bytes: size,
      sha256,
      expiresAt: exportExpiresAt({
        sealedAt,
        servedAt: null,
        deadline: context.purgeDate,
        ttlDays: policy.ttlDays,
      }),
    }
    // Decided in the repository, on the row as it is **after** the file exists: a fact stamped
    // while it was written is in that row, and one replaced by a new request or deleted with its
    // event has no verdict to receive.
    const finished = await exports.finish(eventId, { kind: 'sealed', seal }, sealedAt)
    announce(eventId)
    if (finished === 'superseded') {
      await discardFile(eventId)
      return { kind: 'superseded', eventId }
    }
    if (finished === 'stale') {
      await discardFile(eventId)
      logger.info('album archive voided while it was written', { eventId })
      return { kind: 'stale', eventId }
    }
    logger.info('album archive sealed', {
      eventId,
      entries: seal.entries,
      skipped: seal.skipped,
      bytes: size,
      durationMs: sealedAt.getTime() - startedAt.getTime(),
    })
    return { kind: 'sealed', eventId, entries: seal.entries, skipped: seal.skipped, bytes: size }
  }

  return async (signal) => {
    // One core is shared with the video transcoder: an archive waits for it, but never longer than
    // the box says, or a wedding that sends clips all evening would starve the archive for good.
    const waiting = await exports.findNextQueued()
    if (waiting === null) return { kind: 'idle' }

    const waited = clock.now().getTime() - waiting.requestedAt.getTime()
    if (waited < policy.maxWaitMs && (await clips.countActive()) > 0) return { kind: 'waiting' }

    const next = await exports.claimNext(clock.now())
    if (next === null) return { kind: 'idle' }

    try {
      return await buildClaimed(next, signal)
    } catch (error) {
      // Whatever failed after the claim (the disk probe, a read of the album, the verdict's own
      // write), the archive is given up like the write's own failure is: left `running` it would
      // answer `export.alreadyRunning` to every new request until the next boot. A shutdown is the
      // one exception: the row stays `running` for the boot to re-queue.
      if (signal?.aborted === true) return { kind: 'aborted', eventId: next.eventId }
      if (!DomainError.is(error)) {
        logger.error('album archive failed unexpectedly', { eventId: next.eventId })
      }
      return giveUp(next, failureCodeOf(error))
    }
  }
}
