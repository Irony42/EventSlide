import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { formatCountdown } from '../../../lib/serverClock'
import { useServerCountdown } from '../../../lib/useServerCountdown'
import type { WallAnnouncementDto } from '../../../lib/api/dto'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import styles from './WallAnnouncementBand.module.css'

/** The last seconds are said by the word and the weight **and** the colour, never by colour alone. */
const URGENT_SECONDS = 10

export interface WallAnnouncementBandProps {
  readonly announcement: WallAnnouncementDto
  /** This machine's clock to the server's, from the wall's last read (`useWallPlaylist`). */
  readonly offsetMs: number
}

/**
 * The countdown before a fullscreen announcement (spec 21, §6): "Gâteau" over "dans 4:32", in the
 * top centre, in the place and at the width of the challenge banner (`WallChallenge`, which it
 * gives way to).
 *
 * It is `aria-hidden`: the card says the announcement once when it appears, and a countdown read
 * every second would be noise. The last ten seconds change the **word** ("dans un instant") and
 * the weight as well as the colour.
 *
 * ## Motion
 *
 * Announcements are rare (a few an evening), so the banner may have an entrance: 250 ms,
 * `opacity` and `transform` only, then still. `prefers-reduced-motion` is answered here: the class
 * is not applied and the banner is simply there. The digits change once a second; nothing pulses.
 *
 * Mounted only while the announcement counts: the one-second interval of `useServerCountdown`
 * exists only then and is cleared on unmount.
 */
export function WallAnnouncementBand({ announcement, offsetMs }: WallAnnouncementBandProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()
  // The countdown is to `at`, the moment the card appears, against the server's clock.
  const { leftMs } = useServerCountdown(
    { id: announcement.id, endsAt: announcement.at, state: 'running' },
    offsetMs,
  )
  const urgent = leftMs <= URGENT_SECONDS * 1000
  const time = formatCountdown(leftMs)

  return (
    <section
      className={cx(
        styles['banner'],
        !reducedMotion && styles['enters'],
        urgent && styles['urgent'],
      )}
      data-wall-announcement-band={announcement.id}
      aria-hidden="true"
    >
      <p className={styles['head']}>{announcement.text}</p>
      <p className={styles['time']}>
        {urgent ? text.wall.announcementImminent(time) : text.wall.announcementIn(time)}
      </p>
    </section>
  )
}
