/**
 * The guided tours the console can show an account once, and remembers having shown.
 *
 * A closed vocabulary rather than free text: the table's `CHECK` holds the same list, so a
 * client that sends a tour nobody wrote is refused at the edge instead of filling a row with a
 * name nothing will ever read. Adding a tour is adding a word here and a migration that widens
 * the `CHECK`.
 *
 * - `eventPage`: the first visit to an event's page (`/admin/events/:slug`), five steps that
 *   point at the "now" card, the access card, the lifecycle buttons, the two evening tiles and
 *   the overview.
 */
export const GUIDED_TOURS = ['eventPage'] as const

export type GuidedTour = (typeof GUIDED_TOURS)[number]

export const isGuidedTour = (value: unknown): value is GuidedTour =>
  typeof value === 'string' && (GUIDED_TOURS as readonly string[]).includes(value)
