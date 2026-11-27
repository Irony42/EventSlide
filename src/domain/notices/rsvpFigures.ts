import type { RsvpStats } from '../guestRsvps/rsvpStats'

/**
 * What a mail may say about the replies (spec 32, principle 2): **numbers and the host's own words**,
 * never a guest's. It is a projection of {@link RsvpStats} with no nominative field: `diets` (a name and
 * what the guest wrote) is reduced to a count, the moments are left out, and the menus are the host's
 * own labels with their counts.
 *
 * The mail templates receive this type and nothing wider, and the projection is made here, in the
 * domain, so a template cannot reach a name by accident.
 */
export interface RsvpFigures {
  readonly yes: {
    readonly responses: number
    readonly people: number
    readonly adults: number
    readonly kids: number
  }
  readonly maybe: { readonly responses: number; readonly people: number }
  readonly no: { readonly responses: number }
  readonly waitlist: { readonly responses: number; readonly people: number }
  /** How many guests reported a diet. Never which, never what they wrote. */
  readonly dietCount: number
  /** The host's menu labels with how many chose each, most chosen first. */
  readonly meals: readonly { readonly label: string; readonly count: number }[]
  /** Households of the guest list with no reply: how many. */
  readonly noReplyHouseholds: number
}

/**
 * The figures of a mail.
 *
 * `menuLabels` is what the host wrote in the form (`form.meals.options`): a menu whose label is not
 * there (an option the host has since removed, or a text that is not one of theirs) is **left out**, so
 * a string a guest typed can never ride in a mail through the menus.
 */
export const rsvpFiguresOf = (stats: RsvpStats, menuLabels: readonly string[]): RsvpFigures => ({
  yes: { ...stats.yes },
  maybe: { ...stats.maybe },
  no: { ...stats.no },
  waitlist: { ...stats.waitlist },
  dietCount: stats.diets.length,
  meals: stats.meals
    .filter((meal) => menuLabels.includes(meal.label))
    .map((meal) => ({ label: meal.label, count: meal.count })),
  noReplyHouseholds: stats.noReply.households,
})
