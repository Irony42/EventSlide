import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Driving the projected wall's timers by hand instead of waiting for them.
 *
 * The wall's rhythm is `setTimeout`s: the slide clock (`useSlideshow`), the time a guestbook card
 * stays up (`useWallGuestbook`), the phase changes (`useWallPhase`). A spec that waits for "a card
 * within 15 seconds" or "fifteen slide changes" is measuring how fast a loaded runner runs those
 * timers, and its timeout is a guess about that runner. With `page.clock` the time is frozen when
 * the page loads and moves only when the spec says so, a whole number of slide intervals at a
 * time, so the same journey takes the same steps on a laptop and on the busiest runner.
 *
 * The clock is moved with `fastForward`, never `runFor`. `runFor` replays every timer of the
 * span one by one, and the wall has a `requestAnimationFrame` loop or two: a second of fake time
 * was measured at about two seconds of real time in WebKit, so a card's six seconds outran any
 * sensible timeout there. `fastForward` fires each timer that fell due once, which is exactly what
 * a one-shot `setTimeout` needs, and takes milliseconds in every engine.
 *
 * What it does **not** do, on purpose: it does not touch real network and SSE (the server and the
 * browser's event stream run in real time, and the spec waits for them with ordinary auto-waiting
 * assertions), and it is not used where the thing under test is a CSS animation, a frame rate or
 * the agreement of two screens on the real clock: those do not run on a clock the spec owns.
 */

/** The attribute of a guestbook card on the wall. */
const CARD = '[data-wall-message]'
/** A card stays up for at least six seconds; the clock jumps this far per step until it is gone. */
const CARD_STEP_MS = 10_000
const CARD_STAY_STEPS = 6
const LOAD_STEP_MS = 100
const STOPPED = 'stopped: what the caller waits for is already there'

/**
 * Installs the fake clock on the page and stops it, before the first navigation: no timer of the
 * wall runs until {@link forward} or {@link slideChange} moves the clock.
 */
export const freezeClock = async (page: Page): Promise<void> => {
  const start = new Date()
  await page.clock.install({ time: start })
  await page.clock.pauseAt(new Date(start.getTime() + 1_000))
}

/**
 * Lets the page finish what the last step set going: the render that follows a timer, and the
 * effects of that render (a card's effect runs after the slide change that summoned it). Two trips
 * through a `MessageChannel`, which is what React's scheduler uses and `page.clock` leaves real.
 */
export const settle = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const trip = (): Promise<void> =>
      new Promise((resolve) => {
        const { port1, port2 } = new MessageChannel()
        port1.onmessage = () => resolve()
        port2.postMessage(null)
      })
    await trip()
    await trip()
  })

/** Moves the clock forward by `ms`, firing what fell due, and lets the page react to it. */
export const forward = async (page: Page, ms: number): Promise<void> => {
  await page.clock.fastForward(ms)
  await settle(page)
}

/** The id of the photograph on the wall, or `null` while there is none. */
export const currentPhoto = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const slide = document.querySelector('[data-testid="wall-slide"]')
    return slide === null ? null : slide.getAttribute('data-photo-id')
  })

const cardUp = async (page: Page): Promise<boolean> => (await page.locator(CARD).count()) > 0

/**
 * Opens the wall on a frozen clock, and returns once a photograph is on it.
 *
 * Not `freezeClock` then `goto` then a plain wait: React itself runs on timers while a page loads
 * (a lazy route's fallback is revealed on a `setTimeout`), so on a clock that never moves the
 * wall stays on its spinner. The clock is moved a tenth of a second at a time until the first
 * photograph is there, which costs fake time and no real time, and the slide clock only starts
 * when the photograph is mounted, so every spec begins its first interval from the same place.
 */
export const openWallFrozen = async (page: Page, url: string): Promise<void> => {
  await freezeClock(page)
  await page.goto(url)
  await expect
    .poll(
      async () => {
        await page.clock.fastForward(LOAD_STEP_MS)
        return (await currentPhoto(page)) !== null
      },
      { message: 'the wall mounts its first photograph' },
    )
    .toBe(true)
  await settle(page)
}

/**
 * Moves the clock one slide interval and returns once the wall shows another photograph.
 *
 * A slide's timer is re-armed by an effect after the render that showed the slide, so a step taken
 * in the instant between the two moves the clock past nothing. The step is therefore repeated
 * inside the poll until the photograph has changed: each repetition is one more interval of fake
 * time, never a wait on real time, and the loop ends the moment the wall has moved.
 *
 * A card holds the slide clock while it is up (`hold: cardUp`, WallPage). When what the caller
 * waits for (`stopWhen`) is that card, there is no change to wait for; when it is not, the clock
 * is moved to the end of the card's stay before the slides move again.
 */
export const slideChange = async (
  page: Page,
  intervalMs = 250,
  stopWhen?: () => Promise<boolean>,
): Promise<void> => {
  const before = await currentPhoto(page)
  await expect
    .poll(
      async () => {
        if (stopWhen !== undefined && (await stopWhen())) return STOPPED
        for (let step = 0; step < CARD_STAY_STEPS && (await cardUp(page)); step += 1) {
          await forward(page, CARD_STEP_MS)
        }
        await page.clock.fastForward(intervalMs)
        return currentPhoto(page)
      },
      { message: 'the wall changes photograph when its clock moves one interval' },
    )
    .not.toBe(before)
  await settle(page)
}

/**
 * Changes the photograph, one interval at a time, until `done` says so, and fails if `max`
 * changes were not enough. Nothing is ever waited for in real time here: `max` is a count of
 * slides, which is what "within 15 seconds" meant.
 */
export const changeUntil = async (
  page: Page,
  what: string,
  done: () => Promise<boolean>,
  max: number,
  intervalMs = 250,
): Promise<number> => {
  for (let changes = 0; changes <= max; changes += 1) {
    if (await done()) return changes
    await slideChange(page, intervalMs, done)
  }
  throw new Error(`${what}: not within ${max} slide changes`)
}

/** `count` slide changes in a row. */
export const changeSlides = async (page: Page, count: number, intervalMs = 250): Promise<void> => {
  for (let change = 0; change < count; change += 1) await slideChange(page, intervalMs)
}

/**
 * How far one step of {@link forwardUntil} moves the clock: past the burst window the wall
 * waits before it reads again after a signal (250 ms, `WALL_READ_DEBOUNCE_MS`), which is a
 * timer like any other and does not run while the clock is frozen.
 */
const SIGNAL_READ_STEP_MS = 260

/**
 * For what the wall shows only after a signal of the event stream and the read that follows it
 * (a host changing a setting, starting a challenge). The signal travels in real time, and the
 * wall reads on a timer of the page's clock, so the spec moves that clock a little at a time
 * until `done` holds. Never a wait on real time; fails with `what` through the poll's timeout.
 */
export const forwardUntil = async (
  page: Page,
  what: string,
  done: () => Promise<boolean>,
): Promise<void> => {
  await expect
    .poll(
      async () => {
        if (await done()) return true
        await forward(page, SIGNAL_READ_STEP_MS)
        return done()
      },
      { message: what },
    )
    .toBe(true)
}
