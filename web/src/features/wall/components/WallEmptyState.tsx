import { fr } from '../../../lib/i18n/fr'
import { JoinQr } from './JoinQr'
import styles from './WallEmptyState.module.css'

export interface WallEmptyStateProps {
  readonly eventName: string
  /**
   * The code to read out and the link to encode, or `null` when the server presents
   * neither. The invitation still stands without them.
   *
   * One value rather than two, because there is no state in which the wall should print
   * one and not the other: the characters and the QR are the same instruction given twice,
   * and a QR built from anything but the server's answer is how a guest scans into nowhere
   * (§9 trap 1).
   */
  readonly join: { readonly code: string; readonly url: string } | null
}

/**
 * What the room looks at for the first twenty minutes of the party.
 *
 * 1.0 showed a black screen, and every host who saw it reloaded the page and then
 * rebooted the machine. This screen has a job of its own: it is the invitation. The
 * event name and the code are at `--text-display` because they are read from the back
 * of the room, and the QR is drawn inline so it survives a venue's Wi-Fi.
 */
export function WallEmptyState({ eventName, join }: WallEmptyStateProps) {
  return (
    <section className={styles['empty']} data-testid="wall-empty">
      <div className={styles['copy']} data-testid="wall-empty-copy">
        <p className={styles['prompt']}>{fr.wall.joinPrompt}</p>
        <h1 className={styles['name']}>{eventName}</h1>
        <p className={styles['title']}>{fr.wall.empty}</p>
        {join === null ? null : <p className={styles['hint']}>{fr.wall.emptyHint}</p>}
      </div>

      {/*
        `wall-join` names the block so a test can assert its presence or its absence, and
        so the host's Escape can be observed to have put it away. It is no longer a mask
        target: both halves of it are the server's answer now, so a baseline can compare
        them pixel for pixel — which is what a QR code, of all the regions on this wall,
        deserves.
      */}
      {join === null ? null : (
        <div className={styles['join']} data-testid="wall-join">
          <JoinQr url={join.url} size="lg" />
          <p className={styles['codeLabel']}>{fr.wall.codeLabel}</p>
          <p className={styles['code']}>{join.code}</p>
        </div>
      )}
    </section>
  )
}
