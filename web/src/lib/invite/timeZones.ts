/**
 * The zones the host's picker offers: the platform's own list, `UTC` first, and the zone the
 * invitation already has even when the list does not carry it (an older browser, an alias).
 *
 * `Intl.supportedValuesOf` is read where it exists; where it does not, the list is the zone in use
 * and `UTC`, which is still a working form: the host's zone is taken from the browser, and a picker
 * that offered nothing else is better than one that threw.
 */
export const timeZoneOptions = (current: string): readonly string[] => {
  const known: readonly string[] =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const all = new Set<string>(['UTC', ...known])
  all.add(current)
  return [...all].sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)))
}

/** The zone this browser is in, as an IANA identifier: the first thing an invitation is given. */
export const browserTimeZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone

/** Whether this browser knows the zone: a zone saved elsewhere may not be one it has. */
export const supportsTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch (cause) {
    if (cause instanceof RangeError) return false
    throw cause
  }
}

/** A mid-winter day in the northern hemisphere: the zone's standard name, whichever season it is now. */
const NAME_DAY = Date.UTC(2027, 0, 15, 12)

/**
 * The zone as a person names it, in their language: `heure normale d’Europe centrale`, never the
 * last segment of its identifier (`Paris` would call a whole zone by one city, and `Kolkata` is no
 * word to somebody reading it in Kolkata's own time). A zone the browser does not know is shown by
 * its identifier, so the host sees what is stored.
 */
export const zoneName = (timeZone: string, locale: string): string => {
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'long' })
      .formatToParts(NAME_DAY)
      .find((part) => part.type === 'timeZoneName')?.value
    return name ?? timeZone
  } catch (cause) {
    if (cause instanceof RangeError) return timeZone
    throw cause
  }
}
