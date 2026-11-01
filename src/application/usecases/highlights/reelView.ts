import type { ReelJob } from '../../../domain/highlights/reelJob'
import type { ReelStatus } from '../../../domain/highlights/reelStatus'

/**
 * What the host's panel is told of the montage (spec 08): numbers and a state, nothing else. No
 * photograph id, no digest.
 *
 * `stale` carries no reason, whether a photograph was deleted, hidden, refused, erased by its
 * guest or taken down by the operator: the host must not learn that the operator acted. A `done`
 * row whose file is missing (a restored backup, a purged disk) is read as `stale` here as well.
 */
export interface ReelView {
  readonly status: ReelStatus
  /** The photographs in the montage: those actually shown once it is made. */
  readonly photoCount: number
  readonly durationMs: number | null
  readonly byteSize: number | null
  /** Only for `failed`. */
  readonly failureCode: string | null
  readonly updatedAt: Date
}

export const toReelView = (
  job: ReelJob,
  fileIsThere: boolean,
  secondsPerPhoto: number,
): ReelView => {
  // The file the montage can be served from: finished, and still on the disk.
  const output = job.status === 'done' && fileIsThere ? job.output : null
  const status: ReelStatus = job.status === 'done' && output === null ? 'stale' : job.status

  return {
    status,
    // A finished montage says how many photographs it really holds (one whose file was missing is
    // skipped) from its own length; the others say how many were asked for.
    photoCount:
      output === null
        ? job.photoIds.length
        : Math.round(output.durationMs / (secondsPerPhoto * 1000)),
    durationMs: output?.durationMs ?? null,
    byteSize: output?.byteSize ?? null,
    failureCode: status === 'failed' ? job.failureCode : null,
    updatedAt: job.updatedAt,
  }
}
