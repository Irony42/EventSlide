import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import type { Logger } from '../../ports/logger'

/**
 * Crash recovery for the book queue, run once at startup.
 *
 * A book still `running` when the process boots was being made by one that died (the queue has a
 * single in-process worker, so nothing else can hold it). It goes back to `queued`, and the
 * temporary file it left is swept with the orphans.
 */
export interface RecoverAlbumBooksDeps {
  readonly books: Pick<AlbumBookRepository, 'recoverRunning'>
  readonly logger: Logger
}

export type RecoverAlbumBooks = () => Promise<{ readonly requeued: number }>

export const makeRecoverAlbumBooks =
  ({ books, logger }: RecoverAlbumBooksDeps): RecoverAlbumBooks =>
  async () => {
    const requeued = await books.recoverRunning()
    if (requeued > 0)
      logger.warn('photo books left running by a previous process were re-queued', { requeued })
    return { requeued }
  }
