import type { Clock } from '../ports/clock'
import { AT } from './builders'

/**
 * A clock a test drives.
 *
 * Half of this product's rules are about time — the guest self-delete grace window,
 * retention deadlines, the "who is here right now" count, the reaction budget — and
 * every one of them is unassertable against the wall clock. So the clock is a port and
 * this is what a test injects.
 *
 * `now()` hands back a copy: a caller that mutated the returned `Date` would otherwise
 * move the clock, and the entities under test keep the `Date` they were given.
 */
export class FakeClock implements Clock {
  private current: Date

  constructor(start: Date = AT) {
    this.current = new Date(start.getTime())
  }

  now(): Date {
    return new Date(this.current.getTime())
  }

  /** Returns `this` so a test can advance and read in one expression. */
  advance(ms: number): this {
    if (!Number.isFinite(ms)) {
      throw new Error(`FakeClock.advance requires a finite number of milliseconds, got ${ms}`)
    }
    this.current = new Date(this.current.getTime() + ms)
    return this
  }

  set(date: Date): this {
    this.current = new Date(date.getTime())
    return this
  }
}
