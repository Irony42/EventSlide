import {
  setBackgroundInterval,
  setBackgroundTimeout,
} from '../infrastructure/time/backgroundTimers'

/**
 * The timer of a background job: start it, stop it, ask whether it is running.
 *
 * Five jobs each held a `timer` variable, guarded `start` against a second call, cleared it
 * in `stop` and unref'd it. The unref is in `backgroundTimers.ts`, where it is tested once;
 * what is left here is the lifecycle, and it is the same for all of them.
 *
 * `tick` is called with nothing and its result is ignored, so a job passes `() => void
 * runOnce()` and the pass's own guard catches whatever it throws. This is not where a
 * failure is handled.
 */

export interface RepeaterDeps {
  readonly everyMs: number
  readonly tick: () => void
  /**
   * When set, the first tick is this long from `start` and the interval begins there,
   * rather than the first tick being one interval away. The media reconciliation offsets
   * itself this way so that it does not walk the disk in the same minute as the retention
   * sweep.
   */
  readonly firstDelayMs?: number
}

export interface Repeater {
  /** Whether `start` has been called and `stop` has not. */
  readonly active: boolean
  /** Idempotent. */
  start(): void
  /** Idempotent. Does not wait for a tick already running. */
  stop(): void
}

export const createRepeater = ({ everyMs, tick, firstDelayMs }: RepeaterDeps): Repeater => {
  let interval: NodeJS.Timeout | null = null
  let firstRun: NodeJS.Timeout | null = null

  return {
    get active(): boolean {
      return interval !== null || firstRun !== null
    },

    start: () => {
      if (interval !== null || firstRun !== null) return

      if (firstDelayMs === undefined) {
        interval = setBackgroundInterval(tick, everyMs)
        return
      }

      firstRun = setBackgroundTimeout(() => {
        firstRun = null
        tick()
        interval = setBackgroundInterval(tick, everyMs)
      }, firstDelayMs)
    },

    stop: () => {
      if (firstRun !== null) {
        clearTimeout(firstRun)
        firstRun = null
      }
      if (interval !== null) {
        clearInterval(interval)
        interval = null
      }
    },
  }
}
