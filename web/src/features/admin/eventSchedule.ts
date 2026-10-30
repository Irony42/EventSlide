/**
 * The two conversions between the host's screen and the wire, and nothing else.
 *
 * **What is stored is an instant.** `scheduledOpenAt` and `scheduledCloseAt` travel and
 * are stored as ISO-8601 UTC, like every other timestamp in this product, because that
 * is the only form that means the same thing on the server, in the database and on a
 * second laptop.
 *
 * **What is shown is wall-clock time in the browser's own zone.** An `<input
 * type="datetime-local">` has no timezone: it yields `2026-06-20T18:00`, and the
 * browser's `Date` parser reads a string in that shape as *local* time. So the host
 * types 18:00, the browser resolves it against the zone their laptop is in, and the
 * instant is what is sent.
 *
 * That makes the venue's timezone the laptop's timezone, which is the right default and
 * a deliberate simplification: the host is at the party. There is **no per-event
 * timezone field** — a host configuring a wedding from another country would be setting
 * their own local time, and would have to do the arithmetic themselves. Modelling the
 * venue's zone properly means a zone column, a picker, and a DST story for the seven
 * hours a party lasts; it is not this change, and the copy in `fr.admin.scheduleHint`
 * says plainly whose clock the fields are read against.
 *
 * ## Two consequences of that simplification, written down rather than discovered
 *
 * **Minute granularity.** The control offers minutes, so `toLocalInput` drops seconds.
 * An instant set through the API with seconds on it — `18:00:45` — reads back into the
 * field as `18:00`, and saving the form re-sends `18:00:00`, forty-five seconds earlier
 * than what was stored. Nothing in the console can produce such an instant; only a
 * direct API call can, and this is what happens to it if a host then touches the form.
 *
 * **The two clock-change nights.** Both follow from resolving a wall-clock time against
 * the browser's zone, and neither is special-cased:
 *
 * - *Spring forward.* 02:30 on the morning the clocks jump does not exist. `Date` maps
 *   it to 03:30 rather than refusing, so a schedule set for a nonexistent local time
 *   silently lands an hour later than it reads.
 * - *Autumn back.* 02:30 happens twice. `Date` resolves it to the **first** occurrence,
 *   so a party scheduled to close at 02:30 closes at the earlier one — an hour before a
 *   host counting the second might expect.
 *
 * Accepted rather than fixed: an event spanning a clock change is rare, both outcomes
 * are an hour and not a day, and the alternative is the per-event timezone this change
 * deliberately does not model. `docs/API.md` §6 says the same thing to API clients.
 */

import { formatDateTime } from '../../lib/format'
import type { EventStatus } from '../../lib/api/dto'
import type { Locale } from '../../lib/i18n/locale'

const pad = (value: number): string => String(value).padStart(2, '0')

/** `2026-06-20T16:00:00.000Z` -> `2026-06-20T18:00` for a browser in Paris. */
export const toLocalInput = (iso: string | null): string => {
  if (iso === null) return ''
  const at = new Date(iso)
  // A value the browser cannot read is one no host typed — it came from the server.
  // An empty field is a truer rendering of it than an `Invalid Date` in the control.
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** `2026-06-20T18:00` typed in Paris -> `2026-06-20T16:00:00.000Z` on the wire. */
export const toInstant = (local: string): string | null => {
  if (local === '') return null
  const at = new Date(local)
  // `datetime-local` yields either a well-formed value or an empty string, so this is
  // the belt to that browser's braces: a half-typed value is "not set", never a `400`.
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/**
 * The automatic moves still ahead of an event, in the order they will happen, for the line
 * beside the status badge (revue UX 30/10, HOT-10).
 *
 * A draft with an opening armed will open by itself; a live event with a closing armed will end
 * by itself. Nothing else is "ahead": a closed or archived event has nothing left to trigger,
 * and an opening still stored on a live one is stale. Showing only what will still happen is
 * the point: the host who reads "Brouillon" on the day and sees no opening time clicks "Open to
 * guests" to be safe, which is exactly what the line is there to spare them.
 */
export interface UpcomingMove {
  readonly kind: 'open' | 'close'
  readonly at: string
}

export const upcomingMoves = (
  status: EventStatus,
  schedule: { readonly scheduledOpenAt: string | null; readonly scheduledCloseAt: string | null },
): readonly UpcomingMove[] => {
  const moves: UpcomingMove[] = []
  if (status === 'draft' && schedule.scheduledOpenAt !== null) {
    moves.push({ kind: 'open', at: schedule.scheduledOpenAt })
  }
  if ((status === 'draft' || status === 'live') && schedule.scheduledCloseAt !== null) {
    moves.push({ kind: 'close', at: schedule.scheduledCloseAt })
  }
  return moves
}

/**
 * How an instant reads beside the badge: just the time when it is today ("18:00" is what the
 * host is waiting for), the date and time otherwise (a Saturday evening seen on the Wednesday).
 * `null` for a value the browser cannot read, so a broken stamp shows nothing instead of "Invalid
 * Date". `now` is a parameter so the answer does not depend on when the test runs.
 */
export const scheduleMoment = (
  iso: string,
  now: Date,
  locale: Locale,
): { readonly today: boolean; readonly text: string } | null => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const today =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  if (today) return { today, text: at.toLocaleTimeString(locale, { timeStyle: 'short' }) }
  const text = formatDateTime(iso, locale)
  return text === null ? null : { today, text }
}
