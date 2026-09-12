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
 * A runaway backstop, not the delivery bound — {@link MAX_AGE_MS} is the bound.
 *
 * It was twelve, and twelve was wrong in a way that only showed up once the drain
 * retried on a timer rather than only on an `online` event: a guest on a saturated
 * access point burns an attempt every minute, so a twelve-attempt ceiling threw their
 * photo away after quarter of an hour of exactly the conditions this feature exists
 * for. Two hundred was then wrong for the same reason with the arithmetic done once
 * instead of not at all: the backoff caps at a minute, so two hundred attempts is under
 * four hours, and a wedding's bad window is 19:00 to 23:00. Twelve hours at one attempt
 * a minute is seven hundred and twenty, so this is set above that and the age limit is
 * the one that is ever actually reached.
 */
export const MAX_ATTEMPTS = 1_000

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
 *
 * **This is not the drain's question.** See {@link isTerminal}, and do not reuse this
 * one there — the two look alike and the consequences are opposite.
 */
export const shouldQueue = (status: number): boolean => status === 0 || status >= 500

/**
 * The refusals that mean these bytes will never be accepted, whoever asks and however
 * long they wait.
 *
 * An allow-list, and the default is deliberately the other way: anything not named here
 * is kept. That asymmetry is the whole point of the function. For the foreground the
 * cost of guessing wrong is a sentence on a screen; for the drain, "this is not worth
 * keeping" means `store.remove()` and the photo is gone off the guest's device with
 * nothing left to try.
 *
 * It is an allow-list because this was originally {@link shouldQueue} reused, which
 * answers "is this worth storing?" and quite reasonably says no to `429`. In the drain
 * that reading deletes: `UPLOAD_RATE_LIMIT_PER_MINUTE` defaults to twelve, keyed per
 * client and event, so one venue behind one NAT reconnecting at 22:10 pushes every
 * phone past the limit — and every queued photo on all of them would have been thrown
 * away, in a single pass, by the feature whose entire job is not to lose them.
 *
 * `guest.wrongEvent` is pointedly absent: a guest who scans the after-party's QR code
 * overwrites their device token, and the wedding's queue must survive that rather than
 * be deleted by it. `event.quotaExceeded` is absent too — a host can raise a quota, and
 * the twelve-hour expiry is a kinder bound than deletion on the first refusal.
 */
const TERMINAL_CODES: ReadonlySet<string> = new Set([
  // The server looked at these bytes and will not take them.
  'image.unsupportedFormat',
  'image.corrupt',
  'image.tooManyPixels',
  'image.animated',
  'image.renderFailed',
  'photo.pixelBudgetExceeded',
  'upload.rejected',
  'upload.tooLarge',
  'upload.tooManyFiles',
  'upload.unexpectedField',
  'upload.noFiles',
  // The caption travelling with them is not something a later attempt improves.
  'caption.tooLong',
  'caption.empty',
  // The request itself is malformed; the same request is malformed tomorrow.
  'request.invalid',
  // The host took this guest's access away. It does not come back.
  'guest.revoked',
])

export const isTerminal = (code: string): boolean => TERMINAL_CODES.has(code)
