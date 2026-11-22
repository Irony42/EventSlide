import type { GuestRsvp } from './rsvp'
import type { RsvpVisibility } from './rsvpForm'

/**
 * The figures of the replies (spec 30, section 4.4): **one function** for the table, the phone,
 * the badge and the export, so no two screens count differently.
 */
export interface RsvpStats {
  readonly yes: {
    readonly responses: number
    readonly people: number
    readonly adults: number
    readonly kids: number
  }
  readonly maybe: { readonly responses: number; readonly people: number }
  readonly no: { readonly responses: number }
  readonly waitlist: { readonly responses: number; readonly people: number }
  /** Diets of those who come or may come: the name and what they wrote. */
  readonly diets: readonly { readonly name: string; readonly diet: string }[]
  /** The menus of those who come, most chosen first. */
  readonly meals: readonly { readonly label: string; readonly count: number }[]
}

export const statsOf = (rsvps: readonly GuestRsvp[]): RsvpStats => {
  let yesResponses = 0
  let yesAdults = 0
  let yesKids = 0
  let maybeResponses = 0
  let maybePeople = 0
  let noResponses = 0
  let waitResponses = 0
  let waitPeople = 0
  const diets: { name: string; diet: string }[] = []
  const meals = new Map<string, number>()

  for (const rsvp of rsvps) {
    switch (rsvp.answer) {
      case 'yes':
        yesResponses += 1
        yesAdults += rsvp.adults
        yesKids += rsvp.kids
        for (const meal of rsvp.details.meals) meals.set(meal, (meals.get(meal) ?? 0) + 1)
        break
      case 'maybe':
        maybeResponses += 1
        maybePeople += rsvp.people
        break
      case 'no':
        noResponses += 1
        break
      case 'waitlist':
        waitResponses += 1
        waitPeople += rsvp.people
        break
    }
    if ((rsvp.answer === 'yes' || rsvp.answer === 'maybe') && rsvp.diet !== null) {
      diets.push({ name: rsvp.name, diet: rsvp.diet })
    }
  }

  return {
    yes: {
      responses: yesResponses,
      people: yesAdults + yesKids,
      adults: yesAdults,
      kids: yesKids,
    },
    maybe: { responses: maybeResponses, people: maybePeople },
    no: { responses: noResponses },
    waitlist: { responses: waitResponses, people: waitPeople },
    diets,
    meals: [...meals]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  }
}

export const PROOF_MAX_NAMES = 3

/** What the public invitation may say about who comes. */
export interface RsvpProof {
  /** People in the `yes` replies. */
  readonly count: number
  /** First names of the guests who agreed to be shown, at most {@link PROOF_MAX_NAMES}. */
  readonly names: readonly string[]
}

/**
 * The "who comes" line of the public page, or `null` when the host chose to show nothing.
 *
 * **Only `yes` replies are ever counted, and only a guest who ticked "show my first name" is
 * named**, by the first word of their name, oldest reply first. A `no`, a `maybe`, a waiting-list
 * entry, a message or a diet never reaches it.
 */
export const proofOf = (
  rsvps: readonly GuestRsvp[],
  visibility: RsvpVisibility,
): RsvpProof | null => {
  if (visibility === 'off') return null
  const yes = rsvps.filter((rsvp) => rsvp.answer === 'yes')
  const count = yes.reduce((sum, rsvp) => sum + rsvp.people, 0)
  if (visibility === 'count') return { count, names: [] }
  const names = yes
    .filter((rsvp) => rsvp.details.showName)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    .slice(0, PROOF_MAX_NAMES)
    .map((rsvp) => rsvp.name.split(' ')[0] as string)
  return { count, names }
}
