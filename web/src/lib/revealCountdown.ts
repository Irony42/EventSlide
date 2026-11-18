/**
 * The wording of a reveal countdown, shared by the host's console band and the projected wall
 * (spec 23): two features that must say the same thing, so the rule lives here and neither imports
 * the other.
 */

const MINUTE_MS = 60_000

/**
 * The countdown as the band words it: whole hours and minutes, rounded **up** so it never says
 * "0 min" with a moment left, or `'soon'` under a minute. Minutes are all a host acts on; seconds
 * would make the band tick for nothing.
 */
export const countdownParts = (
  leftMs: number,
): { readonly hours: number; readonly minutes: number } | 'soon' => {
  if (leftMs < MINUTE_MS) return 'soon'
  const totalMinutes = Math.ceil(leftMs / MINUTE_MS)
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}
