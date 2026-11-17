import type { ArchiveState } from '../clients/archiveState'
import { DomainError } from '../shared/errors'
import type { EventId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import {
  canTransitionExport,
  type ExportFailureCode,
  type ExportStaleReason,
  type ExportStatus,
} from './albumExportStatus'

/**
 * The one verified archive of an event (spec 22). Plain data: every move is a pure function below,
 * which the SQLite adapter and the in-memory fake both mirror (the contract suite holds them to it).
 *
 * No guest text is stored: the archive's contents are read again from the album when it is written.
 * `entries` counts the files written (photographs, clips and the guestbook, **not** the manifest),
 * and `skipped` the rows whose file was missing from the disk: the archive is then **verified but
 * incomplete**, and says how incomplete.
 */
export interface AlbumExport {
  readonly eventId: EventId
  readonly status: ExportStatus
  readonly requestedAt: Date
  readonly requestedBy: UserId | null
  readonly startedAt: Date | null
  readonly sealedAt: Date | null
  readonly expiresAt: Date | null
  readonly entries: number | null
  readonly skipped: number | null
  readonly bytes: number | null
  /** SHA-256 of the whole ZIP, lowercase hex: what the download's `ETag` carries. */
  readonly sha256: string | null
  /** The last time a `200` carried the whole file to the host's socket. Never a `206`. */
  readonly servedAt: Date | null
  readonly staleReason: ExportStaleReason | null
  /** The latest fact that voids the archive; compared with `startedAt` when a write ends. */
  readonly invalidatedAt: Date | null
  readonly failure: ExportFailureCode | null
}

const illegal = (from: ExportStatus, to: ExportStatus): DomainError =>
  DomainError.conflict('export.illegalTransition', { from, to })

/** A fresh request. It replaces whatever the row held: a new archive starts from nothing. */
export const requestExport = (eventId: EventId, by: UserId | null, now: Date): AlbumExport => ({
  eventId,
  status: 'queued',
  requestedAt: now,
  requestedBy: by,
  startedAt: null,
  sealedAt: null,
  expiresAt: null,
  entries: null,
  skipped: null,
  bytes: null,
  sha256: null,
  servedAt: null,
  staleReason: null,
  invalidatedAt: null,
  failure: null,
})

export const startExport = (archive: AlbumExport, now: Date): Result<AlbumExport, DomainError> =>
  canTransitionExport(archive.status, 'running')
    ? ok({ ...archive, status: 'running', startedAt: now })
    : err(illegal(archive.status, 'running'))

/** What a sealed archive is: what was written, what was missing, how big, which digest. */
export interface ExportSeal {
  readonly entries: number
  readonly skipped: number
  readonly bytes: number
  readonly sha256: string
  readonly expiresAt: Date
}

/** How a write ended: sealed, voided by a change of the album, or given up with a closed code. */
export type ExportVerdict =
  | { readonly kind: 'sealed'; readonly seal: ExportSeal }
  | { readonly kind: 'stale'; readonly reason: ExportStaleReason }
  | { readonly kind: 'failed'; readonly code: ExportFailureCode }

/**
 * What the final write of a build did: `sealed` / `stale` / `failed` were recorded; `superseded`: the
 * row was deleted or replaced by a new request meanwhile, so nothing was written and the caller
 * deletes the file it produced.
 */
export type ExportFinish = 'sealed' | 'stale' | 'failed' | 'superseded'

/** The reason recorded while the write ran is not kept apart; `photoRemoved` is the safe one. */
const staleReasonOf = (archive: AlbumExport): ExportStaleReason =>
  archive.staleReason ?? 'photoRemoved'

/**
 * A build ended. **A fact that voided the archive after the write started wins over the file just
 * produced**: the archive is `stale`, never `sealed`, and the caller deletes the file. The instant is
 * compared inclusively (`>=`): a removal in the very millisecond the write started is on the safe
 * side.
 */
export const settleExport = (
  archive: AlbumExport,
  verdict: ExportVerdict,
  now: Date,
): Result<AlbumExport, DomainError> => {
  if (verdict.kind === 'failed') {
    return canTransitionExport(archive.status, 'failed')
      ? ok({ ...archive, status: 'failed', failure: verdict.code })
      : err(illegal(archive.status, 'failed'))
  }
  if (verdict.kind === 'stale') {
    return canTransitionExport(archive.status, 'stale')
      ? ok({ ...archive, status: 'stale', staleReason: verdict.reason })
      : err(illegal(archive.status, 'stale'))
  }
  const voided =
    archive.invalidatedAt !== null &&
    archive.startedAt !== null &&
    archive.invalidatedAt.getTime() >= archive.startedAt.getTime()
  const to: ExportStatus = voided ? 'stale' : 'sealed'
  if (!canTransitionExport(archive.status, to)) return err(illegal(archive.status, to))
  return ok(
    voided
      ? { ...archive, status: 'stale', staleReason: staleReasonOf(archive) }
      : { ...archive, status: 'sealed', sealedAt: now, ...verdict.seal },
  )
}

/** What the final write did when it took `settled` as the row's new state. */
export const finishOfExport = (settled: AlbumExport): ExportFinish =>
  settled.status === 'sealed' || settled.status === 'stale' || settled.status === 'failed'
    ? settled.status
    : 'superseded'

/**
 * A fact voids the archive (spec 22, section 7). Idempotent: `sealed` becomes `stale` (the caller
 * deletes the file); `queued` and `running` only record the instant, and the build decides at its end;
 * a `stale` or `failed` archive is left as it is.
 */
export const invalidateExport = (
  archive: AlbumExport,
  reason: ExportStaleReason,
  now: Date,
): AlbumExport => {
  if (archive.status === 'sealed') {
    return { ...archive, status: 'stale', invalidatedAt: now, staleReason: reason }
  }
  if (archive.status === 'queued' || archive.status === 'running') {
    return { ...archive, invalidatedAt: now, staleReason: reason }
  }
  return archive
}

/**
 * The whole file went out on a `200` (rule 5): only a sealed archive can be marked, and the expiry
 * moves up to 48 hours after the send when that is sooner.
 */
export const serveExport = (
  archive: AlbumExport,
  at: Date,
  expiresAt: Date,
): Result<AlbumExport, DomainError> =>
  archive.status === 'sealed'
    ? ok({ ...archive, servedAt: at, expiresAt })
    : err(illegal(archive.status, 'sealed'))

/**
 * May the host delete the album **without typing the word** (spec 22, section 3, step 6)?
 *
 * Only when a **complete** archive was **sent in full after it was sealed**: sealed (not stale, not
 * failed), nothing skipped, and `servedAt` at or after `sealedAt`. The server saw the last byte
 * leave; it cannot know the host's disk received it, which is why the host is told to check the file.
 */
export const canDeleteWithoutConfirmation = (archive: AlbumExport | null): boolean =>
  archive !== null &&
  archive.status === 'sealed' &&
  archive.skipped === 0 &&
  archive.sealedAt !== null &&
  archive.servedAt !== null &&
  archive.servedAt.getTime() >= archive.sealedAt.getTime()

/** What the box held for an album, the one word of the purge's log line (`archive=…`). */
export const archiveStateOf = (archive: AlbumExport | null): ArchiveState => {
  if (archive === null) return 'none'
  if (archive.status === 'stale') return 'stale'
  if (archive.status !== 'sealed') return 'none'
  if (archive.skipped !== null && archive.skipped > 0) return 'incomplete'
  return canDeleteWithoutConfirmation(archive) ? 'served' : 'sealed'
}
