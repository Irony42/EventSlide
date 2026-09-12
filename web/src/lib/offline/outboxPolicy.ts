import type { OutboxEntry } from './outbox'

/**
 * When a stored photo is still worth sending, and when it is not.
 *
 * Pure, and separate from both the store and the drain, because these are the only
 * decisions in the feature that are genuinely rules rather than plumbing — and
 * because a service worker is the worst possible place to debug an off-by-one.
 */

/**
 * How long a photo is kept before it is dropped unsent.
 *
 * A wedding is one evening. A photo that has not found a connection in twelve hours
 * is a photo whose event is over, and pushing it to a wall the morning after is worse
 * than losing it — the guests have gone home and the host has already downloaded the
 * album.
 */
export const MAX_AGE_MS = 12 * 60 * 60 * 1000

/**
 * How many deferred attempts an entry gets.
 *
 * A runaway backstop, not the delivery bound — {@link MAX_AGE_MS} is the bound, and
 * this number is deliberately far too large to be reached by an ordinary bad evening.
 *
 * It was twelve, and twelve was wrong in a way that only showed up once the drain
 * retried on a timer rather than only on an `online` event: a guest on a saturated
 * access point burns an attempt every minute, so a twelve-attempt ceiling threw their
 * photo away after quarter of an hour of exactly the conditions this feature exists
 * for. Whichever of the two limits is reached first still drops the entry; this one is
 * now the one that effectively never is.
 */
export const MAX_ATTEMPTS = 200

/**
 * How many photos one event may hold on a device.
 *
 * A phone's storage quota is not the guest's problem to manage, and thirty photos at
 * 2 MB each is already 60 MB of someone's evening held hostage by a bad router. Past
 * this the oldest entry is dropped: the guest can see their queue and re-add, and a
 * write that fails silently at the browser's own quota is far worse.
 */
export const MAX_ENTRIES_PER_EVENT = 40

/**
 * How long one drain may hold an entry before another may take it.
 *
 * Long enough for a large photo on a slow connection, short enough that a service
 * worker killed mid-upload does not strand it. A lease that outlived the evening
 * would turn a crash into permanent data loss.
 */
export const CLAIM_LEASE_MS = 2 * 60 * 1000

/** Backoff between drains of the same entry, capped. Deterministic: no jitter, because
 *  the drain is triggered by connectivity rather than by a timer, and two phones
 *  colliding is not the failure mode here. */
const BACKOFF_STEPS_MS: readonly number[] = [0, 2_000, 5_000, 15_000, 30_000, 60_000]

export const backoffMs = (attempts: number): number => {
  if (attempts <= 0) return 0
  const last = BACKOFF_STEPS_MS[BACKOFF_STEPS_MS.length - 1] ?? 0
  return BACKOFF_STEPS_MS[attempts] ?? last
}

export const isExpired = (entry: OutboxEntry, now: number): boolean =>
  now - entry.enqueuedAt >= MAX_AGE_MS

export const isExhausted = (entry: OutboxEntry): boolean => entry.attempts >= MAX_ATTEMPTS

/** Whether this entry must be dropped rather than sent. */
export const isSpent = (entry: OutboxEntry, now: number): boolean =>
  isExpired(entry, now) || isExhausted(entry)

/** Whether another drain still holds this entry. */
export const isLeased = (entry: OutboxEntry, now: number, leaseMs = CLAIM_LEASE_MS): boolean =>
  entry.claimedAt !== null && now - entry.claimedAt < leaseMs

/**
 * Whether enough time has passed since the last deferral.
 *
 * Measured from `lastAttemptAt`, which the store stamps on every release, so a first
 * attempt is never delayed and a fifteenth does not hammer a router that is already
 * on its knees.
 */
export const isDue = (entry: OutboxEntry, now: number): boolean => {
  if (entry.lastAttemptAt === null) return true
  return now - entry.lastAttemptAt >= backoffMs(entry.attempts)
}

/**
 * How long until this entry is worth another try, in milliseconds.
 *
 * `0` when it is actionable now. What the drain reports back so the screen can arm one
 * timer for the right moment instead of polling — a poll would wake a phone in
 * somebody's pocket every thirty seconds for a whole evening, which is a battery cost
 * paid by every guest to serve the few with a queue.
 */
export const dueInMs = (entry: OutboxEntry, now: number, leaseMs = CLAIM_LEASE_MS): number => {
  const untilLeaseEnds = entry.claimedAt === null ? 0 : entry.claimedAt + leaseMs - now
  const untilDue =
    entry.lastAttemptAt === null ? 0 : entry.lastAttemptAt + backoffMs(entry.attempts) - now
  // Whichever wait is shorter would be wrong: the entry is actionable only once it is
  // both out of backoff and out of another drain's hands.
  return Math.max(0, untilLeaseEnds, untilDue)
}

/**
 * Whether a failed foreground upload is worth storing rather than reporting.
 *
 * A dropped connection and a server that could not answer are both "not this photo's
 * fault, and likely fine in five minutes". Everything else in the 4xx range is the
 * request itself being wrong — an unsupported format, a revoked guest, a closed event
 * — and those fail identically on the tenth attempt as on the first, so queueing them
 * would spend the guest's battery proving it.
 *
 * `429` is deliberately not queued: the guest is standing there pressing the button,
 * the limit is per minute, and "réessayez dans un instant" is the honest answer.
 */
export const shouldQueue = (status: number): boolean => status === 0 || status >= 500
