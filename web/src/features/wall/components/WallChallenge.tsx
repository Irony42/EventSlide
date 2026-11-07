import { useEffect } from 'react'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { formatCountdown } from '../../../lib/serverClock'
import { useGoneAfter, useServerCountdown } from '../../../app/useServerCountdown'
import type { WallChallengeDto } from '../../../lib/api/dto'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import styles from './WallChallenge.module.css'

/** How long "Défi terminé" stays up once the countdown is over. The server serves it for twenty. */
export const ENDED_SHOWN_MS = 10_000

/** The last seconds are said by colour **and** by the word, never by colour alone. */
const URGENT_SECONDS = 10

export interface WallChallengeProps {
  readonly challenge: WallChallengeDto
  /** This machine's clock to the server's, from the wall's last read (`useWallPlaylist`). */
  readonly offsetMs: number
  /** Called once when the countdown reaches zero while the server still says `running`. */
  readonly onElapsed: () => void
  /** Called once when "Défi terminé" has been up for its ten seconds and the banner goes away. */
  readonly onLeave: () => void
}

/**
 * The timed photo challenge, as the room reads it (spec 10): "Défi photo · 1:42" over the
 * mission's sentence, in the top centre, for as long as the challenge runs.
 *
 * ## Motion
 *
 * A challenge is launched three or four times an evening, which is **rare** in the roadmap's
 * sense (11.2), so unlike a per-guest completion it may have an entrance: a 250 ms fade and
 * lift, `opacity` and `transform` only. Everything after it is still. The digits change once a
 * second and nothing else does: no pulse, no moving bar, no flash in the last seconds. Urgency
 * is the `--warning` token **and** a heavier weight, never the colour alone, and the digits are
 * what carry the meaning. The end is static
 * text, held for ten seconds: no burst, no confetti (the argument of `WallMissions`).
 *
 * `prefers-reduced-motion` is answered here in JavaScript: the entrance is not rendered at all,
 * and the banner appears and goes net. The countdown is information, not motion, and is
 * unchanged.
 *
 * ## What it does not decide
 *
 * Whether a challenge is running, when it ends and how many photographs answered it are the
 * server's. This counts the seconds against the server's clock (`offsetMs`), so two projectors
 * with different clocks agree, and asks the wall to read again once, at zero, because the end
 * of a challenge announces nothing.
 *
 * Mounted only while a challenge is on screen: the one-second interval exists only then, and
 * is cleared on unmount, so an eight-hour evening accumulates nothing.
 */
export function WallChallenge({ challenge, offsetMs, onElapsed, onLeave }: WallChallengeProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()
  const { leftMs: left, over } = useServerCountdown(challenge, offsetMs)
  const stillRunning = challenge.state === 'running'
  const gone = useGoneAfter(over, ENDED_SHOWN_MS, onLeave)

  useEffect(() => {
    if (over && stillRunning) onElapsed()
  }, [over, stillRunning, onElapsed])

  if (gone) return null

  const urgent = !over && left <= URGENT_SECONDS * 1000

  return (
    <section
      className={cx(
        styles['banner'],
        !reducedMotion && styles['enters'],
        urgent && styles['urgent'],
      )}
      data-wall-challenge={over ? 'ended' : 'running'}
    >
      {/* Said once at each end, never every second: the digits below are `aria-hidden`. */}
      <div role="status">
        <VisuallyHidden>
          {over ? text.challenge.announceEnd : text.challenge.announceStart(challenge.prompt)}
        </VisuallyHidden>
      </div>
      <p className={styles['head']} aria-hidden="true">
        {over ? (
          <>
            {text.challenge.ended}
            {challenge.answers === null ? null : (
              <> · {text.challenge.answers(challenge.answers)}</>
            )}
          </>
        ) : (
          <>
            {text.challenge.title} · <span className={styles['time']}>{formatCountdown(left)}</span>
          </>
        )}
      </p>
      {over ? null : (
        <p className={styles['prompt']} aria-hidden="true">
          {challenge.prompt}
        </p>
      )}
    </section>
  )
}
