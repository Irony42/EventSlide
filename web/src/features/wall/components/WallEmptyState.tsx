import { fr } from '../../../lib/i18n/fr'
import { joinUrlFor } from '../photoAlt'
import { JoinQr } from './JoinQr'
import styles from './WallEmptyState.module.css'

export interface WallEmptyStateProps {
  readonly eventName: string
  /** `null` when the server does not present the code; the invitation still stands. */
  readonly joinCode: string | null
}

/**
 * What the room looks at for the first twenty minutes of the party.
 *
 * 1.0 showed a black screen, and every host who saw it reloaded the page and then
 * rebooted the machine. This screen has a job of its own: it is the invitation. The
 * event name and the code are at `--text-display` because they are read from the back
 * of the room, and the QR is drawn inline so it survives a venue's Wi-Fi.
 */
export function WallEmptyState({ eventName, joinCode }: WallEmptyStateProps) {
  return (
    <section className={styles['empty']} data-testid="wall-empty">
      <div className={styles['copy']}>
        <p className={styles['prompt']}>{fr.wall.joinPrompt}</p>
        <h1 className={styles['name']}>{eventName}</h1>
        <p className={styles['title']}>{fr.wall.empty}</p>
        {joinCode === null ? null : <p className={styles['hint']}>{fr.wall.emptyHint}</p>}
      </div>

      {joinCode === null ? null : (
        <div className={styles['join']}>
          <JoinQr url={joinUrlFor(joinCode)} size="lg" />
          <p className={styles['codeLabel']}>{fr.wall.codeLabel}</p>
          <p className={styles['code']}>{joinCode}</p>
        </div>
      )}
    </section>
  )
}
