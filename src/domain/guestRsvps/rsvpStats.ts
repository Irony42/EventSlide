import type { GuestHousehold } from './household'
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
  /** Diets of those who come (a `maybe` is not told to the caterer): the name and what they wrote. */
  readonly diets: readonly { readonly name: string; readonly diet: string }[]
  /** The menus of those who come, most chosen first. */
  readonly meals: readonly { readonly label: string; readonly count: number }[]
  /**
   * The households of the guest list that have **no reply** (lot 3): how many, and the places kept
   * for them. A household that said `no` has replied. Zero while the event has no list.
   */
  readonly noReply: { readonly households: number; readonly places: number }
}

export const statsOf = (
  rsvps: readonly GuestRsvp[],
  households: readonly GuestHousehold[] = [],
): RsvpStats => {
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
        // A blank entry is a person who chose no menu: it counts for nobody.
        for (const meal of rsvp.details.meals) {
          if (meal !== '') meals.set(meal, (meals.get(meal) ?? 0) + 1)
        }
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
    // Those who come: a "peut-être" is not told to the caterer, in the panel, the file or the list.
    if (rsvp.answer === 'yes' && rsvp.diet !== null) {
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
    noReply: noReplyOf(households, rsvps),
    meals: [...meals]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  }
}

/**
 * Households no reply is attached to, with their places. A reply whose `householdId` names no
 * household of the list (a stale id: deleting a household detaches its reply in the same transaction,
 * so this is defensive) simply answers for nobody here: it is never counted twice nor dropped.
 */
const noReplyOf = (
  households: readonly GuestHousehold[],
  rsvps: readonly GuestRsvp[],
): RsvpStats['noReply'] => {
  const answered = new Set(
    rsvps.flatMap((rsvp) => (rsvp.householdId === null ? [] : [rsvp.householdId])),
  )
  const waiting = households.filter((household) => !answered.has(household.id))
  return {
    households: waiting.length,
    places: waiting.reduce((sum, household) => sum + household.places, 0),
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
): RsvpProof | null =>
  proofFrom(
    {
      yesPeople: rsvps
        .filter((rsvp) => rsvp.answer === 'yes')
        .reduce((sum, rsvp) => sum + rsvp.people, 0),
      names: namesToShow(rsvps),
    },
    visibility,
  )

/**
 * The names of the `yes` replies whose guest ticked "show my first name", **oldest reply first**
 * (ties: the smaller id). The one ordering rule: a repository that answers it in SQL must agree.
 */
export const namesToShow = (rsvps: readonly GuestRsvp[]): readonly string[] =>
  rsvps
    .filter((rsvp) => rsvp.answer === 'yes' && rsvp.details.showName)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
    .map((rsvp) => rsvp.name)

/**
 * The same line from the two figures a repository can answer without reading a reply's diet or
 * word: the people in the `yes` replies, and the names (in full, oldest first) of those who agreed
 * to be shown. The public page asks it on every read, so it must stay cheap.
 */
export const proofFrom = (
  parts: { readonly yesPeople: number; readonly names: readonly string[] },
  visibility: RsvpVisibility,
): RsvpProof | null => {
  if (visibility === 'off') return null
  if (visibility === 'count') return { count: parts.yesPeople, names: [] }
  return {
    count: parts.yesPeople,
    names: parts.names.slice(0, PROOF_MAX_NAMES).map((name) => name.split(' ')[0] as string),
  }
}
