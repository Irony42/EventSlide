import type { Clock } from '../../application/ports/clock'
import type { SignInAttempts } from '../../application/ports/signInAttempts'

export interface InMemorySignInAttemptsOptions {
  readonly clock: Clock
  /**
   * How long a sign-in stays counted after its first attempt. The lifetime of a half-finished
   * sign-in is the right value: its entry is never older than the sign-in it belongs to, so it
   * outlives the sign-in, and a straggler already in flight when the cap is reached still finds
   * the count it has to be refused by.
   */
  readonly ttlMs: number
}

interface Entry {
  count: number
  /** When the first attempt was taken, in epoch milliseconds. */
  readonly startedAt: number
}

/**
 * The attempt counter of the second factor, in this process's memory.
 *
 * **Why memory is enough.** The box is one process, and what is counted is a handful of
 * numbers for as long as a sign-in lives, five minutes at most. A restart forgets them, which
 * gives a person who typed the password five more guesses; nobody outside the box can cause a
 * restart, and the per-account budget (`secondFactorAccountLimiter`) is what bounds guessing
 * from everywhere together. Keeping it in the database would make every guess a write for a
 * count that is worthless a few minutes later.
 *
 * **Why it can be exact.** `begin` reads and moves the number in one synchronous step, and
 * JavaScript runs one of these at a time, so ten requests sent at once are given one to ten
 * and never the same number twice. That is the whole point of the port; see it.
 *
 * **Why it does not grow.** Every `begin` first drops the sign-ins older than `ttlMs`. The map
 * is in the order sign-ins were first counted, so the oldest are at the front and the sweep
 * stops at the first one still young. A sign-in that is abandoned costs one small entry for
 * five minutes, and only a caller who has already typed a correct password can make one.
 */
export const createInMemorySignInAttempts = ({
  clock,
  ttlMs,
}: InMemorySignInAttemptsOptions): SignInAttempts => {
  const entries = new Map<string, Entry>()

  const sweep = (nowMs: number): void => {
    for (const [id, entry] of entries) {
      if (nowMs - entry.startedAt <= ttlMs) return
      entries.delete(id)
    }
  }

  return {
    begin(attemptId) {
      const nowMs = clock.now().getTime()
      sweep(nowMs)
      const entry = entries.get(attemptId)
      if (entry === undefined) {
        entries.set(attemptId, { count: 1, startedAt: nowMs })
        return 1
      }
      entry.count += 1
      return entry.count
    },

    release(attemptId) {
      const entry = entries.get(attemptId)
      if (entry !== undefined && entry.count > 0) entry.count -= 1
    },
  }
}
