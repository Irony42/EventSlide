import type { UploadItem, UploadItemState } from './useUploadQueue'

/**
 * What the upload queue knows about the batch it holds, as pure rules.
 *
 * Whether a batch is finished, and how it went, is the one fact the pane's summary line rests
 * on. It lives here, beside the queue that owns the rows, and not in the component that draws
 * them: the component renders what this says and decides nothing.
 *
 * "The batch" is whatever the queue holds. A photo that has arrived leaves the queue when the
 * guest picks the next ones (`add` in `useUploadQueue`), so the rows are only ever one batch:
 * the settled ones of the last, and the new ones, which are not settled.
 */

/** The two states that mean the photo is in the event. Neither is a failure. */
const ARRIVED: readonly UploadItemState[] = ['done', 'duplicate']

export interface BatchSummary {
  /**
   * Every row has arrived and there is at least one: nothing is queued, sending, waiting for
   * the network or failed. The only state in which the pane may fold its rows into one line.
   *
   * A single failure keeps this `false` for the whole batch, so the row that carries its
   * "Réessayer" is never folded away. Retried and sent, it becomes `true`.
   */
  readonly settledOk: boolean
  /** How many photos arrived, duplicates included. */
  readonly arrived: number
  /** How many of those the event already held (`duplicate`). */
  readonly alreadyThere: number
  /**
   * The server's ids of the photos that arrived, for finding them in "Vos envois".
   *
   * A photo delivered later by the outbox is settled by the entry's id and the server's answer
   * is not carried back with it, so it counts as arrived and has no id here.
   */
  readonly photoIds: readonly string[]
}

export const summarizeBatch = (items: readonly UploadItem[]): BatchSummary => {
  const arrivedItems = items.filter((item) => ARRIVED.includes(item.state))
  return {
    settledOk: items.length > 0 && arrivedItems.length === items.length,
    arrived: arrivedItems.length,
    alreadyThere: arrivedItems.filter((item) => item.state === 'duplicate').length,
    photoIds: arrivedItems.flatMap((item) => (item.photoId === null ? [] : [item.photoId])),
  }
}
