/**
 * The days of the replies as a host reads them (spec 30): in their language, and in **the party's
 * zone** when it is known, never the browser's by accident. A calendar day has no zone and is read as
 * it is written.
 */

/** An ISO instant as a date: "12 décembre 2026". */
export const dateOf = (iso: string, locale: string, timeZone: string | null): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(timeZone === null ? {} : { timeZone }),
  }).format(new Date(iso))

/** A calendar day (`2026-12-12`) as a date: written in UTC from the day's own parts. */
export const dayOf = (day: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`))
