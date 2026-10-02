/**
 * Whether the box has enough free disk space left to accept another upload (G3-06 /
 * P4-10).
 *
 * Pure arithmetic over numbers `statfs` already produced, for the same reason
 * `src/domain/events/quota.ts` is: the decision has to be taken the same way everywhere
 * it is asked, and the only way to guarantee that is to ask it in exactly one place.
 * Here that is two call sites — the per-request guard in
 * `src/interface/http/middleware/diskSpaceGuard.ts` and the informational check
 * `GET /api/ready` reports — and both read this function rather than repeating the
 * comparison.
 *
 * **Unreadable is treated as insufficient, never as "assume there is room".** A path
 * `statfs` could not read is the directory gone, a permission error, or a filesystem the
 * platform does not support `statfs` on — every one of those is itself a storage
 * problem, and guessing that there is space behind it is the opposite of what this guard
 * exists to do. The box's own posture is already fail-closed everywhere else (a boot
 * with no secret refuses rather than runs weakened; `GET /api/ready` answers
 * `unavailable` rather than `ok` when a probe throws), and this is the same call made
 * about a disk nobody can currently measure.
 */

/** One checked path's answer, before the policy is applied to it. */
export type FreeBytesReading = number | null

export interface DiskSpaceStatus {
  /** Whether every checked path is readable and at or above `minFreeBytes`. */
  readonly sufficient: boolean
  /**
   * The tightest margin across every checked path, for `GET /api/ready` to report — or
   * `null` when at least one path could not be read, in which case there is no single
   * number that honestly describes the box's margin.
   */
  readonly freeBytes: number | null
}

/**
 * G3-06's delta from P4-10: without a separate `SCRATCH_ROOT` (P4-04), the directory
 * holding `DATABASE_PATH` and `MEDIA_ROOT` are the two filesystems a guest's upload can
 * still fill — `MEDIA_ROOT` because it is also where a clip stages while it uploads.
 * Both must clear `minFreeBytes`, because the tighter of the two is where the box would
 * actually run out first.
 */
export const evaluateDiskSpace = (
  freeBytesByPath: readonly FreeBytesReading[],
  minFreeBytes: number,
): DiskSpaceStatus => {
  const readable = freeBytesByPath.filter((bytes): bytes is number => bytes !== null)
  if (readable.length !== freeBytesByPath.length) {
    return { sufficient: false, freeBytes: null }
  }

  const freeBytes = Math.min(...readable)
  return { sufficient: freeBytes >= minFreeBytes, freeBytes }
}
