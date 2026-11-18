import { formatDateTime, formatTime } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { countdownParts } from '../../../lib/revealCountdown'
import { useServerCountdown } from '../../../lib/useServerCountdown'
import styles from './WallRevealWait.module.css'

export interface WallRevealWaitProps {
  /** The reveal hour as an instant of the server's clock, or `null` while the host reveals by hand. */
  readonly atMs: number | null
  /** Published photographs the gate holds back: an aggregate with no author. `null` or 0: no line. */
  readonly readyCount: number | null
  /** The gap between this machine's clock and the server's (`useWallPlaylist`). */
  readonly offsetMs: number
}

interface HourProps {
  readonly atMs: number
  readonly offsetMs: number
}

/**
 * The hour and the time left, for a reveal that has an hour.
 *
 * Counted against the server's clock like every countdown on the wall, never this projector's: one
 * in the room that is five minutes off still agrees with the others. No live region: the room does
 * not need a countdown read out every minute, and the wall has no screen reader in front of it.
 */
function RevealHour({ atMs, offsetMs }: HourProps) {
  const text = useTranslations()
  const { locale } = useLocale()
  const { leftMs } = useServerCountdown(
    { id: `reveal-${atMs}`, endsAt: new Date(atMs).toISOString(), state: 'running' },
    offsetMs,
  )
  const parts = countdownParts(leftMs)
  // The day only when the hour is not today by the **server's** clock: "à 23:00" is enough for tonight.
  // That clock is the hour less what is left (the hour itself once it has gone by).
  const sameDay = new Date(atMs).toDateString() === new Date(atMs - leftMs).toDateString()
  const at = sameDay
    ? text.reveal.wallAt(formatTime(atMs, locale) ?? '')
    : text.reveal.wallOn(formatDateTime(new Date(atMs).toISOString(), locale) ?? '')

  return (
    <>
      <p className={styles['at']} data-testid="wall-reveal-at">
        {at}
      </p>
      <p className={styles['left']} data-testid="wall-reveal-left">
        {parts === 'soon' ? text.reveal.soon : text.reveal.countdown(parts.hours, parts.minutes)}
      </p>
    </>
  )
}

/**
 * What the empty wall adds while an evening waits for its reveal (spec 23): when, and how many
 * photographs are being "developed". The count is the number the server says is ready, nothing
 * about who sent them, and a wall with nothing ready says nothing about it.
 */
export function WallRevealWait({ atMs, readyCount, offsetMs }: WallRevealWaitProps) {
  const text = useTranslations()
  return (
    <div className={styles['wait']} data-testid="wall-reveal">
      {atMs === null ? (
        <p className={styles['at']} data-testid="wall-reveal-at">
          {text.reveal.wallSoon}
        </p>
      ) : (
        <RevealHour atMs={atMs} offsetMs={offsetMs} />
      )}
      {readyCount !== null && readyCount > 0 ? (
        <p className={styles['developing']} data-testid="wall-reveal-count">
          {text.reveal.developing(readyCount)}
        </p>
      ) : null}
    </div>
  )
}
