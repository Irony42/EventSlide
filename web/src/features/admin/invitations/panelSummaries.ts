import type { RsvpSettingsDto } from '../../../lib/api/dto'

/**
 * What the folded lines of the replies' panel and of its entry row say: counts read off the
 * settings, no wording (the wording is the table's). Pure, so each count is held by a test.
 */

/** How many of the optional questions and options the host switched on. */
export const optionCount = (settings: RsvpSettingsDto): number => {
  const { form } = settings
  return (
    [
      form.maybe,
      form.partySize.enabled,
      form.diet,
      form.companionNames,
      form.meals.enabled,
      form.absentNote,
      form.capacity !== null,
      form.visibility !== 'off',
    ].filter(Boolean).length +
    form.questions.length +
    form.moments.length
  )
}

/** A calendar day (`2026-12-06`) as "6 déc.": short, in the reader's language. */
export const shortDay = (day: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`),
  )
