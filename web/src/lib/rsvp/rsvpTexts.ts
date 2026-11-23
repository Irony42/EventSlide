import type { GuestOwnRsvpDto, GuestRsvpPageDto } from '../api/dto'
import type { UiText } from '../i18n/translations'

/**
 * The words of the guest's reply that are not a translation table (spec 30): pure functions, in the
 * language of the invitation, tested alone.
 */

/** "Léa Martin" is `Léa`: the first word, which is how a host's reply greets a guest. */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/, 1).join('')

/**
 * A deadline day (`2026-12-01`, a local day) as a date in the invitation's language: written in UTC
 * from the day's own parts, so the reader's time zone cannot move it by one.
 */
export const deadlineLabel = (day: string, locale: string): string => {
  const [year, month, date] = day.split('-').map(Number)
  if (year === undefined || month === undefined || date === undefined) return day
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, date)))
}

/** One or other, the way all five languages of the product count: exactly one, or more (or none). */
export const plural = (
  count: number,
  forms: { readonly one: string; readonly other: string },
): string => (count === 1 ? forms.one : forms.other)

/** One line of what the guest sent, for the confirmation and for the banner of a closed page. */
export const recapLine = (
  reply: GuestOwnRsvpDto,
  form: GuestRsvpPageDto['form'],
  text: UiText['rsvp']['guest'],
): string => {
  if (reply.answer === 'no') return text.recapNo
  const head = reply.answer === 'maybe' ? text.recapMaybe : text.recapYes
  if (!form.partySize.enabled) return head
  const people = reply.adults + reply.kids
  const kids =
    form.kidsSeparate && reply.kids > 0
      ? ` ${text.recapKids(reply.kids, plural(reply.kids, text.child))}`
      : ''
  return `${head} · ${people} ${plural(people, text.person)}${kids}`
}

/**
 * "Who comes", for the host's choice to show it: the count alone, or the first names that agreed
 * (at most three) and how many others come. Plain text.
 */
export const proofLine = (
  proof: NonNullable<GuestRsvpPageDto['proof']>,
  text: UiText['rsvp']['guest'],
): string => {
  const [first, ...rest] = proof.names
  if (first === undefined) {
    return proof.count === 1 ? text.proofCountOne : text.proofCount(proof.count)
  }
  const others = Math.max(proof.count - proof.names.length, 0)
  const names = proof.names.join(', ')
  if (others === 0) return rest.length === 0 ? text.proofNameOne(first) : text.proofNames(names)
  return others === 1 ? text.proofNamesAndOne(names) : text.proofNamesAndMany(names, others)
}

/** The whole confirmation: the line, then what else was sent. Plain text, never a link. */
export const recapLines = (
  reply: GuestOwnRsvpDto,
  form: GuestRsvpPageDto['form'],
  text: UiText['rsvp']['guest'],
): readonly string[] => [
  recapLine(reply, form, text),
  ...(reply.companions.length === 0 ? [] : [text.recapCompanions(reply.companions.join(', '))]),
  ...(reply.meals.length === 0 ? [] : [text.recapMeals(reply.meals.join(', '))]),
  ...(reply.diet === null ? [] : [text.recapDiet(reply.diet)]),
  ...reply.answers
    .filter((answer) => answer.value !== '')
    .map((answer) => text.recapAnswer(answer.label, answer.value)),
  ...(reply.message === null ? [] : [text.recapMessage(reply.message)]),
]
