import { DomainError } from '../shared/errors'
import { isPlainObject } from '../shared/plainObject'
import { characterCount, toSingleLine } from '../shared/plainText'
import { err, ok, type Result } from '../shared/result'
import type { RsvpQuestion } from './rsvpForm'

/**
 * The lot 2 fields of the form (spec 30, section 4.1): the menus and the host's own questions.
 * Judged here so the host's save and the tolerant read of a stored form share one set of bounds.
 */

export const MEAL_OPTIONS_MIN = 2
export const MEAL_OPTIONS_MAX = 6
export const MEAL_LABEL_MAX_CHARS = 40
export const QUESTIONS_MAX = 3
export const QUESTION_LABEL_MAX_CHARS = 80
export const CHOICE_OPTIONS_MIN = 2
export const CHOICE_OPTIONS_MAX = 6
export const CHOICE_LABEL_MAX_CHARS = 40
/** A question's id: four random bytes as eight hex characters. */
const QUESTION_ID_PATTERN = /^[0-9a-f]{8}$/

/** The id of a new question, from entropy the caller drew (the domain draws none). */
export const questionIdFromBytes = (bytes: Uint8Array): string =>
  Array.from(bytes.slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join('')

export const lower = (text: string): string => text.toLocaleLowerCase('en')

/** One short label: a single line, 1 to `max` characters, or `null`. */
export const label = (raw: unknown, max: number): string | null => {
  if (typeof raw !== 'string') return null
  const cleaned = toSingleLine(raw)
  return cleaned.length > 0 && characterCount(cleaned) <= max ? cleaned : null
}

/** Labels, each valid and all distinct without regard to case, or `null`. */
const labels = (raw: unknown, max: number, count: number): readonly string[] | null => {
  if (!Array.isArray(raw) || raw.length > count) return null
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of raw) {
    const cleaned = label(item, max)
    if (cleaned === null || seen.has(lower(cleaned))) return null
    seen.add(lower(cleaned))
    result.push(cleaned)
  }
  return result
}

export interface RsvpMeals {
  readonly enabled: boolean
  readonly options: readonly string[]
}

/**
 * `meals` after a patch. Options of a switched-off menu are kept (a draft: 0 to 6 labels); a menu
 * that is on needs 2 to 6.
 */
export const applyMealsPatch = (
  current: RsvpMeals,
  raw: unknown,
): Result<RsvpMeals, DomainError> => {
  const invalid = (): DomainError =>
    DomainError.invalid('rsvp.mealsInvalid', { min: MEAL_OPTIONS_MIN, max: MEAL_OPTIONS_MAX })
  if (
    !isPlainObject(raw) ||
    Object.keys(raw).some((key) => key !== 'enabled' && key !== 'options')
  ) {
    return err(invalid())
  }
  if (raw['enabled'] !== undefined && typeof raw['enabled'] !== 'boolean') return err(invalid())
  let options = current.options
  if (raw['options'] !== undefined) {
    const parsed = labels(raw['options'], MEAL_LABEL_MAX_CHARS, MEAL_OPTIONS_MAX)
    if (parsed === null) return err(invalid())
    options = parsed
  }
  const enabled = raw['enabled'] ?? current.enabled
  if (enabled && options.length < MEAL_OPTIONS_MIN) return err(invalid())
  return ok({ enabled, options })
}

/**
 * `questions` after a patch: the whole list is sent. A question with an `id` is one of the current
 * ones (its answers keep pointing at it whatever its label becomes); one without gets a new id from
 * `mintId`. A `choice` carries 2 to 6 distinct options, a `text` none.
 */
export const applyQuestionsPatch = (
  current: readonly RsvpQuestion[],
  raw: unknown,
  mintId: () => string,
): Result<readonly RsvpQuestion[], DomainError> => {
  const invalid = (): DomainError =>
    DomainError.invalid('rsvp.questionsInvalid', {
      max: QUESTIONS_MAX,
      optionsMin: CHOICE_OPTIONS_MIN,
      optionsMax: CHOICE_OPTIONS_MAX,
    })
  if (!Array.isArray(raw) || raw.length > QUESTIONS_MAX) return err(invalid())
  const known = new Set(current.map((question) => question.id))
  const used = new Set<string>()
  const result: RsvpQuestion[] = []
  for (const item of raw) {
    if (
      !isPlainObject(item) ||
      Object.keys(item).some((key) => !['id', 'label', 'kind', 'options'].includes(key))
    ) {
      return err(invalid())
    }
    const text = label(item['label'], QUESTION_LABEL_MAX_CHARS)
    if (text === null || (item['kind'] !== 'text' && item['kind'] !== 'choice')) {
      return err(invalid())
    }
    let id: string
    if (item['id'] === undefined) {
      id = mintId()
    } else if (typeof item['id'] === 'string' && known.has(item['id'])) {
      id = item['id']
    } else {
      return err(invalid())
    }
    if (used.has(id)) return err(invalid())
    used.add(id)
    if (item['kind'] === 'text') {
      if (item['options'] !== undefined) return err(invalid())
      result.push({ id, label: text, kind: 'text' })
      continue
    }
    const options = labels(item['options'], CHOICE_LABEL_MAX_CHARS, CHOICE_OPTIONS_MAX)
    if (options === null || options.length < CHOICE_OPTIONS_MIN) return err(invalid())
    result.push({ id, label: text, kind: 'choice', options })
  }
  return ok(result)
}

/** Meals read back from a store: a menu whose options do not hold is switched off, never an error. */
export const restoreMeals = (raw: unknown, fallback: RsvpMeals): RsvpMeals => {
  if (!isPlainObject(raw)) return fallback
  const options = labels(raw['options'], MEAL_LABEL_MAX_CHARS, MEAL_OPTIONS_MAX)
  if (options === null) return fallback
  const enabled = raw['enabled'] === true && options.length >= MEAL_OPTIONS_MIN
  return { enabled, options }
}

/** Questions read back: the ones that hold, at most three, in order; the rest is dropped. */
export const restoreQuestions = (raw: unknown): readonly RsvpQuestion[] => {
  if (!Array.isArray(raw)) return []
  const used = new Set<string>()
  const result: RsvpQuestion[] = []
  for (const item of raw) {
    if (result.length === QUESTIONS_MAX) break
    if (!isPlainObject(item)) continue
    const text = label(item['label'], QUESTION_LABEL_MAX_CHARS)
    const id = item['id']
    if (text === null || typeof id !== 'string' || !QUESTION_ID_PATTERN.test(id) || used.has(id)) {
      continue
    }
    if (item['kind'] === 'text') {
      used.add(id)
      result.push({ id, label: text, kind: 'text' })
    } else if (item['kind'] === 'choice') {
      const options = labels(item['options'], CHOICE_LABEL_MAX_CHARS, CHOICE_OPTIONS_MAX)
      if (options === null || options.length < CHOICE_OPTIONS_MIN) continue
      used.add(id)
      result.push({ id, label: text, kind: 'choice', options })
    }
  }
  return result
}
