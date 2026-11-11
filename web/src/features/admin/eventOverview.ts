import type { EventRole, EventStatus } from '../../lib/api/dto'
import { allowsModeration, canManageEvent, linksToWall } from '../../lib/eventLifecycle'

/**
 * What the event page puts where (surface: the host and the moderator, on the event page).
 *
 * The page is two layers. The **"Maintenant" card** holds the one or two things the moment turns
 * on, and it changes with the status: before the evening, getting ready and opening the doors;
 * during it, the queue and the screen; after it, the album. The **overview** under it lists
 * everything else the event has, one tile each, so nothing is lost by not being in the first
 * card. A destination is in one layer or the other, never both: two links with one name to one
 * place is what the page used to have and what this replaces.
 *
 * Which destinations exist at all is not decided here. The lifecycle says whether there is a
 * screen or a queue (`linksToWall`, `allowsModeration`), the role says what is the owner's
 * (`canManageEvent`), and the settings say whether there is a guestbook.
 */

/** A destination from the event page: a route, a download, or a panel further down the page. */
export type EventDestination =
  | 'moderate'
  | 'wall'
  | 'download'
  | 'share'
  | 'guestbook'
  | 'challenge'
  | 'missions'
  | 'guests'
  | 'moderators'
  | 'bestOf'
  | 'book'
  | 'stats'
  | 'settings'

export interface EventPageFacts {
  readonly status: EventStatus
  readonly role: EventRole
  readonly allowGuestbook: boolean
}

/**
 * Every destination this viewer has on this event, in the order the overview lists them:
 * the evening's tools first, then the people, then what is kept afterwards, then the pages
 * about the event itself.
 */
const available = ({ status, role, allowGuestbook }: EventPageFacts): EventDestination[] => {
  const owner = canManageEvent(role)
  const all: readonly (readonly [EventDestination, boolean])[] = [
    ['moderate', allowsModeration(status)],
    ['wall', linksToWall(status)],
    ['guestbook', allowGuestbook],
    ['challenge', true],
    ['missions', owner],
    ['guests', true],
    ['moderators', owner],
    ['bestOf', true],
    ['book', true],
    ['share', owner],
    ['stats', true],
    ['settings', owner],
    ['download', true],
  ]
  return all.filter(([, offered]) => offered).map(([destination]) => destination)
}

/**
 * The large tiles of the "Maintenant" card, by status. Before the evening the card is a list of
 * things to get ready rather than tiles, so it has none.
 */
export const nowTiles = (facts: EventPageFacts): readonly EventDestination[] => {
  const wanted: Readonly<Record<EventStatus, readonly EventDestination[]>> = {
    draft: [],
    live: ['moderate', 'wall'],
    closed: ['download', 'share'],
    archived: ['download'],
  }
  const offered = available(facts)
  return wanted[facts.status].filter((destination) => offered.includes(destination))
}

/** The overview: every destination this viewer has that the "Maintenant" card does not hold. */
export const overviewTiles = (facts: EventPageFacts): readonly EventDestination[] => {
  const inNow = nowTiles(facts)
  return available(facts).filter((destination) => !inNow.includes(destination))
}
