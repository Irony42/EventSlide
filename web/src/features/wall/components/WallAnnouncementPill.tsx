import { useEffect, useState } from 'react'
import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { WallAnnouncementDto } from '../../../lib/api/dto'
import { wallAnnouncementPhaseAt } from '../announcementPhase'
import { msUntilPillLabelChanges, pillTimeLeft } from '../pillTimeLeft'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import styles from './WallAnnouncementPill.module.css'

export interface WallAnnouncementPillProps {
  /** A discreet announcement that is showing (`announcementLayersAt` decides that, not this). */
  readonly announcement: WallAnnouncementDto
  /** The server's time now: this machine's clock plus the offset of the wall's last read. */
  readonly now: () => number
}

/**
 * A discreet announcement (spec 21, §6): the host's sentence on the photographs for as long as
 * it stays true, with the time it has left written on it ("encore 12 min").
 *
 * It is what makes the pill read as temporary and not as an ornament (ADR 0010, principle 9): a
 * cause (the host wrote it), an end (said on the pill and imposed by the domain), and a footprint
 * of a few lines in the top centre. It sits in `WallTopCentre`, under whatever holds that place,
 * and is covered, not removed, by a fullscreen card or a guestbook card: it stays mounted under
 * them, so it comes back with the time that is really left and is not announced a second time.
 *
 * The text is the host's own, a text node, never translated and never markup. It is read to a
 * screen reader once, when the pill appears (`role="status"`); the visible copy is hidden from the
 * accessibility tree, and the time left is **not** a live region: it would change every minute.
 *
 * ## Time
 *
 * The label is derived from the server's clock on each render and refreshed by **one** timeout
 * armed for the next minute boundary, cleared on unmount. It changes at most once a minute, with
 * no transition. Editing the text of the announcement while it shows changes it in place: the
 * element is the same, so nothing replays.
 *
 * ## Motion
 *
 * A 250 ms fade-in (`opacity` only), justified by rarity as the other announcements' are; nothing
 * else moves, there is no exit animation. `prefers-reduced-motion` is answered here (the class is
 * not applied) and the last rung of the frame budget drops the animation in CSS.
 */
export function WallAnnouncementPill({ announcement, now }: WallAnnouncementPillProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()
  const [tick, setTick] = useState(0)

  const state = wallAnnouncementPhaseAt(announcement, now())
  const remainingMs = state.phase === 'showing' ? state.remainingMs : 0
  const label = pillTimeLeft(remainingMs)
  const changeIn = msUntilPillLabelChanges(remainingMs)

  useEffect(() => {
    if (changeIn === null) return undefined
    // `tick` re-arms a timeout that fired a hair before the boundary: the label is then unchanged.
    const timer = window.setTimeout(() => setTick((count) => count + 1), changeIn)
    return () => window.clearTimeout(timer)
  }, [changeIn, tick])

  return (
    <section
      className={cx(styles['pill'], !reducedMotion && styles['enters'])}
      data-wall-announcement-pill={announcement.id}
    >
      <div role="status">
        <VisuallyHidden>{text.wall.announcementSay(announcement.text)}</VisuallyHidden>
      </div>
      <div className={styles['body']} aria-hidden="true">
        <p className={styles['text']}>{announcement.text}</p>
        <p className={styles['time']}>
          {label.kind === 'minutes'
            ? text.wall.announcementMinutesLeft(label.minutes)
            : text.wall.announcementLastMinute}
        </p>
      </div>
    </section>
  )
}
