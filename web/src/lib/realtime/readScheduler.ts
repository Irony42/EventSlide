/**
 * When a page that mirrors server state should read it again.
 *
 * The event stream sends invalidations, never data, so every consumer ends up with the
 * same question: "something changed, read again — but when, and what about the read that
 * is already on its way?". Four hooks used to answer it four ways (cancel and restart,
 * cancel and restart, 300 ms debounce, 5 s window), and two of those answers have a
 * failure mode: when signals arrive faster than a read completes, a cancel-and-restart
 * policy aborts every read before it lands, and the screen keeps its stale answer at the
 * busiest moment of the evening.
 *
 * The policy, in one place:
 *
 * 1. **At most one read in flight.** A request that arrives while a read runs is not a
 *    reason to abort it; it only marks the read as stale.
 * 2. **One replay.** When the read settles — answered or failed — a stale mark starts
 *    exactly one more read, however many requests set it.
 * 3. **A trailing debounce for bursts.** The window opens at the first request and is not
 *    pushed back by later ones, so a steady drizzle of signals still gets a read every
 *    `debounceMs` instead of none at all.
 * 4. **Abort only when the target goes away** (unmount, a new slug). That is the owner's
 *    effect cleanup plus `cancel()`; this scheduler never aborts anything.
 *
 * The scheduler owns *when*; the owner keeps *how*. `start` is what begins a read (an
 * `attempt` bump that an effect reacts to, or a promise-returning call), and the owner
 * reports its end with `settled()`, unless `start` returns a promise, which is awaited.
 */
export interface ReadSchedulerOptions {
  /**
   * Begins a read. Returning a promise lets the scheduler follow it to its end; returning
   * nothing means the owner calls `began()` when the read really starts and `settled()`
   * when it ends. With `tracksSettlement: false` the read is not followed at all.
   */
  readonly start: () => Promise<unknown> | void
  /** Length of the burst window. Zero starts on the next request, synchronously. */
  readonly debounceMs?: number
  /**
   * `false` for an owner that cannot report the end of its reads (a generic loader hook):
   * the burst window still applies, but a request never waits for an earlier read.
   */
  readonly tracksSettlement?: boolean
}

export interface ReadScheduler {
  /**
   * Something changed: read again, soon, once. `immediate` skips the burst window, for a
   * request that is already paced by its own timer or by a person (a retry, a slow poll, a
   * button): it still never overlaps a read in flight.
   */
  request(options?: { readonly immediate?: boolean }): void
  /** A read has started (the first one of a page, or one `start` began). Clears the stale mark. */
  began(): void
  /** The read in flight ended, whatever its outcome. Replays one read if it went stale meanwhile. */
  settled(): void
  /** Replaces what `start` does, for an owner whose callback changes identity between renders. */
  retarget(start: ReadSchedulerOptions['start']): void
  /** Forget the window, the stale mark and the read in flight. Safe to call again and reuse. */
  cancel(): void
}

export const DEFAULT_READ_DEBOUNCE_MS = 250

export const createReadScheduler = ({
  start: initialStart,
  debounceMs = DEFAULT_READ_DEBOUNCE_MS,
  tracksSettlement = true,
}: ReadSchedulerOptions): ReadScheduler => {
  let start = initialStart
  let inFlight = false
  let stale = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // Bumped by `cancel()`, so the end of a read that belonged to a cancelled page is ignored.
  let generation = 0

  const fire = () => {
    timer = undefined
    if (tracksSettlement && inFlight) {
      stale = true
      return
    }
    stale = false
    if (!tracksSettlement) {
      void start()
      return
    }
    inFlight = true
    const mine = generation
    const result = start()
    if (result !== undefined) {
      const end = () => {
        if (mine === generation) scheduler.settled()
      }
      result.then(end, end)
    }
  }

  const arm = () => {
    if (timer !== undefined) return
    if (debounceMs <= 0) {
      fire()
      return
    }
    timer = setTimeout(fire, debounceMs)
  }

  const scheduler: ReadScheduler = {
    request(options) {
      if (tracksSettlement && inFlight) {
        stale = true
        return
      }
      if (options?.immediate === true) {
        if (timer !== undefined) clearTimeout(timer)
        fire()
        return
      }
      arm()
    },
    began() {
      if (!tracksSettlement) return
      inFlight = true
      stale = false
    },
    settled() {
      if (!inFlight) return
      inFlight = false
      if (stale) {
        stale = false
        arm()
      }
    },
    retarget(next) {
      start = next
    },
    cancel() {
      generation += 1
      inFlight = false
      stale = false
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
  return scheduler
}
