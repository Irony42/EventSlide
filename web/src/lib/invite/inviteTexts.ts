import type { Locale } from '../i18n/locale'

/**
 * The words and files a guest invitation is made into (spec 29): the hour as a person says it,
 * the calendar file, the directions link. **Pure functions of the invitation**, no React and no
 * clock of their own, so each is tested without a screen. The page, and later the card, the
 * image and the e-mail, all read the same ones, so the date never reads two ways.
 *
 * The host's own text (title, place, word) is content: it goes through as written, never
 * translated and never rendered as a link. What is translated here is only what the language
 * of the invitation decides: the weekday, the month, the way an hour is written.
 */

export interface InviteWhen {
  /** ISO 8601 instants, as the server sends them. */
  readonly startsAt: string
  readonly endsAt: string | null
  /** The IANA zone the invitation is read in: the place's, not the reader's. */
  readonly timeZone: string
}

// ------------------------------------------------------------------------------- the hour --

const DAY_MS = 24 * 60 * 60 * 1000

const partsOf = (at: Date, lang: Locale, timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lang, { timeZone, ...options }).formatToParts(at)

const numberPart = (parts: readonly Intl.DateTimeFormatPart[], type: string): number =>
  Number(parts.find((part) => part.type === type)?.value ?? '0')

/**
 * "19 h", "19 h 30" in French; the platform's own way elsewhere (`7 PM`, `19 Uhr`, `19:30`).
 * The minute is left out when it is zero, so a round hour never reads `19:00`.
 */
export const hourLabel = (at: Date, lang: Locale, timeZone: string): string => {
  const parts = partsOf(at, lang, timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const hour = numberPart(parts, 'hour')
  const minute = numberPart(parts, 'minute')
  if (lang === 'fr')
    return minute === 0 ? `${hour} h` : `${hour} h ${String(minute).padStart(2, '0')}`
  return new Intl.DateTimeFormat(lang, {
    timeZone,
    hour: 'numeric',
    ...(minute === 0 ? {} : { minute: '2-digit' }),
  }).format(at)
}

/** "samedi 13 décembre 2026": lower case, the page capitalises it where it starts a line. */
export const dayLabel = (at: Date, lang: Locale, timeZone: string): string =>
  new Intl.DateTimeFormat(lang, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(at)

/** "11 déc. 2027": the month in letters in every language, so no reader can take 12/11 for the 11th of December. */
export const shortDayLabel = (at: Date, lang: Locale, timeZone: string): string =>
  new Intl.DateTimeFormat(lang, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(at)

const weekdayLabel = (at: Date, lang: Locale, timeZone: string): string =>
  new Intl.DateTimeFormat(lang, { timeZone, weekday: 'long' }).format(at)

/** The calendar day as a number, in a zone: what "the same day" and "the next day" are measured on. */
const dayNumber = (at: Date, timeZone: string): number => {
  const parts = partsOf(at, 'en', timeZone, { year: 'numeric', month: 'numeric', day: 'numeric' })
  return (
    Date.UTC(numberPart(parts, 'year'), numberPart(parts, 'month') - 1, numberPart(parts, 'day')) /
    DAY_MS
  )
}

/** "19 h – 2 h"; an end more than a day later says its own day: "19 h – lundi 2 h". */
const hoursLabel = (start: Date, end: Date | null, lang: Locale, timeZone: string): string => {
  const from = hourLabel(start, lang, timeZone)
  if (end === null) return from
  const to = hourLabel(end, lang, timeZone)
  const later = dayNumber(end, timeZone) - dayNumber(start, timeZone)
  return later <= 1 ? `${from} – ${to}` : `${from} – ${weekdayLabel(end, lang, timeZone)} ${to}`
}

export interface WhenParts {
  /** "samedi 13 décembre 2026", in the invitation's zone. */
  readonly day: string
  /** "19 h – 2 h", in the invitation's zone. */
  readonly hours: string
  /**
   * What the same moment is where the **reader** is, when that is not the same thing said: the
   * reader's weekday and hour, and the place's name taken from the zone. `null` when the reader
   * is in the invitation's zone, or in one that gives the same day and hour.
   */
  readonly viewer: { readonly when: string; readonly place: string } | null
}

/** The last segment of a zone, as a place: `America/Montreal` is `Montreal`, `Port_of_Spain` is `Port of Spain`. */
const placeOf = (timeZone: string): string =>
  (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ')

export const whenParts = (when: InviteWhen, lang: Locale, viewerTimeZone: string): WhenParts => {
  const start = new Date(when.startsAt)
  const end = when.endsAt === null ? null : new Date(when.endsAt)
  const day = dayLabel(start, lang, when.timeZone)
  const hours = hoursLabel(start, end, lang, when.timeZone)

  const there = `${day} ${hourLabel(start, lang, when.timeZone)}`
  const here = `${dayLabel(start, lang, viewerTimeZone)} ${hourLabel(start, lang, viewerTimeZone)}`
  const viewer =
    there === here
      ? null
      : {
          when: `${weekdayLabel(start, lang, viewerTimeZone)} ${hourLabel(start, lang, viewerTimeZone)}`,
          place: placeOf(viewerTimeZone),
        }
  return { day, hours, viewer }
}

/**
 * One line: "samedi 13 décembre 2026, 19 h – 2 h", in the invitation's zone, and followed by that
 * zone's short name (`UTC+1`) when the reader is somewhere the hour reads differently, so a line
 * pasted into a message does not mislead.
 */
export const whenLabel = (when: InviteWhen, lang: Locale, viewerTimeZone: string): string => {
  const { day, hours, viewer } = whenParts(when, lang, viewerTimeZone)
  const start = new Date(when.startsAt)
  const zone =
    partsOf(start, lang, when.timeZone, { timeZoneName: 'short' }).find(
      (part) => part.type === 'timeZoneName',
    )?.value ?? when.timeZone
  return `${day}, ${hours}${viewer === null ? '' : ` (${zone})`}`
}

// --------------------------------------------------------------------------- directions --

/**
 * "Itinéraire": a search on OpenStreetMap, built here from what the host wrote with every part
 * encoded. Nothing is geocoded by EventSlide and nothing the host typed becomes a link of its own:
 * the one outgoing address is ours. `null` when there is neither a place nor an address.
 */
export const itineraryHref = (venueName: string | null, address: string | null): string | null => {
  const query = [venueName, address?.split('\n').join(', ')]
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(', ')
  return query === ''
    ? null
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`
}

// ---------------------------------------------------------------------------- the .ics --

export interface IcsInvite {
  /** The link's token: only its **digest** goes into the file (`UID`), the link itself rides in `DESCRIPTION`. */
  readonly token: string
  readonly title: string
  readonly when: InviteWhen
  readonly venueName: string | null
  readonly address: string | null
  readonly message: string | null
}

/**
 * The token as the server reads it: case, separators and the look-alike characters folded (the
 * join code's rule), so `/i/abc…` and `/i/ABC…` are one invitation and one calendar event.
 */
const normaliseToken = (token: string): string =>
  token
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')

/** Without an end, a party lasts this long in the calendar. */
const DEFAULT_DURATION_MS = 4 * 60 * 60 * 1000

/** The first `count` primes: the constants of SHA-256 are the fractional parts of their roots. */
const firstPrimes = (count: number): number[] => {
  const found: number[] = []
  for (let candidate = 2; found.length < count; candidate += 1) {
    if (found.every((prime) => candidate % prime !== 0)) found.push(candidate)
  }
  return found
}

/** SHA-256, hex. Small and synchronous, so the file is a pure function of the invitation. */
export const sha256Hex = (text: string): string => {
  const primes = firstPrimes(64)
  const fraction = (value: number): number => Math.floor((value % 1) * 2 ** 32)
  const K = Uint32Array.from(primes, (prime) => fraction(prime ** (1 / 3)))
  const H = Uint32Array.from(primes.slice(0, 8), (prime) => fraction(prime ** 0.5))
  const bytes = new TextEncoder().encode(text)
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  new DataView(padded.buffer).setUint32(padded.length - 4, (bytes.length * 8) >>> 0)
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 2 ** 32))
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))
  const w = new Uint32Array(64)
  for (let block = 0; block < padded.length; block += 64) {
    const view = new DataView(padded.buffer, block, 64)
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(t * 4)
    for (let t = 16; t < 64; t += 1) {
      const a = w[t - 15] ?? 0
      const b = w[t - 2] ?? 0
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H as unknown as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    ;[a, b, c, d, e, f, g, h].forEach((value, i) => {
      H[i] = ((H[i] ?? 0) + value) >>> 0
    })
  }
  return Array.from(H, (word) => word.toString(16).padStart(8, '0')).join('')
}

const stamp = (at: Date): string =>
  at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')

/**
 * RFC 5545 text: backslash, semicolon and comma escaped, a line break written `\n`, a carriage
 * return dropped. Without that last two a host's word could end its own line and start another
 * property of the event (`\r\nATTENDEE:`).
 */
const escapeText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // Every C0 control but the line feed (and DEL): none can be written in a text value, and
    // each is one more way to end a line the parser would read as a new property.
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n/g, '\\n')

/** A content line longer than 75 octets is folded: CRLF and one space, never inside a character. */
const fold = (line: string): string => {
  const chunks: string[] = []
  let current = ''
  let used = 0
  for (const character of line) {
    const size = new TextEncoder().encode(character).length
    // A continuation line starts with the space, which counts: 74 octets of text after it.
    const limit = chunks.length === 0 ? 75 : 74
    if (used + size > limit) {
      chunks.push(current)
      current = ''
      used = 0
    }
    current += character
    used += size
  }
  chunks.push(current)
  return chunks.join('\r\n ')
}

/**
 * The invitation as one calendar event (`.ics`), produced in the browser: nothing is sent anywhere.
 * `UID` is a digest of the token (the token itself is not copied into every file that gets shared;
 * it is in `DESCRIPTION` through the link, which is meant). `now` is injected for `DTSTAMP`.
 */
export const icsOf = (invite: IcsInvite, url: string, now: Date): string => {
  const start = new Date(invite.when.startsAt)
  const end =
    invite.when.endsAt === null
      ? new Date(start.getTime() + DEFAULT_DURATION_MS)
      : new Date(invite.when.endsAt)
  const place = [invite.venueName, invite.address?.split('\n').join(', ')]
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(', ')
  const description = [invite.message, url]
    .filter((part) => part !== null && part !== '')
    .join('\n\n')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EventSlide//Invitation//EN',
    'BEGIN:VEVENT',
    `UID:${sha256Hex(normaliseToken(invite.token)).slice(0, 32)}@${new URL(url).host}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(invite.title)}`,
    ...(place === '' ? [] : [`LOCATION:${escapeText(place)}`]),
    `DESCRIPTION:${escapeText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

// ------------------------------------------------------------------- the host's form --

/** What a `datetime-local` value looks like: `YYYY-MM-DDTHH:mm`, with no zone at all. */
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** The wall clock of an instant in a zone, as if it were UTC: what two instants are compared on. */
const wallClockMs = (at: number, timeZone: string): number => {
  const parts = partsOf(new Date(at), 'en', timeZone, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  })
  return Date.UTC(
    numberPart(parts, 'year'),
    numberPart(parts, 'month') - 1,
    numberPart(parts, 'day'),
    numberPart(parts, 'hour'),
    numberPart(parts, 'minute'),
  )
}

export type LocalInputResult =
  | { readonly ok: true; readonly instant: string }
  /** `invalid`: not a date and a time. `nonexistent`: the clocks skipped that hour (spring). */
  | { readonly ok: false; readonly reason: 'invalid' | 'nonexistent' }

/**
 * A `datetime-local` value read **in the invitation's zone** (the browser's own zone is where the
 * host happens to be, not where the party is), as an ISO instant.
 *
 * The two days a year the clocks move: an hour that does not exist (the spring skip) is refused,
 * so a host is told rather than given a time one hour off; an hour that happens twice (the autumn
 * repeat) is the **first** occurrence.
 */
export const localInputToInstant = (value: string, timeZone: string): LocalInputResult => {
  const match = LOCAL_INPUT.exec(value)
  if (match === null) return { ok: false, reason: 'invalid' }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const wanted = Date.UTC(year, month - 1, day, hour, minute)
  // `Date` rolls 31 February to March and hour 25 to the next day: each field is checked as typed.
  if (new Date(wanted).getUTCMonth() !== month - 1 || hour > 23 || minute > 59) {
    return { ok: false, reason: 'invalid' }
  }

  // The offset on either side of the moment bounds every offset it can have; each, applied, is a
  // candidate, and a candidate is real only if the clock in that zone reads what was typed.
  const offsets = new Set(
    [-DAY_MS, DAY_MS].map((shift) => wallClockMs(wanted + shift, timeZone) - (wanted + shift)),
  )
  const real = [...offsets]
    .map((offset) => wanted - offset)
    .filter((at) => wallClockMs(at, timeZone) === wanted)
    .sort((a, b) => a - b)
  const first = real[0]
  return first === undefined
    ? { ok: false, reason: 'nonexistent' }
    : { ok: true, instant: new Date(first).toISOString() }
}

/** An instant as a `datetime-local` value in a zone: the other way of {@link localInputToInstant}. */
export const instantToLocalInput = (instant: string, timeZone: string): string =>
  new Date(wallClockMs(Date.parse(instant), timeZone)).toISOString().slice(0, 16)
