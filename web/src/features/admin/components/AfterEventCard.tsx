import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './AfterEventCard.module.css'

export interface AfterEventCardProps {
  /** Built by the API client, so the link and the endpoint cannot drift apart. */
  readonly albumUrl: string
  /**
   * Takes the owner to the panel that makes the album's link. Absent for a moderator: the
   * link is the owner's to make, and a button whose every press is refused is clutter.
   */
  readonly onShare: (() => void) | undefined
}

/**
 * The first card of the host's page once the evening is over, closed or archived (revue UX
 * 30/10, HOT-5 and APR-6).
 *
 * Surface: the host the next morning, whose one question is how to send the photos. The page
 * used to be the one of the party night, with the album's link under the guest list and the
 * missions; this puts the two ways out first. The download is a plain link, like the tile it
 * repeats: the ZIP is streamed and the browser's own download manager is the right tool.
 */
export function AfterEventCard({ albumUrl, onShare }: AfterEventCardProps) {
  const t = useTranslations()

  return (
    <Card
      as="h2"
      title={t.admin.afterTitle}
      // "Send the album to your guests" is a sentence to the person who can: a moderator has the
      // download and nothing to send with, so the card does not tell them to.
      {...(onShare === undefined ? {} : { subtitle: t.admin.afterHint })}
    >
      <div className={styles['actions']}>
        {onShare === undefined ? null : (
          <Button variant="primary" onClick={onShare}>
            {t.admin.afterShare}
          </Button>
        )}
        <a className={styles['download']} href={albumUrl} download>
          {t.admin.download}
        </a>
      </div>
    </Card>
  )
}
