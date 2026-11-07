import { useState } from 'react'
import { ChallengeControls } from '../../../../app/ChallengeControls'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/**
 * "Défi photo" (order 50): launch and stop the timed photo challenge from the wall (spec 10, PR 5).
 *
 * **The owner's, because the panel is**: it is mounted only for an owner's session, and a
 * moderator launches from the console. It is the console's controls (`ChallengeControls`), not a
 * second copy: mission, duration, Lancer / Arrêter, the countdown on the server clock. A challenge
 * is not a setting, so nothing here goes through `save`; it has its own routes and signal, and the
 * wall itself shows the banner a moment later.
 *
 * The panel has no toaster above it, so a refusal (a challenge already running, an event that is
 * not open) is said in a line under the controls.
 */
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function ChallengeSection({ slug }: WallPanelContext) {
  const [failure, setFailure] = useState<string | null>(null)

  return (
    <>
      {/* The server refuses a launch on an event that is not open, with its own words. */}
      <ChallengeControls slug={slug} visual live onFailure={setFailure} />
      {failure === null ? null : <p role="alert">{failure}</p>}
    </>
  )
}

export const section: WallPanelSection = {
  id: 'challenge',
  order: 50,
  title: (text) => text.challenge.title,
  icon: 'flag',
  Component: ChallengeSection,
}
