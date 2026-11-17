import type { UploadItem } from './hooks/useUploadQueue'

/**
 * The roll of a disposable-camera evening (spec 23): how many poses a guest has left, as the phone
 * counts them while photographs are on their way.
 *
 * **The server is the reference.** `taken` is the count its upload cap uses, and a photograph past
 * the cap is refused there (`event.photoLimitReached`) whatever this file says. What the phone adds
 * is the photographs the server cannot know yet, so a guest on bad Wi-Fi does not queue thirty and
 * find three refused at reconnection: the ones chosen but not sent, the ones in flight, the ones the
 * outbox holds for the network. Never a rule: a wrong answer here costs a refusal in words.
 */

/** The roll as `GET /photos/mine` carries it, or `null` for an event with no cap. */
export interface Shots {
  readonly max: number
  readonly taken: number
}

/**
 * The photographs this phone owes the server and the server has not counted.
 *
 * A row the queue handed to the outbox (`queued`) is the same photograph as the outbox entry, so
 * only the outbox's count is taken for it: counting both would charge that pose twice. A row that
 * failed and cannot be retried is not owed (the guest can only drop it), and one that arrived
 * (`done`, `duplicate`) is counted by the server at its next read, not here.
 */
export const heldPoses = (items: readonly UploadItem[], outboxWaiting: number): number =>
  outboxWaiting +
  items.filter(
    (item) =>
      item.state === 'pending' ||
      item.state === 'preparing' ||
      item.state === 'uploading' ||
      (item.state === 'failed' && item.retryable),
  ).length

/** Poses left: `null` with no cap, never negative. */
export const posesLeft = (shots: Shots | null | undefined, held: number): number | null =>
  shots === null || shots === undefined ? null : Math.max(0, shots.max - shots.taken - held)

/**
 * What a pick may add: the first `left` photographs, in the order the picker gave them, and how
 * many were set aside. With no cap (`left` is `null`) everything is kept.
 */
export const keepFirst = (
  files: readonly File[],
  left: number | null,
): { readonly kept: readonly File[]; readonly dropped: number } =>
  left === null || files.length <= left
    ? { kept: files, dropped: 0 }
    : { kept: files.slice(0, left), dropped: files.length - left }
