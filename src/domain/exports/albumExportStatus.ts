/**
 * The life of the one archive a host asks the box to prepare (spec 22).
 *
 * A machine of its own, like `AlbumBookStatus` and for the same reason: an archive that is still
 * being written is machinery, not a moderation decision.
 *
 * ```
 *   queued ──claim──► running ──seal──► sealed ──invalidate / album changed──► stale
 *     ▲                  │  └──fail──► failed
 *     │                  └──voided while it was written──► stale
 *     └──recover / a new request (from sealed, stale or failed)
 * ```
 *
 * `stale` is an archive that **must not be served any more**: something it holds was removed, or
 * the album it describes is not the album any more. Its file is deleted at once. `sealed` is the
 * only status that has a file to give.
 */
export const EXPORT_STATUSES = ['queued', 'running', 'sealed', 'stale', 'failed'] as const

export type ExportStatus = (typeof EXPORT_STATUSES)[number]

const ALLOWED_TRANSITIONS: Readonly<Record<ExportStatus, readonly ExportStatus[]>> = {
  queued: ['running'],
  // `queued` is the recovery after a crash.
  running: ['queued', 'sealed', 'failed', 'stale'],
  // `queued` is "make it again".
  sealed: ['stale', 'queued'],
  failed: ['queued'],
  stale: ['queued'],
}

export const isExportStatus = (value: unknown): value is ExportStatus =>
  typeof value === 'string' && (EXPORT_STATUSES as readonly string[]).includes(value)

/** A no-op transition is refused: a second claim of a running archive is two writers on one file. */
export const canTransitionExport = (from: ExportStatus, to: ExportStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to)

/** Work is queued or under way: the host may not ask for another archive now. */
export const isExportActive = (status: ExportStatus): boolean =>
  status === 'queued' || status === 'running'

/** Only a sealed archive has a file to serve. */
export const exportHasFile = (status: ExportStatus): boolean => status === 'sealed'

/** Why an archive could not be made. A closed list: never free text, never a path. */
export const EXPORT_FAILURE_CODES = [
  /** A stored file is not what its digest says: the disk corrupted it. Nothing is sealed. */
  'corrupt',
  /** The disk ran short of room while writing (or before). */
  'noRoom',
  /** The archive outgrew `EXPORT_MAX_BYTES`. */
  'tooLarge',
  /** The event is no longer one anybody may take an archive of. */
  'unavailable',
  /** The finished file did not pass the re-reading (the disk truncated or altered it). */
  'unverified',
  'unexpected',
] as const
export type ExportFailureCode = (typeof EXPORT_FAILURE_CODES)[number]

export const isExportFailureCode = (value: unknown): value is ExportFailureCode =>
  typeof value === 'string' && (EXPORT_FAILURE_CODES as readonly string[]).includes(value)

/**
 * Why an archive stopped being valid. Neutral on purpose: it never says whether a guest, the host
 * or the operator acted.
 */
export const EXPORT_STALE_REASONS = [
  'photoRemoved',
  'guestErased',
  'guestbookChanged',
  'takenDown',
  'reopened',
  /** A photograph arrived or left while the archive was being written. */
  'albumChanged',
  /** A sealed row whose file is gone from the disk (a restored backup, a manual clean-up). */
  'fileMissing',
] as const
export type ExportStaleReason = (typeof EXPORT_STALE_REASONS)[number]

export const isExportStaleReason = (value: unknown): value is ExportStaleReason =>
  typeof value === 'string' && (EXPORT_STALE_REASONS as readonly string[]).includes(value)
