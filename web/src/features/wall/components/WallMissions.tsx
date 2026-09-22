import { Card } from '../../../design-system/components/Card'
import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { WallMissionDto } from '../../../lib/api/dto'
import styles from './WallMissions.module.css'

export interface WallMissionsProps {
  readonly missions: readonly WallMissionDto[]
}

/**
 * The room's view of the host's prompts (roadmap §2.1).
 *
 * ## What it shows, and why it is not a celebration that fires
 *
 * The roadmap asks the wall to celebrate completions. This celebrates them by **standing
 * still**: the list is on screen, a prompt the room has answered is drawn with a tick and
 * the accent, and the celebration is watching it fill up over the evening.
 *
 * The alternative — a burst, a banner, a row animating as it is ticked — was considered
 * and declined, on three grounds this repository has already written down. §11.2's
 * finding was that motion carries meaning only where it is *rare*, and a per-guest prompt
 * at a two-hundred-guest wedding is answered a hundred times. §11.3 gives this surface a
 * measured frame budget on a venue mini-PC that is also decoding a photograph and running
 * Ken Burns, and a list that animates a row is the first thing to cost it. And a
 * three-second burst is legible only to whoever happened to be looking three seconds ago,
 * where a standing list is legible at any moment from ten metres — which is the actual
 * job, because nobody is watching this screen continuously.
 *
 * Nothing here animates, so there is no `prefers-reduced-motion` answer to give.
 *
 * ## Two shapes, because the prompts are two kinds
 *
 * A once-for-the-evening prompt is answered or it is not, so it gets a tick and the word.
 * A per-guest prompt is answered *by* people, so it gets the number — a tick would be
 * wrong for something two hundred people can each do, and this is the only place `scope`
 * changes a pixel.
 *
 * Colour is never the sole signal: an answered row carries the check glyph and a word as
 * well as the accent, for a red-green colourblind guest across a room under stage
 * lighting.
 *
 * ## Nothing at all when there are no prompts
 *
 * Most events set none. Rendering `null` for them is what keeps every wall that does not
 * use this feature exactly the wall it was, committed visual baselines included.
 */
export function WallMissions({ missions }: WallMissionsProps) {
  const text = useTranslations()

  if (missions.length === 0) return null

  return (
    <Card className={styles['panel']}>
      <h2 className={styles['title']}>{text.wall.missionsTitle}</h2>
      <ul className={styles['list']}>
        {missions.map((mission) => (
          <li
            key={mission.id}
            className={styles['row']}
            // Read by the end-to-end journey, which measures state rather than pixels.
            data-mission-answered={mission.achieved ? 'true' : 'false'}
          >
            <StatusIcon
              tone={mission.achieved ? 'success' : 'neutral'}
              className={styles['icon'] ?? ''}
            />
            <span className={styles['prompt']}>{mission.prompt}</span>
            {mission.achieved ? (
              <span className={styles['answer']}>
                {mission.scope === 'guest'
                  ? text.wall.missionGuests(mission.completedByGuests)
                  : text.wall.missionDone}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
