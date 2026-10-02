import { describe, expect, it } from 'vitest'
import {
  FAILURE_MEMORY_MS,
  FREE_FAILURES,
  MAX_WAIT_SECONDS,
  STUFFING_FAILURES_PER_HOUR,
  STUFFING_HOLD_MS,
  STUFFING_WINDOW_MS,
  SignInThrottle,
  waitSecondsAfter,
  type Admission,
} from './signInThrottle'

const T0 = 1_800_000_000_000
const SECOND = 1_000
const MINUTE = 60 * SECOND

const OWNER = 'account-owner'
const HOME = 'client-home'
const ELSEWHERE = 'client-elsewhere'

/** One wrong guess that is let through, failing the test loudly if it was not. */
const fail = (
  throttle: SignInThrottle,
  at: number,
  account = OWNER,
  client = HOME,
): Extract<Admission, { kind: 'admit' }> => {
  const verdict = throttle.begin(account, client, at)
  if (verdict.kind !== 'admit')
    throw new Error(`expected the attempt at +${at - T0} ms to be admitted`)
  return verdict
}

/**
 * `count` wrong guesses in a row, each made as soon as the previous wait allows, so that a
 * test can pile failures up without writing out the arithmetic of the waits. Returns the
 * instant of the last one.
 */
const pile = (
  throttle: SignInThrottle,
  count: number,
  from: number,
  account = OWNER,
  client = HOME,
): number => {
  let now = from
  for (let made = 0; made < count; made += 1) {
    const verdict = throttle.begin(account, client, now)
    if (verdict.kind === 'wait') {
      now += verdict.retryAfterSeconds * SECOND
      made -= 1
    }
  }
  return now
}

describe('waitSecondsAfter', () => {
  it('asks nobody to wait during the five free tries', () => {
    expect([0, 1, 2, 3, 4].map(waitSecondsAfter)).toEqual([0, 0, 0, 0, 0])
    expect(FREE_FAILURES).toBe(5)
  })

  it('then doubles the wait with every failure, from one second', () => {
    expect([5, 6, 7, 8, 9, 10].map(waitSecondsAfter)).toEqual([1, 2, 4, 8, 16, 32])
  })

  it('never asks for more than fifteen minutes, however many failures there have been', () => {
    expect(waitSecondsAfter(14)).toBe(512)
    expect(waitSecondsAfter(15)).toBe(MAX_WAIT_SECONDS)
    expect(waitSecondsAfter(16)).toBe(MAX_WAIT_SECONDS)
    expect(waitSecondsAfter(1_000_000)).toBe(MAX_WAIT_SECONDS)
    expect(MAX_WAIT_SECONDS).toBe(900)
  })
})

describe('SignInThrottle, one account on one network', () => {
  it('lets five failures through and asks the sixth to wait one second', () => {
    const throttle = new SignInThrottle()
    for (let i = 0; i < 5; i += 1) fail(throttle, T0 + i)

    expect(throttle.begin(OWNER, HOME, T0 + 5)).toEqual({ kind: 'wait', retryAfterSeconds: 1 })
  })

  it('counts the wait down, and rounds what is left up so a client that obeys is admitted', () => {
    const throttle = new SignInThrottle()
    for (let i = 0; i < 6; i += 1) fail(throttle, T0 + i * 10 * SECOND)
    const last = T0 + 5 * 10 * SECOND // the sixth failure: 2 s to wait

    expect(throttle.begin(OWNER, HOME, last + 1)).toEqual({ kind: 'wait', retryAfterSeconds: 2 })
    expect(throttle.begin(OWNER, HOME, last + 1_500)).toEqual({
      kind: 'wait',
      retryAfterSeconds: 1,
    })
    expect(throttle.begin(OWNER, HOME, last + 2 * SECOND).kind).toBe('admit')
  })

  it('does not extend the wait when it is asked again during it', () => {
    const throttle = new SignInThrottle()
    for (let i = 0; i < 8; i += 1) fail(throttle, T0 + i * 100 * SECOND)
    const last = T0 + 7 * 100 * SECOND // 8 failures: 8 s to wait

    for (let i = 0; i < 500; i += 1) {
      expect(throttle.begin(OWNER, HOME, last + 1 + i).kind).toBe('wait')
    }

    expect(throttle.begin(OWNER, HOME, last + 8 * SECOND).kind).toBe('admit')
  })

  it('never asks for more than fifteen minutes, and then lets the next attempt through', () => {
    const throttle = new SignInThrottle()
    let now = T0
    const waits: number[] = []
    for (let i = 0; i < 40; i += 1) {
      fail(throttle, now)
      const verdict = throttle.begin(OWNER, HOME, now)
      if (verdict.kind === 'wait') {
        waits.push(verdict.retryAfterSeconds)
        now += verdict.retryAfterSeconds * SECOND
      }
    }

    expect(Math.max(...waits)).toBe(MAX_WAIT_SECONDS)
    expect(waits.slice(0, 6)).toEqual([1, 2, 4, 8, 16, 32])
    expect(throttle.begin(OWNER, HOME, now).kind).toBe('admit')
  })

  it('forgets the failures after an hour without one', () => {
    const throttle = new SignInThrottle()
    const last = pile(throttle, 12, T0)
    expect(throttle.begin(OWNER, HOME, last + 1).kind).toBe('wait')

    const later = last + FAILURE_MEMORY_MS
    for (let i = 0; i < 5; i += 1) fail(throttle, later + i)
    expect(throttle.begin(OWNER, HOME, later + 5)).toEqual({ kind: 'wait', retryAfterSeconds: 1 })
  })

  it('keeps counting while the attempts keep coming, however slowly', () => {
    const throttle = new SignInThrottle()
    let now = T0
    for (let i = 0; i < 20; i += 1) {
      // Every 30 minutes: more than the longest wait, less than the memory.
      now += 30 * MINUTE
      fail(throttle, now)
    }

    // Twenty failures are remembered, so the next one is asked to wait the ceiling.
    expect(throttle.begin(OWNER, HOME, now + SECOND)).toEqual({
      kind: 'wait',
      retryAfterSeconds: MAX_WAIT_SECONDS - 1,
    })
  })

  it('does not stretch the wait past its ceiling when the clock steps backwards', () => {
    const throttle = new SignInThrottle()
    for (let i = 0; i < 40; i += 1) fail(throttle, T0 + i * 1000 * SECOND)
    const last = T0 + 39 * 1000 * SECOND

    const verdict = throttle.begin(OWNER, HOME, last - 3 * 60 * MINUTE)

    expect(verdict).toEqual({ kind: 'wait', retryAfterSeconds: MAX_WAIT_SECONDS })
  })
})

describe('SignInThrottle, who shares a budget', () => {
  it('gives another network its own budget on the same account', () => {
    const throttle = new SignInThrottle()
    const last = pile(throttle, 30, T0)
    expect(throttle.begin(OWNER, HOME, last + 1).kind).toBe('wait')

    expect(throttle.begin(OWNER, ELSEWHERE, last + 1).kind).toBe('admit')
  })

  it('gives another account its own budget on the same network', () => {
    const throttle = new SignInThrottle()
    const last = pile(throttle, 30, T0)
    expect(throttle.begin(OWNER, HOME, last + 1).kind).toBe('wait')

    expect(throttle.begin('account-other', HOME, last + 1).kind).toBe('admit')
  })

  it('does not confuse two pairs whose strings run together', () => {
    const throttle = new SignInThrottle()
    const last = pile(throttle, 30, T0, 'b', 'a')
    expect(throttle.begin('b', 'a', last + 1).kind).toBe('wait')

    expect(throttle.begin('ab', '', last + 1).kind).toBe('admit')
    expect(throttle.begin('', 'ab', last + 1).kind).toBe('admit')
    expect(throttle.begin('a', 'b', last + 1).kind).toBe('admit')
  })
})

describe('SignInThrottle, what a non-failure gives back', () => {
  it('a success spends nothing and clears the wait of the network it came from', () => {
    const throttle = new SignInThrottle()
    for (let i = 0; i < 4; i += 1) fail(throttle, T0 + i)
    fail(throttle, T0 + 10)
    throttle.succeeded(OWNER, HOME)

    for (let i = 0; i < 5; i += 1) fail(throttle, T0 + 20 + i)
    expect(throttle.begin(OWNER, HOME, T0 + 30).kind).toBe('wait')
  })

  it('a success does not clear the wait of another network', () => {
    const throttle = new SignInThrottle()
    const last = pile(throttle, 8, T0, OWNER, ELSEWHERE)
    fail(throttle, last)
    throttle.succeeded(OWNER, HOME)

    expect(throttle.begin(OWNER, ELSEWHERE, last + 1).kind).toBe('wait')
  })

  it('a refunded attempt is as if it had not been made', () => {
    const throttle = new SignInThrottle()
    for (let i = 0; i < 5; i += 1) {
      fail(throttle, T0 + i)
      throttle.refund(OWNER, HOME)
    }

    for (let i = 0; i < 5; i += 1) fail(throttle, T0 + 10 + i)
    expect(throttle.begin(OWNER, HOME, T0 + 20).kind).toBe('wait')
  })

  it('refunding an attempt that was never reserved changes nothing', () => {
    const throttle = new SignInThrottle()

    throttle.refund(OWNER, HOME)
    throttle.succeeded(OWNER, HOME)

    expect(throttle.tracked).toEqual({ pairs: 0, accounts: 0 })
  })

  it('gives the account-wide count back too', () => {
    const throttle = new SignInThrottle()
    for (let i = 0; i < STUFFING_FAILURES_PER_HOUR; i += 1) {
      fail(throttle, T0 + i, OWNER, `client-${i}`)
      throttle.refund(OWNER, `client-${i}`)
    }

    expect(fail(throttle, T0 + 1_000, OWNER, 'client-new').holdMs).toBe(0)
  })

  it('does not take the account-wide count below zero', () => {
    const throttle = new SignInThrottle()
    fail(throttle, T0)
    throttle.refund(OWNER, HOME)
    throttle.refund(OWNER, HOME)
    throttle.succeeded(OWNER, HOME)

    for (let i = 0; i < STUFFING_FAILURES_PER_HOUR; i += 1) {
      expect(fail(throttle, T0 + 1 + i, OWNER, `client-${i}`).holdMs).toBe(0)
    }
    expect(fail(throttle, T0 + 1_000, OWNER, 'client-new').holdMs).toBe(STUFFING_HOLD_MS)
  })
})

describe('SignInThrottle, one account attacked from every network', () => {
  const stuff = (throttle: SignInThrottle, count: number, at = T0): void => {
    for (let i = 0; i < count; i += 1) fail(throttle, at + i, OWNER, `botnet-${i}`)
  }

  it('holds nobody until the account has taken a hundred failures in an hour', () => {
    const throttle = new SignInThrottle()

    for (let i = 0; i < STUFFING_FAILURES_PER_HOUR; i += 1) {
      const verdict = fail(throttle, T0 + i, OWNER, `botnet-${i}`)
      expect(verdict).toEqual({ kind: 'admit', holdMs: 0, credentialStuffing: false })
    }
  })

  it('then holds every attempt two seconds, and refuses none, from any network', () => {
    const throttle = new SignInThrottle()
    stuff(throttle, STUFFING_FAILURES_PER_HOUR)

    for (let i = 0; i < 300; i += 1) {
      const verdict = throttle.begin(OWNER, `fresh-${i}`, T0 + 1_000 + i)
      expect(verdict).toMatchObject({ kind: 'admit', holdMs: STUFFING_HOLD_MS })
    }
    expect(STUFFING_HOLD_MS).toBe(2_000)
  })

  it('reports the stuffing on the first held attempt of a window, and only then', () => {
    const throttle = new SignInThrottle()
    stuff(throttle, STUFFING_FAILURES_PER_HOUR)

    const flags = [0, 1, 2, 3].map(
      (i) => fail(throttle, T0 + 1_000 + i, OWNER, `fresh-${i}`).credentialStuffing,
    )

    expect(flags).toEqual([true, false, false, false])
  })

  it('starts a new window after an hour, held no more and reported again if it recurs', () => {
    const throttle = new SignInThrottle()
    stuff(throttle, STUFFING_FAILURES_PER_HOUR + 5)

    const later = T0 + STUFFING_WINDOW_MS
    expect(fail(throttle, later, OWNER, 'fresh').holdMs).toBe(0)

    // 'fresh' was the first of the new window; ninety-nine more make a hundred.
    stuff(throttle, STUFFING_FAILURES_PER_HOUR - 1, later + 1)
    expect(fail(throttle, later + 1_000, OWNER, 'again')).toEqual({
      kind: 'admit',
      holdMs: STUFFING_HOLD_MS,
      credentialStuffing: true,
    })
  })

  it('leaves another account alone', () => {
    const throttle = new SignInThrottle()
    stuff(throttle, STUFFING_FAILURES_PER_HOUR + 5)

    expect(fail(throttle, T0 + 1_000, 'account-other', 'botnet-1').holdMs).toBe(0)
  })
})

describe('SignInThrottle, how much it remembers', () => {
  it('holds at most the limit of entries in each table, whoever types what', () => {
    const throttle = new SignInThrottle(50)

    for (let i = 0; i < 500; i += 1) fail(throttle, T0 + i, `account-${i}`, `client-${i}`)

    expect(throttle.tracked).toEqual({ pairs: 50, accounts: 50 })
  })

  it('drops what is already forgotten before it drops anything recent', () => {
    const throttle = new SignInThrottle(3)
    for (let i = 0; i < 3; i += 1) fail(throttle, T0, `old-${i}`, HOME)
    const later = T0 + 2 * STUFFING_WINDOW_MS

    fail(throttle, later, 'new-1', HOME)
    fail(throttle, later, 'new-2', HOME)

    // The three old entries were stale; the sweep removed all of them, not just one.
    expect(throttle.tracked).toEqual({ pairs: 2, accounts: 2 })
  })

  it('drops the oldest entry when none is stale, and keeps the recent ones counting', () => {
    const throttle = new SignInThrottle(3)
    const last = pile(throttle, 8, T0, 'recent', HOME)
    fail(throttle, last + 1, 'a', HOME)
    fail(throttle, last + 2, 'b', HOME)

    fail(throttle, last + 3, 'c', HOME) // full: the oldest ('recent') makes room

    expect(throttle.tracked.pairs).toBe(3)
    // Forgotten, so it is not asked to wait for its eight failures any more.
    expect(throttle.begin('recent', HOME, last + 4).kind).toBe('admit')
  })

  it('treats a limit below one as one', () => {
    const throttle = new SignInThrottle(0)

    fail(throttle, T0, 'a', HOME)
    fail(throttle, T0 + 1, 'b', HOME)

    expect(throttle.tracked).toEqual({ pairs: 1, accounts: 1 })
  })
})
