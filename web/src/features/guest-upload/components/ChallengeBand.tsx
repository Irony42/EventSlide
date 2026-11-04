import { useEffect, useState } from 'react'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { formatCountdown, remainingMs } from '../../../lib/serverClock'
import type { GuestChallengeDto } from '../../../lib/api/dto'
import styles from './ChallengeBand.module.css'

/** How long "Défi terminé" stays up on the phone once the countdown is over. */
export const ENDED_SHOWN_MS = 10_000

export interface ChallengeBandProps {
  readonly challenge: GuestChallengeDto
  /** This phone's clock to the server's, from the last read of the checklist. */
  readonly offsetMs: number
}

/**
 * The host's timed challenge, above the checklist (spec 10): "Défi en cours · 1:42" and the
 * challenge's own text. Since spec 18 it needs no mission and has no button: the box above
 * "Envoyer" (`ParticipateBox`) is how a photograph answers it.
 *
 * **It asks nothing of a guest who does not want to play.** No sound, no vibration, no
 * notification, no dialog and nothing animates: it is a band that is there, and the screen
 * below is the screen it was. The photograph a guest sends is moderated like any other, and
 * a guest may send at any time.
 *
 * The countdown is against the server's clock (\`offsetMs\`), so this phone shows the time the
 * projector shows whatever either clock says. At zero the band says "Défi terminé" for ten
 * seconds and goes; the phone's next read confirms it. One interval, only while it counts,
 * cleared on unmount.
 */
export function ChallengeBand({ challenge, offsetMs }: ChallengeBandProps) {
  const t = useTranslations()
  const [now, setNow] = useState(() => Date.now())
  const [gone, setGone] = useState(false)

  const left = remainingMs(Date.parse(challenge.endsAt), now, offsetMs)
  const over = challenge.state === 'ended' || left === 0

  useEffect(() => {
    if (over) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [over])

  useEffect(() => {
    if (!over) return undefined
    const timer = setTimeout(() => setGone(true), ENDED_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [over])

  if (gone) return null

  return (
    <section className={styles['band']} data-challenge={over ? 'ended' : 'running'}>
      <p className={styles['head']}>
        {over ? (
          t.challenge.ended
        ) : (
          <>
            {t.challenge.title} · <span className={styles['time']}>{formatCountdown(left)}</span>
          </>
        )}
      </p>
      {over ? null : (
        <>
          <p className={styles['prompt']}>{challenge.prompt}</p>
        </>
      )}
    </section>
  )
}
