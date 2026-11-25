import type { EventRole, EventStatus } from '../../lib/api/dto'
import { isEventLogoUrl } from '../../lib/brand'
import { allowsModeration, canManageEvent, linksToWall } from '../../lib/eventLifecycle'

/**
 * What the event page puts where (surface: the host and the moderator, on the event page).
 *
 * The **"Maintenant" card** of the event's home page holds the one or two things the moment turns
 * on, and it changes with the status: before the evening, getting ready and opening the doors;
 * during it, the queue and the screen; after it, the album. Everything else the event has is in
 * the menu beside the page (`eventLayout/eventSections.ts`), one page each. Before the evening the
 * card is a list of steps instead of tiles, and a step may lead where the menu also leads (the
 * settings, the screen, the moderators): it says why to go there ("Tester l'écran sur le
 * vidéoprojecteur"), so its name is its own.
 *
 * Which destinations exist at all is not decided here. The lifecycle says whether there is a
 * screen or a queue (`linksToWall`, `allowsModeration`), the role says what is the owner's
 * (`canManageEvent`), and the settings say whether there is a guestbook.
 */

/** A destination from the "Maintenant" card: a route, a download, or another page of the event. */
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
 * Every destination this viewer has on this event: what the lifecycle, the role and the settings
 * allow, of which the card takes the moment's own.
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

/**
 * Whether the « Maintenant » card of a draft asks for the logo (surface: the owner, before the
 * evening). Only the owner, who is the one who can send it; only while the event has none, so the
 * step leaves the list the moment it is done; and the logo is what the server holds, validated the
 * way every path this client is handed is.
 */
export const asksForLogo = ({
  role,
  logoUrl,
}: {
  readonly role: EventRole
  readonly logoUrl: string | null | undefined
}): boolean => canManageEvent(role) && !isEventLogoUrl(logoUrl)
