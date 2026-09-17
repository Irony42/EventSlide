import { fr } from '../../lib/i18n/fr'

/**
 * How a settings value is worded for a host, in one place.
 *
 * It exists because two screens now say the same number: the settings form, where the
 * host changes the self-delete window, and the template card on the create form, which
 * has to describe what a preset sets it to. A second spelling would let the create form
 * promise "1 heure" for a value the settings page then calls something else.
 */

/**
 * A grace window in the largest unit that divides it exactly.
 *
 * Zero is a word rather than a duration — the window is off, which is not the same
 * sentence as "no time at all" — and anything under a minute stays in seconds so that a
 * value set over the API is still readable rather than rounded to "0 minutes".
 */
export const graceLabel = (seconds: number): string => {
  if (seconds === 0) return fr.admin.graceNone
  if (seconds < 60) return fr.admin.graceSeconds(seconds)
  if (seconds % 3600 === 0) return fr.admin.graceHours(seconds / 3600)
  return fr.admin.graceMinutes(Math.round(seconds / 60))
}
