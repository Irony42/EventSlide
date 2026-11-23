import type { RsvpDto, RsvpSettingsDto, RsvpStatsDto } from '../api/dto'
import type { UiText } from '../i18n/translations'
import { plural } from './rsvpTexts'

/**
 * The host's replies page as data (spec 30, no React): which tabs it offers, what each one holds,
 * how the figures are said and what the bar draws. **The figures themselves are the server's**
 * (`RsvpStatsDto`, one function for the table, the tiles, the badge and the export); this only
 * words them, so the page and the spreadsheet cannot count differently.
 */

export type RsvpTab = 'all' | 'yes' | 'maybe' | 'no'

/** The tabs the host's form leaves open: a "peut-être" tab exists only while "peut-être" is offered. */
export const tabsOf = (maybeOffered: boolean): readonly RsvpTab[] =>
  maybeOffered ? ['all', 'yes', 'maybe', 'no'] : ['all', 'yes', 'no']

/** How many replies each tab holds. A reply on the waiting list belongs to "all" alone. */
export const countsOf = (rsvps: readonly RsvpDto[]): Readonly<Record<RsvpTab, number>> => ({
  all: rsvps.length,
  yes: rsvps.filter((reply) => reply.answer === 'yes').length,
  maybe: rsvps.filter((reply) => reply.answer === 'maybe').length,
  no: rsvps.filter((reply) => reply.answer === 'no').length,
})

/** The replies of a tab whose name (or a companion's) holds what was typed, in the order the server gave. */
export const visibleRsvps = (
  rsvps: readonly RsvpDto[],
  tab: RsvpTab,
  query: string,
): readonly RsvpDto[] => {
  const needle = query.trim().toLowerCase()
  return rsvps.filter(
    (reply) =>
      (tab === 'all' || reply.answer === tab) &&
      [reply.name, ...reply.details.companions].join(' ').toLowerCase().includes(needle),
  )
}

/** The people a reply brings: nobody for a "no". */
export const peopleOf = (reply: RsvpDto): number =>
  reply.answer === 'no' ? 0 : reply.adults + reply.kids

/** The newest replies first, at most `count`. */
export const latestOf = (rsvps: readonly RsvpDto[], count: number): readonly RsvpDto[] =>
  [...rsvps].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, count)

export interface BarSegment {
  readonly kind: 'yes' | 'maybe' | 'no'
  readonly value: number
  /** Its share of the bar, 0 to 100. */
  readonly percent: number
}

/**
 * What the bar draws: the people who come, the people who might, the replies that decline. It is
 * the one picture of "how many will we be"; with no reply it is empty, never a full grey bar.
 */
export const barOf = (stats: RsvpStatsDto, maybeOffered: boolean): readonly BarSegment[] => {
  const raw: readonly Omit<BarSegment, 'percent'>[] = [
    { kind: 'yes', value: stats.yes.people },
    ...(maybeOffered ? [{ kind: 'maybe' as const, value: stats.maybe.people }] : []),
    { kind: 'no', value: stats.no.responses },
  ]
  const total = raw.reduce((sum, segment) => sum + segment.value, 0)
  return raw.map((segment) => ({
    ...segment,
    percent: total === 0 ? 0 : (segment.value / total) * 100,
  }))
}

type ListText = UiText['rsvp']['list']

/** "3 réponses", "1 réponse". */
export const repliesLabel = (count: number, text: ListText): string =>
  `${count} ${plural(count, text.reply)}`

/** The line under the page's title: how many replies, the deadline, whether they are closed. */
export const subline = (
  count: number,
  deadline: string | null,
  closed: boolean,
  text: ListText,
): string =>
  [
    repliesLabel(count, text),
    ...(deadline === null ? [] : [text.deadlineSub(deadline)]),
    ...(closed ? [text.closedSub] : []),
  ].join(' · ')

/** What the "yes" tile says under its figure: the replies, and the adults and the children if told apart. */
export const yesDetail = (stats: RsvpStatsDto, kidsSeparate: boolean, text: ListText): string => {
  const replies = repliesLabel(stats.yes.responses, text)
  return kidsSeparate
    ? `${replies} · ${text.adultsKids(
        `${stats.yes.adults} ${plural(stats.yes.adults, text.adult)}`,
        `${stats.yes.kids} ${plural(stats.yes.kids, text.child)}`,
      )}`
    : replies
}

/** The big line over the bar: how many people, and how many with the "peut-être" if they are asked. */
export const barLine = (stats: RsvpStatsDto, maybeOffered: boolean, text: ListText): string =>
  `${stats.yes.people} ${plural(stats.yes.people, text.expected)}${
    maybeOffered ? text.barUpTo(stats.yes.people + stats.maybe.people) : ''
  }`

/** The people column of a row: the adults, and the children if there are some; empty for a "no". */
export const peopleCell = (reply: RsvpDto, text: ListText): string =>
  reply.answer === 'no'
    ? text.none
    : reply.kids > 0
      ? text.peopleKids(reply.adults, reply.kids)
      : String(reply.adults)

/** The detail's people line: "2 adultes, 1 enfant". */
export const peopleDetail = (reply: RsvpDto, text: ListText): string =>
  reply.kids > 0
    ? text.adultsKids(
        `${reply.adults} ${plural(reply.adults, text.adult)}`,
        `${reply.kids} ${plural(reply.kids, text.child)}`,
      )
    : `${reply.adults} ${plural(reply.adults, text.adult)}`

/** One line of "Dernières réponses": who, and what they answered, with how many if more than one. */
export const latestLine = (reply: RsvpDto, text: ListText): string => {
  const people = peopleOf(reply)
  return reply.answer === 'no'
    ? text.latestNo(reply.name)
    : reply.answer === 'maybe'
      ? text.latestMaybe(reply.name)
      : people > 1
        ? text.latestYesMany(reply.name, people)
        : text.latestYes(reply.name)
}

/** The sentence that says what the badge on the menu counts, for the entry's accessible name. */
export const unseenLabel = (count: number, text: ListText): string =>
  `${count} ${plural(count, text.menuNew)}`

/** Where an answer is in the badge's tone: the page and the table draw the same word in the same tone. */
export const answerTone = (
  answer: RsvpDto['answer'],
): 'success' | 'warning' | 'danger' | 'neutral' =>
  answer === 'yes'
    ? 'success'
    : answer === 'maybe'
      ? 'warning'
      : answer === 'no'
        ? 'danger'
        : 'neutral'

/**
 * What the window's button offers, from what the server says: close while open (or full), reopen
 * when the host closed it and the day it closes has not come, nothing when the date closed it (the
 * date is what moves). One place for the panel and the page, so they cannot disagree.
 */
export type WindowAction = 'close' | 'reopen' | 'closedByDate' | 'moveDate'

export const windowAction = (settings: RsvpSettingsDto, now: number): WindowAction => {
  if (settings.state === 'closed' && settings.closedAt === null) return 'closedByDate'
  if (settings.closedAt === null) return 'close'
  const passed = settings.closesAt !== null && Date.parse(settings.closesAt) <= now
  return passed ? 'moveDate' : 'reopen'
}
