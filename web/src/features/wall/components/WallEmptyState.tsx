import { useTranslations } from '../../../lib/i18n/useTranslations'
import { joinHost } from '../joinHost'
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
  /**
   * False once the host has closed the event: nobody can send a photo any more, so the
   * wall invites nobody and says thank you instead (MUR-3). Defaults to open, which is
   * what every wall was before the server said otherwise.
   */
  readonly acceptsGuests?: boolean
  /** The host's own words (spec 03), shown under the event name. Content, never translated. */
  readonly welcomeMessage?: string | null
}

/**
 * What the room looks at for the first twenty minutes of the party.
 *
 * 1.0 showed a black screen, and every host who saw it reloaded the page and then
 * rebooted the machine. This screen has a job of its own: it is the invitation. The
 * event name and the code are at `--text-display` because they are read from the back
 * of the room, and the QR is drawn inline so it survives a venue's Wi-Fi.
 */
export function WallEmptyState({
  eventName,
  join,
  acceptsGuests = true,
  welcomeMessage = null,
}: WallEmptyStateProps) {
  const text = useTranslations()
  const invites = acceptsGuests
  const shown = invites ? join : null
  const host = shown === null ? null : joinHost(shown.url)

  return (
    <section className={styles['empty']} data-testid="wall-empty">
      <div className={styles['copy']} data-testid="wall-empty-copy">
        {invites ? <p className={styles['prompt']}>{text.wall.joinPrompt}</p> : null}
        <h1 className={styles['name']}>{eventName}</h1>
        {welcomeMessage === null ? null : (
          <p className={styles['welcome']} dir="auto" data-testid="wall-welcome">
            {welcomeMessage}
          </p>
        )}
        <p className={styles['title']}>{invites ? text.wall.empty : text.wall.emptyClosed}</p>
        {shown === null ? null : <p className={styles['hint']}>{text.wall.emptyHint}</p>}
      </div>

      {/*
        `wall-join` names the block so a test can assert its presence or its absence, and
        so a test can observe it gone once the event is closed. It is no longer a mask
        target: both halves of it are the server's answer now, so a baseline can compare
        them pixel for pixel — which is what a QR code, of all the regions on this wall,
        deserves.
      */}
      {shown === null ? null : (
        <div className={styles['join']} data-testid="wall-join">
          <JoinQr url={shown.url} size="lg" />
          <p className={styles['codeLabel']}>{text.wall.codeLabel}</p>
          <p className={styles['code']}>{shown.code}</p>
          {host === null ? null : (
            <p className={styles['address']}>{text.wall.typeCodeAt(shown.code, host)}</p>
          )}
        </div>
      )}
    </section>
  )
}
