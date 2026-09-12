import { Button } from '../../../design-system/components/Button'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { fr } from '../../../lib/i18n/fr'
import type { InstallOffer } from '../hooks/useInstallPrompt'
import styles from './InstallCard.module.css'

/**
 * The offer to keep EventSlide on the home screen.
 *
 * Shown after a photo has arrived, never before. The second half of an evening's photos
 * are taken after midnight, by which time the QR code is face down under a wine glass
 * and the tab has been closed — an icon is the difference between those photos being
 * sent and not.
 *
 * Two shapes, because the platforms genuinely differ: a button where the browser will
 * raise a real prompt, and a sentence where the only route is the share menu. There is
 * deliberately no third shape for "browser that does neither" — it renders nothing.
 */

export interface InstallCardProps {
  readonly offer: InstallOffer
  readonly onInstall: () => void
  readonly onDismiss: () => void
}

export function InstallCard({ offer, onInstall, onDismiss }: InstallCardProps) {
  if (offer.kind === 'none') return null

  return (
    <section
      className={styles['card']}
      aria-labelledby="install-title"
      data-testid="install-card"
      // A status, not an alert: the card appears on its own once a photo lands, and
      // nothing has gone wrong. Its sibling OfflineNotice announces itself the same way.
      role="status"
    >
      <div className={styles['body']}>
        <p className={styles['title']} id="install-title">
          {fr.upload.installTitle}
        </p>
        <p className={styles['hint']}>
          {offer.kind === 'prompt' ? fr.upload.installHint : fr.upload.installIosHint}
        </p>
        {/* Only where there is something to press. On iOS the sentence above is the
            instruction, and a button that did nothing would be worse than none. */}
        {offer.kind === 'prompt' ? (
          <Button variant="secondary" size="sm" onClick={onInstall}>
            {fr.upload.installAction}
          </Button>
        ) : null}
      </div>

      {/* Dismissal is remembered across visits: a guest who said no at 21:00 must not be
          asked again at midnight. */}
      <IconButton aria-label={fr.upload.installDismiss} icon={<CloseIcon />} onClick={onDismiss} />
    </section>
  )
}
