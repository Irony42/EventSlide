import type { ReactNode } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'
import { EventHomePage } from '../eventLayout/EventHomePage'
import { EventLayout } from '../eventLayout/EventLayout'
import { EventMomentPage } from '../eventLayout/EventMomentPage'
import { EventSectionPage, type PanelSection } from '../eventLayout/EventSectionPage'
import { SECTION_PATH } from '../eventLayout/eventSections'

/** The address of each panel's page, read back into its section. */
const SECTION_OF: Readonly<Record<string, PanelSection>> = Object.fromEntries(
  (Object.entries(SECTION_PATH) as [string, string][])
    .filter(([section]) =>
      [
        'access',
        'missions',
        'moderators',
        'announcements',
        'challenge',
        'guestbook',
        'reveal',
        'telegram',
        'guests',
        'album',
        'bestOf',
        'share',
      ].includes(section),
    )
    .map(([section, path]) => [path, section as PanelSection]),
)

/** A page the router serves under the layout that these tests do not draw: its name, to follow a link to. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  settings: 'settings page',
  stats: 'stats page',
  print: 'print page',
  invitations: 'invitations page',
  rsvps: 'replies page',
  book: 'book page',
}

function AnyEventPage() {
  const { page = '' } = useParams()
  if (page === 'before' || page === 'during' || page === 'after')
    return <EventMomentPage moment={page} />
  const section = SECTION_OF[page]
  if (section !== undefined) return <EventSectionPage section={section} />
  return <p>{ELSEWHERE[page] ?? `unknown ${page}`}</p>
}

/**
 * The event's pages as the router nests them (`app/router.tsx`), for component tests: the layout,
 * its home page, each panel's page, the moments' lists, and a stand-in for the pages that have tests
 * of their own. `extra` adds routes beside them (the dashboard a deletion returns to, the console).
 */
export function EventRoutes({ extra }: { readonly extra?: ReactNode }) {
  return (
    <Routes>
      {extra}
      <Route path="/admin/events/:slug/moderation" element={<p>moderation console</p>} />
      <Route element={<EventLayout />}>
        <Route path="/admin/events/:slug" element={<EventHomePage />} />
        <Route path="/admin/events/:slug/:page" element={<AnyEventPage />} />
        <Route path="/admin/events/:slug/rsvps/guests" element={<p>guest list page</p>} />
      </Route>
    </Routes>
  )
}
