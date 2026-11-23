import type { EventTemplateKey } from '../events/eventTemplate'
import { DomainError } from '../shared/errors'
import { isPlainObject } from '../shared/plainObject'
import { err, ok, type Result } from '../shared/result'

/**
 * What a host asks guests when they answer an invitation (spec 30, section 4.1).
 *
 * The whole form is modelled from the first lot, so a stored form never changes shape: the
 * fields of lots 2 and 4 (companions, meals, questions, who comes, capacity, moments, the
 * absent's word) exist with their defaults and nothing edits them yet. A later pull request
 * widens {@link RsvpFormPatch} and {@link restoreRsvpForm}, not the type.
 */

export const PARTY_SIZE_MIN = 1
export const PARTY_SIZE_MAX = 10

export type RsvpVisibility = 'off' | 'count' | 'names'

export interface RsvpQuestion {
  /** Short, random, **stable**: an answer keeps pointing at it when the host rewrites the label. */
  readonly id: string
  readonly label: string
  readonly kind: 'text' | 'choice'
  readonly options?: readonly string[]
}

export interface RsvpMoment {
  readonly id: string
  readonly label: string
}

export interface RsvpForm {
  /** Offers "peut-être". */
  readonly maybe: boolean
  /** Asks how many come; `max` is the most one reply may bring (adults and children together). */
  readonly partySize: { readonly enabled: boolean; readonly max: number }
  /** Asks children apart from adults. */
  readonly kidsSeparate: boolean
  /** Asks about allergies and diets. */
  readonly diet: boolean
  // Lot 2
  readonly companionNames: boolean
  readonly meals: { readonly enabled: boolean; readonly options: readonly string[] }
  readonly questions: readonly RsvpQuestion[]
  readonly visibility: RsvpVisibility
  // Lot 4
  readonly capacity: number | null
  readonly moments: readonly RsvpMoment[]
  readonly absentNote: boolean
}

/**
 * The form a host starts from. A wedding does not offer "peut-être" (a couple needs a count) and
 * allows a larger party, and wants the companions' names. The event does not keep which template
 * it came from, so the caller that knows it (the host's panel) passes it; everything else reads a
 * stored form, or {@link DEFAULT_RSVP_FORM}.
 */
export const defaultRsvpForm = (template: EventTemplateKey | null): RsvpForm => {
  const wedding = template === 'wedding'
  return {
    maybe: !wedding,
    partySize: { enabled: true, max: wedding ? 6 : 4 },
    kidsSeparate: true,
    diet: true,
    companionNames: wedding,
    meals: { enabled: false, options: [] },
    questions: [],
    visibility: 'off',
    capacity: null,
    moments: [],
    absentNote: true,
  }
}

export const DEFAULT_RSVP_FORM: RsvpForm = defaultRsvpForm(null)

/** The only keys lot 1 accepts in a form patch: a later lot adds its own to this list. */
const PATCHABLE: readonly string[] = ['maybe', 'partySize', 'kidsSeparate', 'diet']

/** The fields a host may change in lot 1. An absent field is left as it was. */
export interface RsvpFormPatch {
  readonly maybe?: unknown
  readonly partySize?: unknown
  readonly kidsSeparate?: unknown
  readonly diet?: unknown
}

const isMax = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= PARTY_SIZE_MIN &&
  value <= PARTY_SIZE_MAX

const flag = (raw: unknown, current: boolean): Result<boolean, DomainError> =>
  raw === undefined ? ok(current) : typeof raw === 'boolean' ? ok(raw) : err(invalidForm())

const invalidForm = (): DomainError => DomainError.invalid('rsvp.formInvalid')

/** `current` with `patch` applied, every changed field judged. */
export const applyFormPatch = (
  current: RsvpForm,
  rawPatch: unknown,
): Result<RsvpForm, DomainError> => {
  // Not an object, or a key this lot does not know: `rsvp.formInvalid`, never a silent ignore.
  if (!isPlainObject(rawPatch) || Object.keys(rawPatch).some((key) => !PATCHABLE.includes(key))) {
    return err(invalidForm())
  }
  const patch: RsvpFormPatch = rawPatch
  const maybe = flag(patch.maybe, current.maybe)
  if (!maybe.ok) return maybe
  const kidsSeparate = flag(patch.kidsSeparate, current.kidsSeparate)
  if (!kidsSeparate.ok) return kidsSeparate
  const diet = flag(patch.diet, current.diet)
  if (!diet.ok) return diet

  let partySize = current.partySize
  if (patch.partySize !== undefined) {
    if (!isPlainObject(patch.partySize)) return err(invalidForm())
    const { enabled, max } = patch.partySize
    if (enabled !== undefined && typeof enabled !== 'boolean') return err(invalidForm())
    if (max !== undefined && !isMax(max)) {
      return err(
        DomainError.invalid('rsvp.partyMaxInvalid', { min: PARTY_SIZE_MIN, max: PARTY_SIZE_MAX }),
      )
    }
    partySize = { enabled: enabled ?? current.partySize.enabled, max: max ?? current.partySize.max }
  }

  return ok({
    ...current,
    maybe: maybe.value,
    partySize,
    kidsSeparate: kidsSeparate.value,
    diet: diet.value,
  })
}

/**
 * A stored form read back, **never failing**: an unknown field is ignored and a value out of
 * bounds is brought back to the default, so a rule tightened later cannot make a printed
 * invitation's page vanish. Lot 2 and 4 fields stay at their defaults until their own pull
 * request teaches this function to read them.
 */
export const restoreRsvpForm = (raw: unknown): RsvpForm => {
  if (!isPlainObject(raw)) return DEFAULT_RSVP_FORM
  const size = isPlainObject(raw['partySize']) ? raw['partySize'] : {}
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback
  return {
    ...DEFAULT_RSVP_FORM,
    maybe: bool(raw['maybe'], DEFAULT_RSVP_FORM.maybe),
    partySize: {
      enabled: bool(size['enabled'], DEFAULT_RSVP_FORM.partySize.enabled),
      max: isMax(size['max']) ? size['max'] : DEFAULT_RSVP_FORM.partySize.max,
    },
    kidsSeparate: bool(raw['kidsSeparate'], DEFAULT_RSVP_FORM.kidsSeparate),
    diet: bool(raw['diet'], DEFAULT_RSVP_FORM.diet),
  }
}
