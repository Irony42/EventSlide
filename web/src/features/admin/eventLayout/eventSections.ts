import type { EventRole, EventStatus } from '../../../lib/api/dto'
import { allowsModeration, canManageEvent, linksToWall } from '../../../lib/eventLifecycle'

/**
 * The menu of one event (surface: the host and the moderator, on every page under an event).
 *
 * The event page used to be one column of seventeen panels, about seven screens long on a laptop
 * (Pierre, 22/11: « c'est incompréhensible vu que tout est sur une page »). It is now a home page
 * that holds what the moment asks for, and a menu with one entry per subject, each its own page.
 * The menu is cut in three **moments** a host thinks in — getting ready, the evening, what is kept
 * afterwards — and the moment the event is in is marked, never moved: a menu whose entries swap
 * places with the status is a menu nobody learns.
 *
 * Which entries exist is not decided here. The lifecycle says whether there is a screen or a queue
 * (`linksToWall`, `allowsModeration`), the role says what is the owner's (`canManageEvent`), and the
 * settings say whether there is a guestbook, a Telegram group or a disposable camera. This file only
 * puts them in order and says where each one lives.
 */

export type EventMoment = 'before' | 'during' | 'after'

export type EventSection =
  | 'access'
  | 'print'
  | 'invitations'
  | 'rsvps'
  | 'missions'
  | 'moderators'
  | 'moderation'
  | 'wall'
  | 'announcements'
  | 'challenge'
  | 'guestbook'
  | 'reveal'
  | 'telegram'
  | 'guests'
  | 'album'
  | 'bestOf'
  | 'book'
  | 'share'
  | 'stats'
  | 'settings'

export interface EventSectionFacts {
  readonly status: EventStatus
  readonly role: EventRole
  readonly allowGuestbook: boolean
  readonly allowTelegram: boolean
  /** The disposable camera's reveal is on (spec 23). */
  readonly revealEnabled: boolean
}

/**
 * Where a section lives. A **page** is under the event's layout, at `/admin/events/:slug/<path>`;
 * the **console** (moderation) is the event's too but takes the whole screen; the **wall** is the
 * room's, opened in a new tab for the projector.
 */
export type SectionKind = 'page' | 'console' | 'wall'

export const SECTION_KIND: Readonly<Record<EventSection, SectionKind>> = {
  access: 'page',
  print: 'page',
  invitations: 'page',
  rsvps: 'page',
  missions: 'page',
  moderators: 'page',
  moderation: 'console',
  wall: 'wall',
  announcements: 'page',
  challenge: 'page',
  guestbook: 'page',
  reveal: 'page',
  telegram: 'page',
  guests: 'page',
  album: 'page',
  bestOf: 'page',
  book: 'page',
  share: 'page',
  stats: 'page',
  settings: 'page',
}

/** The last segment of each section's address. Addresses are English, like the rest of the router. */
export const SECTION_PATH: Readonly<Record<Exclude<EventSection, 'wall'>, string>> = {
  access: 'access',
  print: 'print',
  invitations: 'invitations',
  rsvps: 'rsvps',
  missions: 'missions',
  moderators: 'moderators',
  moderation: 'moderation',
  announcements: 'announcements',
  challenge: 'challenge',
  guestbook: 'guestbook',
  reveal: 'reveal',
  telegram: 'telegram',
  guests: 'guests',
  album: 'album',
  bestOf: 'best-of',
  book: 'book',
  share: 'share',
  stats: 'stats',
  settings: 'settings',
}

/** The address of a moment's own page, where the phone's tab bar leads (the laptop has the menu). */
export const MOMENT_PATH: Readonly<Record<EventMoment, string>> = {
  before: 'before',
  during: 'during',
  after: 'after',
}

/** The base of every address under one event. */
export const eventBase = (slug: string): string => `/admin/events/${slug}`

/** A section's address, or the wall's for the room. */
export const sectionHref = (slug: string, section: EventSection): string =>
  section === 'wall' ? `/e/${slug}/display` : `${eventBase(slug)}/${SECTION_PATH[section]}`

/** The moment an event is in: before it opens, while it is live, once it is over. */
export const momentOf = (status: EventStatus): EventMoment =>
  status === 'draft' ? 'before' : status === 'live' ? 'during' : 'after'

/** The moment each section belongs to; the settings belong to none and sit apart. */
export const SECTION_MOMENT: Readonly<Record<Exclude<EventSection, 'settings'>, EventMoment>> = {
  access: 'before',
  print: 'before',
  invitations: 'before',
  rsvps: 'before',
  missions: 'before',
  moderators: 'before',
  moderation: 'during',
  wall: 'during',
  announcements: 'during',
  challenge: 'during',
  guestbook: 'during',
  reveal: 'during',
  telegram: 'during',
  guests: 'during',
  album: 'after',
  bestOf: 'after',
  book: 'after',
  share: 'after',
  stats: 'after',
}

/** Every section but the settings, in the menu's order, each with whether this viewer has it. */
const catalogue = (
  facts: EventSectionFacts,
): readonly (readonly [Exclude<EventSection, 'settings'>, boolean])[] => {
  const owner = canManageEvent(facts.role)
  const inUse = facts.status !== 'archived'
  return [
    // Getting ready: the way in for the guests, then what is printed and sent, then the helpers.
    ['access', true],
    ['print', inUse],
    ['invitations', owner && inUse],
    // The replies to the invitation (spec 30): the owner's, and read for as long as the event is kept.
    ['rsvps', owner],
    ['missions', owner],
    ['moderators', owner],
    // The evening: the two doors first, then what is done to the room, then the people.
    ['moderation', allowsModeration(facts.status)],
    ['wall', linksToWall(facts.status)],
    ['announcements', true],
    ['challenge', true],
    ['guestbook', facts.allowGuestbook],
    ['reveal', facts.revealEnabled],
    ['telegram', facts.allowTelegram],
    ['guests', true],
    // Afterwards: the album first, then what is made of it, then the figures.
    ['album', true],
    ['bestOf', true],
    ['book', true],
    ['share', owner],
    ['stats', true],
  ]
}

export interface MenuGroup {
  readonly moment: EventMoment
  readonly sections: readonly EventSection[]
  /** The moment the event is in: marked in the menu, never moved. */
  readonly current: boolean
}

/** The menu: three moments in their fixed order, each with the sections this viewer has. */
export const eventMenu = (facts: EventSectionFacts): readonly MenuGroup[] => {
  const now = momentOf(facts.status)
  const offered = catalogue(facts).filter(([, has]) => has)
  return (['before', 'during', 'after'] as const)
    .map((moment) => ({
      moment,
      sections: offered
        .filter(([section]) => SECTION_MOMENT[section] === moment)
        .map(([section]) => section),
      current: moment === now,
    }))
    .filter((group) => group.sections.length > 0)
}

/** The settings are the owner's, and sit apart, under the three moments. */
export const hasSettings = (role: EventRole): boolean => canManageEvent(role)

/** Whether this viewer has a section at all: a page the menu does not offer is not served. */
export const offersSection = (facts: EventSectionFacts, section: EventSection): boolean =>
  section === 'settings'
    ? hasSettings(facts.role)
    : catalogue(facts).some(([candidate, has]) => candidate === section && has)
