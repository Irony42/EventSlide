import { DomainError } from '../shared/errors'
import { isPlainObject } from '../shared/plainObject'
import { err, ok, type Result } from '../shared/result'
import { label, lower } from './rsvpFormExtras'
import type { GuestHousehold } from './household'
import type { GuestRsvp } from './rsvp'
import type { RsvpMoment } from './rsvpForm'

/**
 * The moments of the party (spec 30, lot 4: "le brunch du dimanche", "la soirée"): 0 to 4 labelled
 * parts of the day a guest may come to. Judged here so the host's save and the tolerant read of a
 * stored form share one set of bounds.
 *
 * A moment's id is short, random and **stable** (as a question's): a reply points at it, and a
 * household's own list of moments too, whatever the host rewrites the label into.
 */

export const MOMENTS_MAX = 4
export const MOMENT_LABEL_MAX_CHARS = 40
/** A moment's id: four random bytes as eight hex characters, like a question's. */
const MOMENT_ID_PATTERN = /^[0-9a-f]{8}$/

/**
 * `moments` after a patch: the whole list is sent, in the order the host wants. A moment with an `id`
 * is one of the current ones (its replies keep pointing at it whatever its label becomes); one without
 * gets a new id from `mintId`. Labels are 1 to 40 characters, distinct without regard to case.
 */
export const applyMomentsPatch = (
  current: readonly RsvpMoment[],
  raw: unknown,
  mintId: () => string,
): Result<readonly RsvpMoment[], DomainError> => {
  const invalid = (): DomainError =>
    DomainError.invalid('rsvp.momentsInvalid', { max: MOMENTS_MAX })
  if (!Array.isArray(raw) || raw.length > MOMENTS_MAX) return err(invalid())
  const known = new Set(current.map((moment) => moment.id))
  const usedIds = new Set<string>()
  const usedLabels = new Set<string>()
  const result: RsvpMoment[] = []
  for (const item of raw) {
    if (!isPlainObject(item) || Object.keys(item).some((key) => key !== 'id' && key !== 'label')) {
      return err(invalid())
    }
    const text = label(item['label'], MOMENT_LABEL_MAX_CHARS)
    if (text === null || usedLabels.has(lower(text))) return err(invalid())
    let id: string
    if (item['id'] === undefined) {
      id = mintId()
    } else if (typeof item['id'] === 'string' && known.has(item['id'])) {
      id = item['id']
    } else {
      return err(invalid())
    }
    if (usedIds.has(id)) return err(invalid())
    usedIds.add(id)
    usedLabels.add(lower(text))
    result.push({ id, label: text })
  }
  return ok(result)
}

/** Moments read back from a store: the ones that hold, at most four, in order; the rest is dropped. */
export const restoreMoments = (raw: unknown): readonly RsvpMoment[] => {
  if (!Array.isArray(raw)) return []
  const usedIds = new Set<string>()
  const usedLabels = new Set<string>()
  const result: RsvpMoment[] = []
  for (const item of raw) {
    if (result.length === MOMENTS_MAX) break
    if (!isPlainObject(item)) continue
    const id = item['id']
    const text = label(item['label'], MOMENT_LABEL_MAX_CHARS)
    if (
      text === null ||
      typeof id !== 'string' ||
      !MOMENT_ID_PATTERN.test(id) ||
      usedIds.has(id) ||
      usedLabels.has(lower(text))
    ) {
      continue
    }
    usedIds.add(id)
    usedLabels.add(lower(text))
    result.push({ id, label: text })
  }
  return result
}

/**
 * The moments a household is invited to, **among those the form has today**, in the form's order:
 * `null` (the default) is all of them. A moment the host removed from the form is no longer asked of
 * anyone, so a household's list naming it simply loses it. **A list none of whose ids survives is
 * invited to all**: a household must never be left with nothing to answer, nor go uncounted.
 */
export const momentsOfHousehold = (
  formMoments: readonly RsvpMoment[],
  invited: readonly string[] | null,
): readonly RsvpMoment[] => {
  if (invited === null) return formMoments
  const surviving = formMoments.filter((moment) => invited.includes(moment.id))
  return surviving.length === 0 ? formMoments : surviving
}

/**
 * The replies with their moments **narrowed to the ones that mean something today**: the form's own
 * moments, and for a reply filed under a household only those that household is invited to (a reply
 * is never counted at a moment its household is not invited to, whatever it once ticked). Read
 * paths only (figures, spreadsheets, the table): nothing stored changes.
 */
export const narrowMoments = (
  rsvps: readonly GuestRsvp[],
  formMoments: readonly RsvpMoment[],
  households: readonly GuestHousehold[],
): readonly GuestRsvp[] => {
  const byId = new Map(households.map((household) => [household.id as string, household]))
  return rsvps.map((rsvp) => {
    const household = rsvp.householdId === null ? undefined : byId.get(rsvp.householdId)
    const allowed = (
      household === undefined ? formMoments : momentsOfHousehold(formMoments, household.moments)
    ).map((moment) => moment.id)
    const kept = formMoments
      .filter((moment) => allowed.includes(moment.id) && rsvp.details.moments.includes(moment.id))
      .map((moment) => moment.id)
    return kept.length === rsvp.details.moments.length &&
      kept.every((id, at) => id === rsvp.details.moments[at])
      ? rsvp
      : rsvp.withMoments(kept)
  })
}

/**
 * The moments a household is invited to, as the host typed them: `null` for all, else 1 to 4 distinct
 * ids **of the form's moments** (`household.momentsInvalid` otherwise: a list naming a moment the form
 * does not have, an empty list, or a form with no moments at all). Listing every moment is the same as
 * `null`, and is stored as `null`, so a moment the host adds later reaches that household too.
 */
export const parseHouseholdMoments = (
  raw: unknown,
  formMoments: readonly RsvpMoment[],
): Result<readonly string[] | null, DomainError> => {
  if (raw === null) return ok(null)
  const invalid = (): DomainError =>
    DomainError.invalid('household.momentsInvalid', { max: MOMENTS_MAX })
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MOMENTS_MAX) return err(invalid())
  const asked = new Set(formMoments.map((moment) => moment.id))
  const seen = new Set<string>()
  for (const id of raw) {
    if (typeof id !== 'string' || !asked.has(id) || seen.has(id)) return err(invalid())
    seen.add(id)
  }
  // Written in the form's order, whatever order they were sent in.
  const invited = formMoments.filter((moment) => seen.has(moment.id)).map((moment) => moment.id)
  return ok(invited.length === formMoments.length ? null : invited)
}

/** A household's stored moments read back, never failing: a malformed list is "all". */
export const restoreHouseholdMoments = (raw: unknown): readonly string[] | null => {
  if (!Array.isArray(raw)) return null
  const ids = raw.filter((id): id is string => typeof id === 'string' && MOMENT_ID_PATTERN.test(id))
  return ids.length === 0 ? null : [...new Set(ids)].slice(0, MOMENTS_MAX)
}
