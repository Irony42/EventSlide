import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import { MS_PER_DAY } from '../shared/time'

/** Zip's "stored" mode adds roughly this much per entry (local header, central header, name). */
export const ZIP_BYTES_PER_ENTRY = 100

/**
 * What an archive of this album will weigh, estimated **conservatively** before a byte is written
 * (spec 22, section 9): the album's stored bytes (which count every rendition, every status and the
 * thumbnails, so they over-estimate) plus the zip's per-entry overhead. Refusing early is cheap;
 * running out of disk at the billionth byte is not.
 */
export const estimateExportBytes = (storedBytes: number, rows: number): number =>
  storedBytes + rows * ZIP_BYTES_PER_ENTRY

/**
 * Is there room to write the archive and still leave the minimum free? `freeBytes` is `null` when the
 * disk could not be read, which is **a refusal, never "assume there is room"** (`evaluateDiskSpace`).
 */
export const checkExportRoom = (
  freeBytes: number | null,
  estimate: number,
  minFreeBytes: number,
): Result<void, DomainError> =>
  freeBytes !== null && freeBytes >= estimate + minFreeBytes
    ? ok(undefined)
    : err(DomainError.conflict('export.noRoom'))

/** One archive may not exceed `maxBytes` (inclusive: exactly `maxBytes` is allowed). */
export const checkExportBytes = (estimate: number, maxBytes: number): Result<void, DomainError> =>
  estimate > maxBytes
    ? err(DomainError.quotaExceeded('export.tooLarge', { maxBytes }))
    : ok(undefined)

/** Archives sealed or in the making, all together, may not exceed `maxTotalBytes` (inclusive). */
export const checkExportTotal = (
  heldBytes: number,
  estimate: number,
  maxTotalBytes: number,
): Result<void, DomainError> =>
  heldBytes + estimate > maxTotalBytes ? err(DomainError.conflict('export.noRoom')) : ok(undefined)

/** The rolling day over which an event's archive requests are counted. */
export const EXPORT_WINDOW_MS = MS_PER_DAY

export const exportWindowStart = (now: Date): Date => new Date(now.getTime() - EXPORT_WINDOW_MS)

/**
 * May another archive be prepared, given how many were asked for in the window? Refuses **at** the
 * limit, not after it: three a day means the fourth is refused, before anything is written.
 */
export const checkExportDailyLimit = (
  requestsInWindow: number,
  maxPerDay: number,
  retryAfterSeconds: number,
): Result<void, DomainError> =>
  requestsInWindow >= maxPerDay
    ? err(
        DomainError.rateLimited('export.dailyLimitReached', { max: maxPerDay, retryAfterSeconds }),
      )
    : ok(undefined)

/** Seconds until the oldest request of the window leaves it: what a refused host is told to wait. */
export const exportRetryAfterSeconds = (oldestInWindow: Date, now: Date): number =>
  Math.max(1, Math.ceil((oldestInWindow.getTime() + EXPORT_WINDOW_MS - now.getTime()) / 1000))
