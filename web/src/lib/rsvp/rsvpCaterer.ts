import type { RsvpDto } from '../api/dto'

/**
 * What the caterer is told, as data (spec 30, lot 2, no React). **The figures are the server's**
 * (`RsvpStatsDto`: one function for the tiles, the panel and the file); this only words the menus
 * of one reply and chooses the rows of the printed list.
 */

/**
 * The menus of one reply as a caterer reads them: each once, with how many when more than one
 * ("Poisson ×2, Végé"), in the order met. The file says the same (`mealsSummary`). A blank entry is
 * a person who chose none.
 */
export const mealsLabel = (meals: readonly string[]): string => {
  const counts = new Map<string, number>()
  for (const meal of meals) if (meal !== '') counts.set(meal, (counts.get(meal) ?? 0) + 1)
  return [...counts].map(([meal, count]) => (count === 1 ? meal : `${meal} ×${count}`)).join(', ')
}

/** The first names of those who come with a guest, the blank ones (nobody typed) left out. */
export const companionsLabel = (reply: RsvpDto): string =>
  reply.details.companions.filter((name) => name !== '').join(', ')

/** The replies of the printed list: those who come, by name (accents and case ignored). */
export const printRowsOf = (rsvps: readonly RsvpDto[]): readonly RsvpDto[] =>
  rsvps
    .filter((reply) => reply.answer === 'yes')
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
