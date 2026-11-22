import { createContext, useCallback, useContext } from 'react'
import type { EventDto } from '../lib/api/dto'

/**
 * What the event's own layout tells the pages under it (surface: the host and the moderator).
 *
 * The layout already shows the way back to the list of events, the event's name and its ambiance,
 * beside the menu, so the pages under it do not repeat them: the trail each of those pages used to
 * carry (`HostBreadcrumb`) steps aside there. The same pages, rendered on their own (a test, or a
 * console that takes the whole screen), keep it.
 *
 * A page that reads and saves the event itself (the settings, the custom ambiance) hands what the
 * server answered to the layout too (`adopt`), so the menu, the name and the ambiance around the
 * page change with the save rather than at the next move.
 */
export interface EventChrome {
  readonly inside: boolean
  /** Takes the event a page under the layout has just saved. */
  readonly adopt: (event: EventDto) => void
}

const OUTSIDE: EventChrome = { inside: false, adopt: () => undefined }

export const EventChromeContext = createContext<EventChrome>(OUTSIDE)

export const useInsideEventLayout = (): boolean => useContext(EventChromeContext).inside

/**
 * A page's own `replace`, extended to the layout around it: the page keeps its copy, and the
 * layout's menu and ambiance follow. Outside the layout it is the page's `replace` alone.
 */
export const useSharedReplace = (
  replace: (event: EventDto) => void,
): ((event: EventDto) => void) => {
  const { adopt } = useContext(EventChromeContext)
  return useCallback(
    (event: EventDto) => {
      replace(event)
      adopt(event)
    },
    [replace, adopt],
  )
}
