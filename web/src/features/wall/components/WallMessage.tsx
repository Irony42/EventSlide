import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { WallGuestbookMessageDto } from '../../../lib/api/dto'
import styles from './WallMessage.module.css'

export interface WallMessageProps {
  readonly message: WallGuestbookMessageDto
}

/**
 * One guestbook message, full frame (spec 01).
 *
 * The text is the guest's own and is printed as a text node, never translated and never markup.
 * The typographic quotes come from CSS (`quotes: auto` reads the `lang` the wall already carries,
 * which is the event's wall language), not from the data. The signature is the name the guest
 * gave, or the wall's own "a guest" when there is none.
 *
 * No animation of its own: the card appears and goes with the slide that owns it, so there is no
 * `prefers-reduced-motion` answer to give.
 */
export function WallMessage({ message }: WallMessageProps) {
  const text = useTranslations()

  return (
    <figure className={styles['card']} data-wall-message={message.id}>
      <blockquote className={styles['quote']}>{message.text}</blockquote>
      <figcaption className={styles['author']}>
        {message.authorName ?? text.wall.guestbookAnonymous}
      </figcaption>
    </figure>
  )
}
