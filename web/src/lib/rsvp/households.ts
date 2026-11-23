import type { HouseholdDto, RsvpDto } from '../api/dto'
import { graphemesOf } from '../invite/cardTexts'
import type { UiText } from '../i18n/translations'

/**
 * The host's guest list as data (spec 30, lot 3, no React): which households wait for an answer,
 * how they are filtered and searched, the link each one holds, and the guided reminder's message
 * and the three addresses that open the host's own applications with it.
 *
 * **EventSlide holds no contact**: the addresses below carry no recipient (`wa.me/?text=`,
 * `sms:?&body=`, `mailto:?subject=`), so the host picks the person in their own application.
 */

export type HouseholdFilter = 'all' | 'pending' | 'answered'

export const HOUSEHOLD_FILTERS: readonly HouseholdFilter[] = ['all', 'pending', 'answered']

/** The households no reply is filed under: "sans réponse". A household that said no has answered. */
export const pendingOf = (households: readonly HouseholdDto[]): readonly HouseholdDto[] =>
  households.filter((household) => household.reply === null)

export const householdCounts = (
  households: readonly HouseholdDto[],
): Readonly<Record<HouseholdFilter, number>> => {
  const pending = pendingOf(households).length
  return { all: households.length, pending, answered: households.length - pending }
}

/** The places kept for every household of the list. */
export const placesOf = (households: readonly HouseholdDto[]): number =>
  households.reduce((sum, household) => sum + household.places, 0)

/** A name as it is searched: without case, accents or the spaces around ("elodie" finds "Élodie"). */
const fold = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

/** The households of a filter whose name holds what was typed, in the order the server gave. */
export const visibleHouseholds = (
  households: readonly HouseholdDto[],
  filter: HouseholdFilter,
  query: string,
): readonly HouseholdDto[] => {
  const needle = fold(query)
  return households.filter(
    (household) =>
      (filter === 'all' ||
        (filter === 'pending' ? household.reply === null : household.reply !== null)) &&
      fold(household.name).includes(needle),
  )
}

/**
 * The household's personal link: the invitation's own address and the household's secret **in the
 * fragment**, which no server ever receives. `null` while the invitation has no address yet.
 */
export const householdLink = (inviteUrl: string | null, household: HouseholdDto): string | null =>
  inviteUrl === null ? null : `${inviteUrl}#f=${household.token}`

export interface ReminderContext {
  /** The party's title, as the host wrote it. */
  readonly title: string
  /** The deadline as a date in the host's language, or `null` for none. */
  readonly deadline: string | null
  /** The household's link, or `null` while the invitation has none. */
  readonly link: string | null
}

/** The message the host may edit, in the language of the host's console. Plain text. */
export const reminderMessage = (
  household: HouseholdDto,
  context: ReminderContext,
  text: UiText['rsvp']['households'],
): string => text.reminderMessage(household.name, context.title, context.deadline, context.link)

/** WhatsApp, with the message ready and **no recipient**: the host picks the contact in their app. */
export const whatsappUrl = (message: string): string =>
  `https://wa.me/?text=${encodeURIComponent(message)}`

/** The SMS application, message ready, no recipient. */
export const smsUrl = (message: string): string => `sms:?&body=${encodeURIComponent(message)}`

/** The mail application, subject and message ready, no recipient. */
export const mailtoUrl = (subject: string, message: string): string => {
  // Mail applications read a line break in a link as CRLF (RFC 6068): a bare line feed is lost by some.
  const body = message.replace(/\r?\n/g, '\r\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** The households a reply may be filed under: those with no reply yet (one reply per household). */
export const fileableHouseholds = (
  households: readonly HouseholdDto[],
  reply: RsvpDto,
): readonly HouseholdDto[] =>
  households.filter((household) => household.reply === null && reply.householdId === null)

/** The most characters (as a reader counts them) of a household's name a printed card takes. */
export const CARD_NAME_MAX_CHARS = 36

/**
 * A household's name as the printed card says it: one line, in NFC, **cut by graphemes** (a family
 * emoji joined by zero-width joiners, a flag, a letter and its combining accent are each one) with an
 * ellipsis, never in the middle of one.
 */
export const cardNameOf = (name: string): string => {
  const letters = graphemesOf(name.normalize('NFC').trim().replace(/\s+/g, ' '))
  return letters.length <= CARD_NAME_MAX_CHARS
    ? letters.join('')
    : letters
        .slice(0, CARD_NAME_MAX_CHARS - 1)
        .join('')
        .trimEnd() + '…'
}
