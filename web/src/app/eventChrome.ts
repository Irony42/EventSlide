import { createContext, useContext } from 'react'

/**
 * Whether a page is drawn inside the event's own layout (surface: the host and the moderator).
 *
 * The layout already shows the way back to the list of events, the event's name and its
 * ambiance, beside the menu, so the pages under it do not repeat them: the trail each of those
 * pages used to carry (`HostBreadcrumb`) steps aside there. The same pages, rendered on their own
 * (a test, or a console that takes the whole screen), keep it.
 */
export const EventChromeContext = createContext(false)

export const useInsideEventLayout = (): boolean => useContext(EventChromeContext)
