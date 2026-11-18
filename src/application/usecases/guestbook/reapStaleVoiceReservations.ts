import type { GuestbookVoiceRepository } from '../../ports/guestbookVoiceRepository'
import type { Clock } from '../../ports/clock'
import type { Logger } from '../../ports/logger'

/**
 * Delete the voice messages that will never be heard, and the rows that only keep a place
 * (spec 25, rule 2). Two kinds, one periodic pass, modelled on `makeReapStaleReservations`.
 *
 * **A stale reservation.** A `reserved` voice is the moment between "this upload is admitted" and
 * "its source is on the disk", normally a local write. One that outlives it belonged to a request
 * that died between `admitVoice` and `media.put`, and it is holding three things it should not:
 * a charge against the event's quota for bytes that may not exist; **one of the guest's three
 * places** and a slot of the queue's depth; and **the unique index**, which also blocks the guest's
 * own retry of the same recording. Both rows go (the entry and its voice), **rows only**: the bytes
 * are `sweepOrphanedMedia`'s business, because the delete is transactional and an unlink after it
 * would race a re-upload that won the freed digest.
 *
 * **A failed voice older than a day.** Its bytes are already gone, and it only exists to tell the
 * guest "your message could not be saved" (and a `failed` voice counts in no ceiling), so once the
 * guest has had a day to see it the row is noise.
 *
 * It runs on a short interval and never at boot only: reaping a reservation has no constraint that
 * a `running` voice has (whose recovery is startup-only, a dead process being true then and false
 * at any other moment).
 */

export interface ReapStaleVoiceReservationsPolicy {
  /**
   * How long a reservation may sit before it is treated as wreckage. Generous against the single
   * local write it protects: a rolling restart can overlap two containers, and deleting a
   * reservation the old one is still filling would cost that guest their message for nothing.
   */
  readonly reservationTimeoutMs: number
  /** How long a failed voice stays to be told to its guest: a day. */
  readonly failedRetentionMs: number
}

export interface ReapStaleVoiceReservationsDeps {
  readonly voices: GuestbookVoiceRepository
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: ReapStaleVoiceReservationsPolicy
}

export interface ReapStaleVoiceReservationsReport {
  /** Reservations deleted. Zero on a healthy box, every time, for ever. */
  readonly reserved: number
  /** Failed voices deleted after their day. */
  readonly failed: number
}

export type ReapStaleVoiceReservations = () => Promise<ReapStaleVoiceReservationsReport>

export const makeReapStaleVoiceReservations = ({
  voices,
  clock,
  logger,
  policy,
}: ReapStaleVoiceReservationsDeps): ReapStaleVoiceReservations => {
  return async () => {
    const now = clock.now().getTime()
    const reserved = await voices.reapReserved(new Date(now - policy.reservationTimeoutMs))
    const failed = await voices.reapFailed(new Date(now - policy.failedRetentionMs))

    if (reserved.length > 0) {
      // Worth a line: each one is a request that died holding an upload, and a figure that keeps
      // climbing is a box being killed mid-write.
      logger.info('reaped voice reservations whose bytes never arrived', {
        reaped: reserved.length,
        entryIds: reserved.map((entry) => entry.id).join(' '),
      })
    }

    return { reserved: reserved.length, failed: failed.length }
  }
}
