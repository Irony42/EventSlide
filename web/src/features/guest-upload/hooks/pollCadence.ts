/**
 * When the screen of a guest whose photo is waiting asks the server again.
 *
 * Nine seconds is short enough that "Validée ! Elle passe à l'écran dans un instant" is still
 * true when it is read: the wall shows a published photo within about one slide. After five
 * minutes of waiting the host is plainly busy and the poll slows to thirty seconds, because a
 * photo that waits all evening should not cost a phone's battery, or a venue's Wi-Fi, a request
 * every nine of them.
 *
 * Each wait is moved by up to {@link POLL_JITTER_MS} either way. A hundred and fifty phones
 * that all uploaded at the toast would otherwise ask in the same second, every nine seconds,
 * for the whole evening: that is a load spike, not a cadence.
 */
export const POLL_EVERY_MS = 9_000
export const POLL_SLOW_AFTER_MS = 300_000
export const POLL_SLOW_EVERY_MS = 30_000
export const POLL_JITTER_MS = 2_000

/**
 * The wait before the next read. `random` is `Math.random` in the app and a constant in a
 * test, which is how the spread is pinned without a flaky test: 0.5 is no shift at all, 0 is
 * the earliest, 1 the latest.
 */
export const pollDelayMs = (slow: boolean, random: () => number): number => {
  const base = slow ? POLL_SLOW_EVERY_MS : POLL_EVERY_MS
  return Math.round(base + (random() * 2 - 1) * POLL_JITTER_MS)
}
