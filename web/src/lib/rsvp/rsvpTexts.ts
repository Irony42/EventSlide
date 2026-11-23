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

/** One line of what the guest sent, for the confirmation and for the banner of a closed page. */
export const recapLine = (
  reply: GuestOwnRsvpDto,
  form: GuestRsvpPageDto['form'],
  text: UiText['rsvp']['guest'],
): string => {
  if (reply.answer === 'no') return text.recapNo
  const people = form.partySize.enabled ? reply.adults + reply.kids : null
  const kids = form.partySize.enabled && form.kidsSeparate ? reply.kids : 0
  return reply.answer === 'maybe' ? text.recapMaybe(people, kids) : text.recapYes(people, kids)
}

/** The whole confirmation: the line, then what else was sent. Plain text, never a link. */
export const recapLines = (
  reply: GuestOwnRsvpDto,
  form: GuestRsvpPageDto['form'],
  text: UiText['rsvp']['guest'],
): readonly string[] => [
  recapLine(reply, form, text),
  ...(reply.diet === null ? [] : [text.recapDiet(reply.diet)]),
  ...(reply.message === null ? [] : [text.recapMessage(reply.message)]),
]
