import { retentionApplies } from '../../../domain/events/eventStatus'
import type { Event } from '../../../domain/events/event'
import { checkExportRoom, estimateExportBytes } from '../../../domain/exports/exportCaps'
import { MANIFEST_NAME } from '../../../domain/photos/albumManifest'
import { DomainError } from '../../../domain/shared/errors'
import type { ArchiveEntry, ArchiveWriter } from '../../ports/archiveWriter'
import type { ExportFolderStore } from '../../ports/exportFolderStore'
import type { GuestRepository } from '../../ports/guestRepository'
import type { GuestbookRepository } from '../../ports/guestbookRepository'
import type { Logger } from '../../ports/logger'
import type { MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { StreamHasher } from '../../ports/streamHasher'
import type { Clock } from '../../ports/clock'
import { ALBUM_STATUSES, albumArchiveOf } from '../shared/albumArchive'
import { guardedEntries, verifiedOnDisk, type ArchiveReader } from './archiveChecks'

/**
 * The operator's copy of one album, written **outside the box** (spec 22, section 8): the same
 * verified archive the host's button makes, by the same loop (`albumArchiveOf`) and the same four
 * checks (`archiveChecks`), into a folder the operator chose, plus `MANIFEST.sha256` beside it.
 *
 * What it deliberately does **not** do: touch `event_exports` (a copy on the operator's USB key is
 * not an archive sent to the host), apply the box's `EXPORT_MAX_*` ceilings (they protect the box's
 * own disk; this disk is somebody else's, and only its free room is judged), or ask whether the
 * host may take the album out (the operator is the one responsible for this copy).
 *
 * Failure is data, never a half copy: whatever is not a verified archive is deleted before the
 * outcome is returned, so a folder holding an `album.zip` holds a verified one.
 */

export type ExportToFolderFailure =
  /** The event is still running or a draft: its album is not final. */
  | 'notClosed'
  | 'noRoom'
  | 'corrupt'
  /** A photograph arrived or left while the archive was written. */
  | 'stale'
  /** The finished file did not read back as what was written. */
  | 'unverified'
  | 'unexpected'

export type ExportToFolderOutcome =
  | {
      readonly kind: 'written'
      readonly folder: string
      readonly entries: number
      readonly skipped: number
      readonly bytes: number
      readonly sha256: string
    }
  | { readonly kind: 'failed'; readonly folder: string; readonly code: ExportToFolderFailure }

export interface ExportAlbumToFolderDeps {
  readonly photos: PhotoRepository
  readonly guestbook: GuestbookRepository
  readonly guests: GuestRepository
  readonly media: MediaStore
  readonly archive: ArchiveWriter
  readonly streamHasher: StreamHasher
  readonly folders: ExportFolderStore
  readonly clock: Clock
  readonly logger: Logger
  /** Free bytes where the copy is written, or `null` when it cannot be read (a refusal). */
  readonly freeDiskBytes: () => Promise<number | null>
  readonly minFreeDiskBytes: number
}

export type ExportAlbumToFolder = (event: Event, folder: string) => Promise<ExportToFolderOutcome>

const FAILURE_OF: Readonly<Record<string, ExportToFolderFailure>> = {
  'export.corrupt': 'corrupt',
  'export.noRoom': 'noRoom',
}

export const makeExportAlbumToFolder = ({
  photos,
  guestbook,
  guests,
  media,
  archive,
  streamHasher,
  folders,
  clock,
  logger,
  freeDiskBytes,
  minFreeDiskBytes,
}: ExportAlbumToFolderDeps): ExportAlbumToFolder => {
  const albumRows = async (event: Event): Promise<number> => {
    const counts = await photos.countsByStatus(event.id)
    return ALBUM_STATUSES.reduce((sum, status) => sum + counts[status], 0)
  }

  const run = async (event: Event, folder: string): Promise<ExportToFolderOutcome> => {
    const failed = async (code: ExportToFolderFailure): Promise<ExportToFolderOutcome> => {
      await folders.delete(folder)
      logger.warn('album copy failed', { eventId: event.id, code })
      return { kind: 'failed', folder, code }
    }
    if (!retentionApplies(event.status)) return { kind: 'failed', folder, code: 'notClosed' }

    // Check 1: the room, before a byte is written.
    const rowsAtStart = await albumRows(event)
    const estimate = estimateExportBytes(await photos.totalBytes(event.id), rowsAtStart)
    if (!checkExportRoom(await freeDiskBytes(), estimate, minFreeDiskBytes).ok) {
      return { kind: 'failed', folder, code: 'noRoom' }
    }

    // Checks 2 and 3 while writing. The manifest is kept as it goes by, to be written beside the zip.
    const { entries, report } = albumArchiveOf(
      { photos, guestbook, guests, media, streamHasher, clock, logger },
      event,
    )
    let manifest = ''
    const keepingManifest = async function* (): AsyncIterable<ArchiveEntry> {
      for await (const entry of entries) {
        if (!entry.name.endsWith(`/${MANIFEST_NAME}`)) {
          yield entry
          continue
        }
        yield {
          ...entry,
          bytes: (async function* () {
            const decoder = new TextDecoder()
            for await (const chunk of entry.bytes) {
              manifest += decoder.decode(chunk, { stream: true })
              yield chunk
            }
          })(),
        }
      }
    }

    const writtenHash = streamHasher.start()
    const hashedZip = async function* (): AsyncIterable<Uint8Array> {
      const guarded = guardedEntries(keepingManifest(), { freeDiskBytes, minFreeDiskBytes })
      for await (const chunk of archive.stream(guarded)) {
        writtenHash.update(chunk)
        yield chunk
      }
    }

    let size: number
    try {
      size = await folders.write(folder, hashedZip(), { maxBytes: Number.MAX_SAFE_INTEGER })
    } catch (error) {
      if (!DomainError.is(error)) logger.error('album copy write failed', { eventId: event.id })
      return failed((DomainError.is(error) ? FAILURE_OF[error.code] : undefined) ?? 'unexpected')
    }
    const sha256 = writtenHash.digestHex()
    const found = report()

    if ((await albumRows(event)) !== rowsAtStart || found.photos + found.missing !== rowsAtStart) {
      return failed('stale')
    }

    const reader: ArchiveReader = {
      stat: () => folders.stat(folder),
      openRead: (range) => folders.openRead(folder, range),
    }
    if (
      !(await verifiedOnDisk(reader, streamHasher, { bytes: size, sha256, entries: found.written }))
    ) {
      return failed('unverified')
    }

    await folders.writeManifest(folder, manifest)
    return {
      kind: 'written',
      folder,
      entries: found.written,
      skipped: found.missing,
      bytes: size,
      sha256,
    }
  }

  return async (event, folder) => {
    try {
      return await run(event, folder)
    } catch (error) {
      logger.error('album copy failed unexpectedly', {
        eventId: event.id,
        error: error instanceof Error ? error.message : String(error),
      })
      await folders.delete(folder).catch(() => undefined)
      return { kind: 'failed', folder, code: 'unexpected' }
    }
  }
}
