import { DomainError } from '../shared/errors'
import { characterCount, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'
import {
  HOUSEHOLD_NAME_MAX_CHARS,
  HOUSEHOLD_PLACES_MAX,
  HOUSEHOLD_PLACES_MIN,
  type HouseholdInput,
} from './household'

/**
 * The host pastes a list, one household per line, `Nom ; places` (spec 30, lot 3). A line copied
 * from a spreadsheet separates its cells with a tab, which is read the same way.
 *
 * **Tolerant, and it says what it left out**: a blank line is nothing; a line with no number
 * keeps one place; a line whose name is empty or too long, or whose number is not a whole number
 * from 1 to 10, is skipped with its line number and the reason; a name already in the list (or
 * already pasted above it) is skipped as a duplicate, **without regard to case and accents**.
 * Only a paste of more than 300 lines is refused whole.
 */

export const HOUSEHOLD_IMPORT_MAX_LINES = 300

export type HouseholdSkipReason = 'name' | 'places' | 'duplicate'

export interface SkippedHouseholdLine {
  /** 1-based, counted over every line of the paste (a blank one included). */
  readonly line: number
  readonly reason: HouseholdSkipReason
}

export interface ParsedHouseholdList {
  readonly households: readonly HouseholdInput[]
  readonly skipped: readonly SkippedHouseholdLine[]
}

/** A name compared without case and accents: "Élodie" and "elodie" are one household. */
export const householdNameKey = (name: string): string =>
  name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The cell separator of a line: the last `;` or tab, so a name may hold the other one. */
const splitLine = (line: string): { name: string; places: string | null } => {
  const cut = Math.max(line.lastIndexOf(';'), line.lastIndexOf('\t'))
  return cut < 0
    ? { name: line, places: null }
    : { name: line.slice(0, cut), places: line.slice(cut + 1).trim() }
}

export const parseHouseholdList = (
  raw: unknown,
  existingNames: readonly string[],
): Result<ParsedHouseholdList, DomainError> => {
  if (typeof raw !== 'string') return err(DomainError.invalid('household.importInvalid'))
  const lines = raw.split(/\r\n|\r|\n/)
  if (lines.filter((line) => line.trim().length > 0).length > HOUSEHOLD_IMPORT_MAX_LINES) {
    return err(DomainError.invalid('household.importTooLong', { max: HOUSEHOLD_IMPORT_MAX_LINES }))
  }

  const seen = new Set(existingNames.map(householdNameKey))
  const households: HouseholdInput[] = []
  const skipped: SkippedHouseholdLine[] = []

  lines.forEach((line, index) => {
    if (line.trim().length === 0) return
    const number = index + 1
    const { name: rawName, places: rawPlaces } = splitLine(line)
    const name = toSingleLine(rawName)
    if (name.length === 0 || characterCount(name) > HOUSEHOLD_NAME_MAX_CHARS) {
      skipped.push({ line: number, reason: 'name' })
      return
    }
    let places = 1
    if (rawPlaces !== null && rawPlaces.length > 0) {
      places = /^\d{1,2}$/.test(rawPlaces) ? Number(rawPlaces) : 0
      if (places < HOUSEHOLD_PLACES_MIN || places > HOUSEHOLD_PLACES_MAX) {
        skipped.push({ line: number, reason: 'places' })
        return
      }
    }
    const key = householdNameKey(name)
    if (seen.has(key)) {
      skipped.push({ line: number, reason: 'duplicate' })
      return
    }
    seen.add(key)
    households.push({ name, places })
  })
  return ok({ households, skipped })
}
