import type { EventLanguage } from '../events/eventLanguage'
import { MS_PER_DAY } from '../shared/time'

/** What a missing or unreadable time zone becomes: the zone most hosts of the product live in. */
export const DEFAULT_BOOK_TIME_ZONE = 'Europe/Paris'

/**
 * The canonical IANA name of a zone the host's browser sent, or the default.
 *
 * Validated by asking `Intl` to build a formatter, which accepts `UTC` and the aliases that
 * `Intl.supportedValuesOf('timeZone')` would refuse. The raw string never reaches the plan.
 */
export const normalizeTimeZone = (raw: unknown): string => {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 64) return DEFAULT_BOOK_TIME_ZONE
  try {
    return new Intl.DateTimeFormat('en', { timeZone: raw }).resolvedOptions().timeZone
  } catch {
    return DEFAULT_BOOK_TIME_ZONE
  }
}

export interface LocalParts {
  readonly hour: number
  readonly minute: number
  /** 0 = Sunday. */
  readonly weekday: number
  /** Whole days since 1970-01-01 of the **local calendar date**. */
  readonly dayNumber: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const known = formatters.get(timeZone)
  if (known !== undefined) return known
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  })
  formatters.set(timeZone, made)
  return made
}

/** The wall-clock reading of an instant in a zone. `timeZone` must come from `normalizeTimeZone`. */
export const localParts = (ms: number, timeZone: string): LocalParts => {
  const value: Record<string, string> = {}
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms)))
    value[part.type] = part.value
  const dayNumber = Math.floor(
    Date.UTC(Number(value['year']), Number(value['month']) - 1, Number(value['day'])) / MS_PER_DAY,
  )
  // 1970-01-01 was a Thursday.
  return {
    hour: Number(value['hour']) % 24,
    minute: Number(value['minute']),
    weekday: (((dayNumber + 4) % 7) + 7) % 7,
    dayNumber,
  }
}

/** The hour at which one "day" of a party ends and the next begins: a 1 a.m. photo is last night's. */
export const DAY_CUT_HOUR = 5

export interface PartyDay {
  /** Local day number, the day cut at 5 a.m. applied. */
  readonly dayNumber: number
  readonly weekday: number
}

export const partyDayOf = (parts: LocalParts): PartyDay =>
  parts.hour < DAY_CUT_HOUR
    ? { dayNumber: parts.dayNumber - 1, weekday: (parts.weekday + 6) % 7 }
    : { dayNumber: parts.dayNumber, weekday: parts.weekday }

export type DayMoment = 'morning' | 'afternoon' | 'evening' | 'night'

/** 5-12 morning, 12-18 afternoon, 18-23 evening, 23-5 night. */
export const dayMomentOf = (hour: number): DayMoment => {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 23) return 'evening'
  return 'night'
}

const two = (n: number): string => String(n).padStart(2, '0')

/** A clock reading as the language writes it: "19 h 30", "7:30 PM", "19:30". */
export const formatClock = (hour: number, minute: number, language: EventLanguage): string => {
  switch (language) {
    case 'fr':
      return `${hour} h ${two(minute)}`
    case 'en':
      return `${hour % 12 === 0 ? 12 : hour % 12}:${two(minute)} ${hour < 12 ? 'AM' : 'PM'}`
    case 'de':
      return `${two(hour)}:${two(minute)}`
    case 'es':
    case 'it':
      return `${hour}:${two(minute)}`
  }
}

/** A calendar date in the language of the book, in the host's zone ("14 juin 2026"). */
export const formatLongDate = (ms: number, timeZone: string, language: EventLanguage): string =>
  new Intl.DateTimeFormat(language, { timeZone, dateStyle: 'long' }).format(new Date(ms))
