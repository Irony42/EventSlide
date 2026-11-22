import { useOutletContext } from 'react-router-dom'
import type { EventDto } from '../../../lib/api/dto'
import type { RevealControl } from '../useRevealControl'
import type { EventSectionFacts } from './eventSections'

/**
 * What the event's layout hands every page under it: the event it read once, and the ways to
 * change it. A page under the layout does not read the event again; a page that needs a fresher
 * copy asks `refresh`, which reads it without the loading screen.
 */
export interface EventPageContext {
  readonly event: EventDto
  /** Swaps in the whole event a host's action returned (a lifecycle move, a new code). */
  readonly replace: (event: EventDto) => void
  /** Reads the event again, quietly: nothing on screen changes while it is on its way. */
  readonly refresh: () => void
  /** The gap between this machine's clock and the server's, from the last read. */
  readonly offsetMs: number
  /** Built by the API client, so the link and the endpoint cannot drift apart. */
  readonly albumUrl: string
  /** One reveal state for the banner on the home page and the reveal's own page (spec 23b). */
  readonly revealControl: RevealControl
}

export const useEventPage = (): EventPageContext => useOutletContext<EventPageContext>()

/** The facts the menu is drawn from, read off the event. */
export const sectionFactsOf = (
  event: Pick<EventDto, 'status' | 'role' | 'settings' | 'reveal'>,
): EventSectionFacts => ({
  status: event.status,
  role: event.role,
  allowGuestbook: event.settings.allowGuestbook,
  allowTelegram: event.settings.allowTelegram,
  revealEnabled: event.reveal?.enabled === true,
})
