/**
 * The time a photo was sent, as the wall prints it under the photo (spec 13, rule 10).
 *
 * The **send** time (`createdAt`): EXIF is stripped on ingest, so the moment the picture was
 * taken is unknown. Formatted in the zone of the **browser running the wall** (the room has its
 * projector's clock; no event time zone is modelled), `HH:mm` in the wall's language, with the
 * short weekday in front when the photo is not from today (a party over two days).
 *
 * Pure: the zone and the clock are parameters, so the same call gives the same answer in any
 * test and the rule is not a read of `Date.now()` or of the machine's settings.
 */
export const formatSendTime = (
  createdAt: string,
  locale: string,
  now: Date,
  timeZone?: string,
): string | null => {
  const sent = new Date(createdAt)
  if (Number.isNaN(sent.getTime())) return null

  const zone = timeZone === undefined ? {} : { timeZone }
  const clock = new Intl.DateTimeFormat(locale, {
    ...zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(sent)

  const day = (date: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      ...zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  if (day(sent) === day(now)) return clock

  const weekday = new Intl.DateTimeFormat(locale, { ...zone, weekday: 'short' }).format(sent)
  return `${weekday} ${clock}`
}
