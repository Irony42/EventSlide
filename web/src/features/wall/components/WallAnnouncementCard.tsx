import { VisuallyHidden } from '../../../design-system/components/VisuallyHidden'
import { cx } from '../../../design-system/classNames'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { WallAnnouncementDto } from '../../../lib/api/dto'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import styles from './WallAnnouncementCard.module.css'

export interface WallAnnouncementCardProps {
  readonly announcement: WallAnnouncementDto
}

/**
 * A fullscreen announcement, full frame, over everything (spec 21, §6): the host's sentence, very
 * large, for as long as the server's clock says it stays.
 *
 * A **layer**: it is mounted over the layouts and the corner chrome, so no layout is remounted or
 * measured again by its coming or going, and the invitation's QR is exactly where it was after it.
 * It covers the QR while it is up, which is the point of a card the whole room has to read.
 *
 * The text is the host's own, printed as a text node, never translated and never markup. It is
 * read to a screen reader once, when the card appears (`role="status"`), and the visible copy is
 * hidden from the accessibility tree so it is not read twice.
 *
 * ## Motion
 *
 * A 250 ms fade-in (`opacity` only: a card that fills the frame has no direction to lift in),
 * justified by rarity as the challenge banner's is. `prefers-reduced-motion` is answered here: the
 * class is not applied and the card is simply there. The last rung of the frame budget drops the
 * animation in CSS.
 */
export function WallAnnouncementCard({ announcement }: WallAnnouncementCardProps) {
  const text = useTranslations()
  const reducedMotion = usePrefersReducedMotion()

  return (
    <section
      className={cx(styles['card'], !reducedMotion && styles['enters'])}
      data-wall-announcement-card={announcement.id}
    >
      <div role="status">
        <VisuallyHidden>{text.wall.announcementSay(announcement.text)}</VisuallyHidden>
      </div>
      <p className={styles['text']} aria-hidden="true">
        {announcement.text}
      </p>
    </section>
  )
}
