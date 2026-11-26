import type { GuestOwnRsvpDto, GuestRsvpPageDto } from '../api/dto'
import type { UiText } from '../i18n/translations'

/**
 * The words of the guest's reply that are not a translation table (spec 30): pure functions, in the
 * language of the invitation, tested alone.
 */

/** "Léa Martin" is `Léa`: the first word, which is how a host's reply greets a guest. */
export const firstNameOf = (name: string): string => name.trim().split(/\s+/, 1).join('')

/** A name as two are compared: composed, trimmed, its runs of spaces one space, without case. */
const fold = (name: string): string =>
  name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase()

/**
 * Whether the reply is named as the household whose link opened the page ("Famille Martin", as the
 * page fills it in). **Such a name names no person**: its first word is not a first name. The server
 * holds to the same rule (`namesItsHousehold`, `src/domain/guestRsvps/household.ts`) for what it
 * publishes; this one is what the page says.
 */
export const namesItsHousehold = (name: string, householdName: string | null): boolean =>
  householdName !== null && fold(name) === fold(householdName)

/** The first name of the reply, or none when it is named as its household. */
export const personalFirstNameOf = (name: string, householdName: string | null): string =>
  namesItsHousehold(name, householdName) ? '' : firstNameOf(name)

/** How the page greets the reply: its first name, or the household's whole name ("Famille Martin"). */
export const greetingNameOf = (name: string, householdName: string | null): string =>
  namesItsHousehold(name, householdName) ? name.trim().replace(/\s+/gu, ' ') : firstNameOf(name)

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
  form: Omit<GuestRsvpPageDto['form'], 'limited'>,
  text: UiText['rsvp']['guest'],
): string => {
  if (reply.answer === 'no') return text.recapNo
  const head =
    reply.answer === 'maybe'
      ? text.recapMaybe
      : reply.answer === 'waitlist'
        ? text.recapWaitlist
        : text.recapYes
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

/** The labels of the moments `ids` names, among the form's today, in the form's order. */
export const momentLabels = (
  ids: readonly string[],
  form: { readonly moments: readonly { readonly id: string; readonly label: string }[] },
): readonly string[] =>
  form.moments.filter((moment) => ids.includes(moment.id)).map((moment) => moment.label)

/** The whole confirmation: the line, then what else was sent. Plain text, never a link. */
export const recapLines = (
  reply: GuestOwnRsvpDto,
  form: Omit<GuestRsvpPageDto['form'], 'limited'>,
  text: UiText['rsvp']['guest'],
): readonly string[] => [
  recapLine(reply, form, text),
  // Only the moments the form still has: a removed one has no label and is not told.
  ...(reply.answer !== 'no' && momentLabels(reply.moments, form).length > 0
    ? [text.recapMoments(momentLabels(reply.moments, form).join(', '))]
    : []),
  ...(reply.companions.some((name) => name !== '')
    ? [text.recapCompanions(reply.companions.filter((name) => name !== '').join(', '))]
    : []),
  ...(reply.meals.some((meal) => meal !== '')
    ? [text.recapMeals(reply.meals.filter((meal) => meal !== '').join(', '))]
    : []),
  ...(reply.showName ? [text.recapShowName] : []),
  ...(reply.diet === null ? [] : [text.recapDiet(reply.diet)]),
  ...reply.answers
    .filter((answer) => answer.value !== '')
    .map((answer) =>
      endsInPunctuation(answer.label)
        ? text.recapAsked(answer.label, answer.value)
        : text.recapAnswer(answer.label, answer.value),
    ),
  ...(reply.message === null ? [] : [text.recapMessage(reply.message)]),
]

/**
 * A host's question that already ends in its own mark ("Une chanson pour la piste ?", "Allergies :")
 * takes no colon after it: "? :" is two marks where one was written. The host's words stay as typed.
 */
export const endsInPunctuation = (label: string): boolean => /[?!:…？！：]\s*$/u.test(label)
