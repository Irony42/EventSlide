import { isEventLanguage, type EventLanguage } from '../events/eventLanguage'
import { DomainError } from '../shared/errors'
import { characterCount, toParagraphs, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'
import { MS_PER_DAY } from '../shared/time'

/**
 * What a host writes on a guest invitation (spec 29): the title, the moment, the place, the word.
 *
 * Plain text everywhere. **Content, not interface**: written in the guests' language, kept as
 * typed after cleaning, never translated, never rendered as a link or as markup (a host's text
 * must not become a phishing link), the same stance as the welcome message.
 */

export const TITLE_MAX_CHARS = 80
export const VENUE_MAX_CHARS = 80
export const ADDRESS_MAX_CHARS = 160
export const ADDRESS_MAX_LINES = 2
export const MESSAGE_MAX_CHARS = 500
export const MESSAGE_MAX_LINES = 8
/** An invitation describes one occasion: a window longer than a week is a typing mistake. */
export const MAX_DURATION_DAYS = 7
const TIME_ZONE_MAX_CHARS = 64

export interface GuestInviteContent {
  /** `null`: the event's name is shown instead (not stored twice). */
  readonly title: string | null
  readonly startsAt: Date | null
  readonly endsAt: Date | null
  /** An IANA identifier. Present whenever `startsAt` is. */
  readonly timeZone: string | null
  readonly venueName: string | null
  readonly address: string | null
  readonly message: string | null
  readonly language: EventLanguage
}

/**
 * The fields of a save, as they arrive. **An absent field is left as it was; `null` clears it.**
 * The domain parses every one, so each refusal carries its own code and limits.
 */
export interface GuestInviteContentPatch {
  readonly title?: unknown
  readonly startsAt?: unknown
  readonly endsAt?: unknown
  readonly timeZone?: unknown
  readonly venueName?: unknown
  readonly address?: unknown
  readonly message?: unknown
  readonly language?: unknown
}

/** What a stored row holds, before the lenient read back. */
export interface RawGuestInviteContent {
  readonly title: unknown
  readonly startsAt: unknown
  readonly endsAt: unknown
  readonly timeZone: unknown
  readonly venueName: unknown
  readonly address: unknown
  readonly message: unknown
  readonly language: unknown
}

// ------------------------------------------------------------------------ one field each --

const parseSingleLine = (
  raw: unknown,
  max: number,
  field: 'title' | 'venue',
): Result<string | null, DomainError> => {
  if (raw === null) return ok(null)
  if (typeof raw !== 'string') return err(DomainError.invalid(`guestInvite.${field}Invalid`))
  const cleaned = toSingleLine(raw)
  if (cleaned.length === 0) return ok(null)
  if (characterCount(cleaned) > max) {
    return err(DomainError.invalid(`guestInvite.${field}TooLong`, { max }))
  }
  return ok(cleaned)
}

const parseLines = (
  raw: unknown,
  limits: { readonly maxChars: number; readonly maxLines: number },
  field: 'address' | 'message',
): Result<string | null, DomainError> => {
  if (raw === null) return ok(null)
  if (typeof raw !== 'string') return err(DomainError.invalid(`guestInvite.${field}Invalid`))
  const cleaned = toParagraphs(raw)
  if (cleaned.length === 0) return ok(null)
  if (cleaned.split('\n').length > limits.maxLines) {
    return err(
      DomainError.invalid(`guestInvite.${field}TooManyLines`, { maxLines: limits.maxLines }),
    )
  }
  if (characterCount(cleaned) > limits.maxChars) {
    return err(DomainError.invalid(`guestInvite.${field}TooLong`, { max: limits.maxChars }))
  }
  return ok(cleaned)
}

/** An instant in ISO 8601 **with** an offset (`Z` or `+02:00`): a bare local time is ambiguous. */
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

/** The years an invitation may name: a party, not an archive. Also what `restoreContent` can re-read. */
const MIN_YEAR = 2000
const MAX_YEAR = 2100

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * An instant that **is** a date: `Date` would roll 31 February over to 3 March and read hour 24 as
 * the next day, so each written field is checked against the calendar first. The year is bounded
 * both as written and once the offset is applied, so what is stored always parses back.
 */
const parseInstant = (raw: unknown, code: string): Result<Date | null, DomainError> => {
  if (raw === null) return ok(null)
  const parts = typeof raw === 'string' ? INSTANT.exec(raw) : null
  if (typeof raw !== 'string' || parts === null) return err(DomainError.invalid(code))

  const [year, month, day, hour, minute] = parts.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const second = parts[6] === undefined ? 0 : Number(parts[6])
  const real =
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  if (!real) return err(DomainError.invalid(code))

  const at = new Date(raw)
  const inRange = at.getUTCFullYear() >= MIN_YEAR && at.getUTCFullYear() <= MAX_YEAR
  return inRange ? ok(at) : err(DomainError.invalid(code))
}

/**
 * The canonical IANA identifier the platform knows `timeZone` by, or `null`.
 * `Intl.DateTimeFormat` rather than `Intl.supportedValuesOf('timeZone')`, which omits `UTC` and
 * aliases that browsers send back; the platform's own spelling is what is kept (`europe/paris` is
 * stored `Europe/Paris`). An offset (`+02:00`) is not a zone, and neither is an abbreviation
 * (`EST`, `CET`, `GMT`) that Intl accepts as a legacy identifier: what is written is `UTC` or an
 * `Area/Location`, so the hour follows a country's rules when they change.
 */
const canonicalTimeZone = (timeZone: string): string | null => {
  // As written: Intl resolves `EST` to a city, which would hide that the host typed an abbreviation.
  if (!(timeZone.toUpperCase() === 'UTC' || timeZone.includes('/'))) return null
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone
    return resolved
  } catch {
    return null
  }
}

const parseTimeZone = (raw: unknown): Result<string | null, DomainError> => {
  if (raw === null) return ok(null)
  if (typeof raw !== 'string') return err(DomainError.invalid('guestInvite.badTimeZone'))
  const trimmed = raw.trim()
  if (trimmed.length === 0) return ok(null)
  const canonical = trimmed.length > TIME_ZONE_MAX_CHARS ? null : canonicalTimeZone(trimmed)
  return canonical === null ? err(DomainError.invalid('guestInvite.badTimeZone')) : ok(canonical)
}

const parseLanguage = (raw: unknown): Result<EventLanguage, DomainError> =>
  isEventLanguage(raw) ? ok(raw) : err(DomainError.invalid('guestInvite.languageInvalid'))

// ---------------------------------------------------------------------------- the whole --

/**
 * `current` with `patch` applied, every changed field judged, then the rules that tie fields
 * together: an end needs a start, comes after it and within {@link MAX_DURATION_DAYS}; a start
 * needs the zone it is read in.
 */
export const applyContentPatch = (
  current: GuestInviteContent,
  patch: GuestInviteContentPatch,
): Result<GuestInviteContent, DomainError> => {
  const title =
    patch.title === undefined
      ? ok(current.title)
      : parseSingleLine(patch.title, TITLE_MAX_CHARS, 'title')
  if (!title.ok) return title
  const startsAt =
    patch.startsAt === undefined
      ? ok(current.startsAt)
      : parseInstant(patch.startsAt, 'guestInvite.startsAtInvalid')
  if (!startsAt.ok) return startsAt
  const endsAt =
    patch.endsAt === undefined
      ? ok(current.endsAt)
      : parseInstant(patch.endsAt, 'guestInvite.endsAtInvalid')
  if (!endsAt.ok) return endsAt
  const timeZone =
    patch.timeZone === undefined ? ok(current.timeZone) : parseTimeZone(patch.timeZone)
  if (!timeZone.ok) return timeZone
  const venueName =
    patch.venueName === undefined
      ? ok(current.venueName)
      : parseSingleLine(patch.venueName, VENUE_MAX_CHARS, 'venue')
  if (!venueName.ok) return venueName
  const address =
    patch.address === undefined
      ? ok(current.address)
      : parseLines(
          patch.address,
          { maxChars: ADDRESS_MAX_CHARS, maxLines: ADDRESS_MAX_LINES },
          'address',
        )
  if (!address.ok) return address
  const message =
    patch.message === undefined
      ? ok(current.message)
      : parseLines(
          patch.message,
          { maxChars: MESSAGE_MAX_CHARS, maxLines: MESSAGE_MAX_LINES },
          'message',
        )
  if (!message.ok) return message
  const language =
    patch.language === undefined ? ok(current.language) : parseLanguage(patch.language)
  if (!language.ok) return language

  if (endsAt.value !== null) {
    if (startsAt.value === null) return err(DomainError.invalid('guestInvite.endNeedsStart'))
    const span = endsAt.value.getTime() - startsAt.value.getTime()
    if (span <= 0) return err(DomainError.invalid('guestInvite.endBeforeStart'))
    if (span > MAX_DURATION_DAYS * MS_PER_DAY) {
      return err(DomainError.invalid('guestInvite.tooLong', { maxDays: MAX_DURATION_DAYS }))
    }
  }
  if (startsAt.value !== null && timeZone.value === null) {
    return err(DomainError.invalid('guestInvite.timeZoneRequired'))
  }

  return ok({
    title: title.value,
    startsAt: startsAt.value,
    endsAt: endsAt.value,
    timeZone: timeZone.value,
    venueName: venueName.value,
    address: address.value,
    message: message.value,
    language: language.value,
  })
}

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.getTime() === b.getTime()

/** Whether two contents say the same thing (a save that changes nothing is not an edit). */
export const contentEquals = (a: GuestInviteContent, b: GuestInviteContent): boolean =>
  a.title === b.title &&
  sameInstant(a.startsAt, b.startsAt) &&
  sameInstant(a.endsAt, b.endsAt) &&
  a.timeZone === b.timeZone &&
  a.venueName === b.venueName &&
  a.address === b.address &&
  a.message === b.message &&
  a.language === b.language

const valueOr = <T>(result: Result<T, DomainError>, fallback: T): T =>
  result.ok ? result.value : fallback

/**
 * A stored row read back, **never failing**: a rule tightened later must not make a printed
 * invitation's page vanish, and a cosmetic field must not fail a read. A piece the rules refuse
 * becomes `null` (the page then simply shows less); a start whose zone is lost is dropped with
 * its end, which makes the page unavailable rather than showing a wrong hour.
 */
export const restoreContent = (
  raw: RawGuestInviteContent,
  fallbackLanguage: EventLanguage,
): GuestInviteContent => {
  const timeZone = valueOr(parseTimeZone(raw.timeZone), null)
  const startsAt = timeZone === null ? null : valueOr(parseInstant(raw.startsAt, 'x'), null)
  const storedEnd = startsAt === null ? null : valueOr(parseInstant(raw.endsAt, 'x'), null)
  const span =
    startsAt === null || storedEnd === null ? 0 : storedEnd.getTime() - startsAt.getTime()
  const endsAt = span > 0 && span <= MAX_DURATION_DAYS * MS_PER_DAY ? storedEnd : null

  return {
    title: valueOr(parseSingleLine(raw.title ?? null, TITLE_MAX_CHARS, 'title'), null),
    startsAt,
    endsAt,
    timeZone,
    venueName: valueOr(parseSingleLine(raw.venueName ?? null, VENUE_MAX_CHARS, 'venue'), null),
    address: valueOr(
      parseLines(
        raw.address ?? null,
        { maxChars: ADDRESS_MAX_CHARS, maxLines: ADDRESS_MAX_LINES },
        'address',
      ),
      null,
    ),
    message: valueOr(
      parseLines(
        raw.message ?? null,
        { maxChars: MESSAGE_MAX_CHARS, maxLines: MESSAGE_MAX_LINES },
        'message',
      ),
      null,
    ),
    language: valueOr(parseLanguage(raw.language), fallbackLanguage),
  }
}
