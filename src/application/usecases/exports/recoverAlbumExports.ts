import type { AlbumExportRepository } from '../../ports/albumExportRepository'
import type { Logger } from '../../ports/logger'

/**
 * Crash recovery for the archive queue, run once at startup.
 *
 * An archive still `running` when the process boots was being written by one that died (the queue
 * has a single in-process worker, so nothing else can hold it). It goes back to `queued`, and the
 * temporary file it left is swept (`sweepAlbumExports`).
 */
export interface RecoverAlbumExportsDeps {
  readonly exports: Pick<AlbumExportRepository, 'recoverRunning'>
  readonly logger: Logger
}

export type RecoverAlbumExports = () => Promise<{ readonly requeued: number }>

export const makeRecoverAlbumExports =
  ({ exports, logger }: RecoverAlbumExportsDeps): RecoverAlbumExports =>
  async () => {
    const requeued = await exports.recoverRunning()
    if (requeued > 0) {
      logger.warn('album archives left running by a previous process were re-queued', { requeued })
    }
    return { requeued }
  }
