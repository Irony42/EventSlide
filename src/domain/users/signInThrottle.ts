/**
 * Sign-in throttling per account, **with no lockout** (free plan G3-04, paid plan P4-07).
 *
 * The per-client limit (`LOGIN_RATE_LIMIT_PER_MINUTE`, ten a minute) is the first bucket and
 * is not in here. What it cannot see is *whom* a guesser is working on: a botnet gets a fresh
 * allowance from every address, and a patient attacker can try ten passwords a minute against
 * one account for as long as they like. This is the half that counts attempts against an
 * **account**, and the whole design is about not turning that counter into a weapon.
 *
 * ## Two buckets, both counting failures only
 *
 * - **Account on one network** (B1: the account, and the client's /56 prefix). Five failures
 *   are free. After `n` failures (n >= 5) the next attempt must wait `2^(n-5)` seconds from
 *   the previous one, capped at fifteen minutes. A client that is told to wait and asks
 *   anyway is simply told again: **a refusal is not a failure**, so hammering cannot push the
 *   deadline further out.
 * - **Account on every network** (B2: the account alone). Beyond a hundred failures in an
 *   hour, every attempt is **held two seconds** before it is looked at. It is never refused.
 *   It is also the signal that someone is stuffing credentials into one account, which the
 *   caller reports once per window.
 *
 * ## Why there is no lockout
 *
 * Anyone who knows an owner's address can type wrong passwords into it. A counter that ever
 * refuses the *right* password for good hands them the owner's evening: the host cannot sign
 * in to moderate the wedding. So the rules are shaped around what that attacker can reach.
 *
 * - They fail from **their** network, so they spend **their** B1 bucket. The owner, on
 *   another prefix, has a bucket of their own and sees no wait at all.
 * - B2 is shared by everyone who ever types that address, so it may only ever *slow* an
 *   attempt, and by a fixed two seconds. It can not refuse and it can not grow.
 * - The worst a single network can do to the owner **on that same network** is fifteen
 *   minutes after its last failure, and the wait is a function of the failures it counted
 *   itself, not of the attempts it was refused.
 * - A success is not a failure. It spends nothing, and it clears the wait of the network it
 *   came from, because the person who knows the password has just shown it.
 * - Sessions that are already open are not consulted at all.
 *
 * ## What the state is
 *
 * In memory, one entry per (account, network) and one per account, so a restart forgets
 * everything: the same posture as the per-client limiter beside it. The entries are bounded
 * (`maxKeys`, stale ones first, then the oldest), because the number of distinct addresses a
 * stranger may type is theirs to choose. Forgetting is always the safe direction: it can only
 * hand an attacker a few more free tries, never refuse anybody.
 *
 * An attempt is **reserved when it starts** and given back when it turns out not to have been
 * a failed guess. Counting only when a failure is known would let twelve requests started
 * together all see an empty counter, which is the race this ordering closes.
 *
 * The account and the network are opaque strings here. The caller keys the account by a keyed
 * hash of the normalised address, so a heap dump or a log line holds no e-mail address.
 */

/** Wrong guesses a (account, network) pair may make before it is asked to wait. */
export const FREE_FAILURES = 5

/** The longest anyone is ever asked to wait: the no-lockout ceiling. */
export const MAX_WAIT_SECONDS = 15 * 60

/** How long a (account, network) pair's failures are remembered after the last of them. */
export const FAILURE_MEMORY_MS = 60 * 60_000

/** Failures on one account, from every network together, that start the hold. */
export const STUFFING_FAILURES_PER_HOUR = 100

/** What every attempt on such an account waits. Never a refusal. */
export const STUFFING_HOLD_MS = 2_000

/** The window the account-wide count is taken over. */
export const STUFFING_WINDOW_MS = 60 * 60_000

/** How many entries each of the two tables may hold before the stalest is dropped. */
export const MAX_TRACKED_KEYS = 20_000

/**
 * How long the next attempt must wait after `failures` failures, in seconds.
 *
 * Zero while the free tries last, then 1, 2, 4, ... doubling up to {@link MAX_WAIT_SECONDS}.
 * The exponent is clamped before it is used: 2^10 is already past the ceiling, and an
 * unbounded exponent would turn a long attack into `Infinity` instead of into fifteen
 * minutes.
 */
export const waitSecondsAfter = (failures: number): number => {
  if (failures < FREE_FAILURES) return 0
  const doublings = Math.min(failures - FREE_FAILURES, 10)
  return Math.min(2 ** doublings, MAX_WAIT_SECONDS)
}

/**
 * One (account, network) pair: how many failures, when the latest was counted, and when the
 * one before it was. The last is what a refund puts back, so that an attempt which turns out
 * not to have been a guess does not leave a fresh wait behind it.
 */
interface Slowdown {
  readonly failures: number
  readonly lastAtMs: number
  readonly priorAtMs: number
}

/** One account over an hour: how many failures, since when, and whether it was reported. */
interface Hour {
  readonly failures: number
  readonly sinceMs: number
  readonly reported: boolean
}

export type Admission =
  /** Not yet: the same account from the same network is inside its wait. */
  | { readonly kind: 'wait'; readonly retryAfterSeconds: number }
  /**
   * Go ahead, after `holdMs` (zero unless the account is being stuffed). `credentialStuffing`
   * is true on the first held attempt of a window and nowhere else, so the report is one line
   * and not one per attempt.
   */
  | { readonly kind: 'admit'; readonly holdMs: number; readonly credentialStuffing: boolean }

/** Unambiguous whatever the two strings contain: the first one's length leads. */
const pairKey = (client: string, account: string): string => `${client.length}:${client}:${account}`

/**
 * Stores `value` under `key`, most recent last, within `limit` entries.
 *
 * At the limit a new key first sweeps what `isStale` calls forgotten, and only then drops the
 * oldest entry. Both only ever forget.
 */
const remember = <V>(
  table: Map<string, V>,
  key: string,
  value: V,
  limit: number,
  isStale: (entry: V) => boolean,
): void => {
  if (table.has(key)) {
    table.delete(key)
  } else if (table.size >= limit) {
    for (const [other, entry] of table) {
      if (isStale(entry)) table.delete(other)
    }
    while (table.size >= limit) {
      for (const oldest of table.keys()) {
        table.delete(oldest)
        break
      }
    }
  }
  table.set(key, value)
}

export class SignInThrottle {
  private readonly slowdowns = new Map<string, Slowdown>()
  private readonly hours = new Map<string, Hour>()
  private readonly limit: number

  constructor(maxKeys: number = MAX_TRACKED_KEYS) {
    this.limit = Math.max(1, maxKeys)
  }

  /** How many entries each table holds; for the test of the bound, and for nothing else. */
  get tracked(): { readonly pairs: number; readonly accounts: number } {
    return { pairs: this.slowdowns.size, accounts: this.hours.size }
  }

  /**
   * An attempt on `account` from `client` is about to be looked at.
   *
   * Answers when the pair is inside its wait. Otherwise the attempt is admitted and
   * **reserved** against both buckets until the caller says how it ended ({@link refund},
   * {@link succeeded}); one that is never settled stays counted, which is what an abandoned
   * connection should be.
   */
  begin(account: string, client: string, nowMs: number): Admission {
    const key = pairKey(client, account)
    const slow = this.liveSlowdown(key, nowMs)

    if (slow !== undefined) {
      // Never negative: a clock stepped backwards must not stretch the wait past its ceiling.
      const sinceMs = Math.max(0, nowMs - slow.lastAtMs)
      const remainingMs = waitSecondsAfter(slow.failures) * 1_000 - sinceMs
      if (remainingMs > 0)
        return { kind: 'wait', retryAfterSeconds: Math.ceil(remainingMs / 1_000) }
    }

    remember(
      this.slowdowns,
      key,
      { failures: (slow?.failures ?? 0) + 1, lastAtMs: nowMs, priorAtMs: slow?.lastAtMs ?? nowMs },
      this.limit,
      (entry) => nowMs - entry.lastAtMs >= FAILURE_MEMORY_MS,
    )

    const hour = this.liveHour(account, nowMs)
    const held = hour.failures >= STUFFING_FAILURES_PER_HOUR
    remember(
      this.hours,
      account,
      { failures: hour.failures + 1, sinceMs: hour.sinceMs, reported: hour.reported || held },
      this.limit,
      (entry) => nowMs - entry.sinceMs >= STUFFING_WINDOW_MS,
    )

    return {
      kind: 'admit',
      holdMs: held ? STUFFING_HOLD_MS : 0,
      credentialStuffing: held && !hour.reported,
    }
  }

  /**
   * The attempt was not a failed guess (the server failed after the right password): give
   * back what {@link begin} reserved, **including the instant it stamped**, so a wait that was
   * over when the attempt was admitted is still over when it is refunded. Otherwise a transient
   * `500` for the owner would cost them a fresh wait, up to fifteen minutes.
   */
  refund(account: string, client: string): void {
    const key = pairKey(client, account)
    const slow = this.slowdowns.get(key)
    if (slow !== undefined) {
      if (slow.failures <= 1) this.slowdowns.delete(key)
      else
        this.slowdowns.set(key, { ...slow, failures: slow.failures - 1, lastAtMs: slow.priorAtMs })
    }
    this.refundHour(account)
  }

  /**
   * The attempt signed in. It spends nothing, and the pair's wait is cleared: whoever knows
   * the password is not the guesser the wait was for.
   */
  succeeded(account: string, client: string): void {
    this.slowdowns.delete(pairKey(client, account))
    this.refundHour(account)
  }

  private refundHour(account: string): void {
    const hour = this.hours.get(account)
    if (hour !== undefined && hour.failures > 0) {
      this.hours.set(account, { ...hour, failures: hour.failures - 1 })
    }
  }

  private liveSlowdown(key: string, nowMs: number): Slowdown | undefined {
    const slow = this.slowdowns.get(key)
    if (slow === undefined) return undefined
    if (nowMs - slow.lastAtMs >= FAILURE_MEMORY_MS) {
      this.slowdowns.delete(key)
      return undefined
    }
    return slow
  }

  private liveHour(account: string, nowMs: number): Hour {
    const hour = this.hours.get(account)
    if (hour === undefined || nowMs - hour.sinceMs >= STUFFING_WINDOW_MS) {
      return { failures: 0, sinceMs: nowMs, reported: false }
    }
    return hour
  }
}
