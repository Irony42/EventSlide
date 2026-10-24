/**
 * Timers that never hold the process open.
 *
 * Every timer the server starts is background work: a sweep, a drain, a heartbeat, a
 * deadline, a kill escalation. None of them is a reason for the process to stay up, and a
 * timer left ref'd is exactly that: `docker stop` waits out the whole interval (a day, for
 * the retention sweep) before Node's event loop empties, the shutdown backstop never gets to
 * do its job because the process is not trying to exit, and `npm start` ignores Ctrl-C.
 *
 * The call that prevents it is `timer.unref()`, and it used to be written beside each of
 * twelve `setInterval` and `setTimeout` calls and asserted at two of them, so dropping it
 * anywhere else failed nothing. It is written here, once, and tested here. `eslint.config.mjs`
 * refuses a raw `setInterval` or `setTimeout` in `src/main` and `src/infrastructure`, so the
 * next timer cannot forget it.
 *
 * They return the handle `setInterval` and `setTimeout` do, so `clearInterval` and
 * `clearTimeout` clear them as before.
 */

export const setBackgroundInterval = (task: () => void, everyMs: number): NodeJS.Timeout => {
  const timer = setInterval(task, everyMs)
  timer.unref()
  return timer
}

export const setBackgroundTimeout = (task: () => void, delayMs: number): NodeJS.Timeout => {
  const timer = setTimeout(task, delayMs)
  timer.unref()
  return timer
}
