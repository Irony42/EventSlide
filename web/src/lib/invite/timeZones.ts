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
