import type { RequestHandler } from 'express'
import type { DiskSpaceChecker } from '../../../application/ports/diskSpace'
import { evaluateDiskSpace } from '../../../domain/shared/diskSpaceGuard'
import { DomainError } from '../../../domain/shared/errors'
import { asyncHandler } from './asyncHandler'
import { errorBody } from '../presenters/send'

/**
 * The free-disk-space guard on uploads (G3-06 / P4-10).
 *
 * Refuses **before** multer reads a single byte of the body, so a box that is nearly
 * out of room never buffers — or, for a clip, writes to disk — the request it is about
 * to refuse anyway. `413 storage.boxFull`, the `quotaExceeded` kind: this is a limit
 * deliberately stopping the action, exactly like the event byte quota, and not the
 * service-availability `503` the three existing direct-503 call sites answer with —
 * an upload a guest sent is refused because of what the guest sent, never because the
 * box itself is unready.
 *
 * No `Retry-After`: unlike the concurrency limiter beside it, which clears itself the
 * moment one of the requests ahead of it finishes, nothing about *this* refusal is on a
 * timer a client could usefully wait out.
 */
export interface DiskSpaceGuardOptions {
  readonly checker: DiskSpaceChecker
  /**
   * Every directory that must clear `minFreeBytes`: the one holding `DATABASE_PATH`
   * and `MEDIA_ROOT`. G3-06's delta from P4-10 is exactly this pair — without a
   * separate `SCRATCH_ROOT` (P4-04), `MEDIA_ROOT` is also where a clip stages while it
   * uploads, so checking it already covers the scratch directory too.
   */
  readonly paths: readonly string[]
  readonly minFreeBytes: number
}

export const createDiskSpaceGuard = ({
  checker,
  paths,
  minFreeBytes,
}: DiskSpaceGuardOptions): RequestHandler =>
  asyncHandler(async (_req, res, next) => {
    const freeBytesByPath = await Promise.all(paths.map((path) => checker.freeBytes(path)))
    const status = evaluateDiskSpace(freeBytesByPath, minFreeBytes)

    if (!status.sufficient) {
      res.status(413).json(errorBody(DomainError.quotaExceeded('storage.boxFull')))
      return
    }

    next()
  })
