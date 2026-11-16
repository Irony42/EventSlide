import { useState } from 'react'
import { AnnouncementControls } from '../../../../app/AnnouncementControls'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/**
 * "Annonces" (order 55): schedule a sentence for the room, or launch it now, from the wall (spec 21).
 *
 * **The owner's, because the panel is**: it is mounted only for an owner's session, and a
 * moderator uses the event page. It is the same controls (`AnnouncementControls`), not a second
 * copy, and an announcement is not a setting, so nothing here goes through `save`: it has its own
 * routes and signal, and the wall shows the band, the card or the pill when the server's clock says so.
 *
 * The drawer has no toaster above it, so a refusal (an overlap, a locked one, an event that is not
 * open) is said in a line under the controls. It does not know the event's scheduled opening, so a
 * time typed here is read from now on: the event page is where a night before the doors is prepared.
 */
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function AnnouncementsSection({ slug }: WallPanelContext) {
  const [failure, setFailure] = useState<string | null>(null)

  return (
    <>
      {/* The drawer is on an open screen, so `live` is true; the server refuses otherwise, with its own words. */}
      <AnnouncementControls slug={slug} live onFailure={setFailure} />
      {failure === null ? null : <p role="alert">{failure}</p>}
    </>
  )
}

export const section: WallPanelSection = {
  id: 'announcements',
  order: 55,
  title: (text) => text.announcement.title,
  icon: 'monitor',
  Component: AnnouncementsSection,
}
