import { Card } from '../../../design-system/components/Card'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { fr } from '../../../lib/i18n/fr'
import { JoinQr } from './JoinQr'
import styles from './WallOverlay.module.css'

export interface WallOverlayProps {
  /** The code and its link, both from the wall response — see {@link WallEmptyStateProps}. */
  readonly join: { readonly code: string; readonly url: string }
  readonly onDismiss: () => void
}

/**
 * The corner reminder: how to join, once the photos have taken the screen.
 *
 * Somebody arrives at 23:00, sees a wall of photos and has no idea how to add one —
 * the printed card is on a table they are not sitting at. In 1.0 the QR existed only
 * on a separate page nobody projected, so late arrivals simply did not join.
 *
 * It sits in the opposite corner from the caption, inside the projector safe area, and
 * a host who walks up can put it away with Escape or with the button.
 */
export function WallOverlay({ join, onDismiss }: WallOverlayProps) {
  return (
    <Card className={styles['overlay']}>
      <div className={styles['header']}>
        <h2 className={styles['prompt']}>{fr.wall.joinPrompt}</h2>
        <IconButton
          aria-label={fr.wall.dismissJoinCard}
          icon={<CloseIcon />}
          variant="ghost"
          onClick={onDismiss}
        />
      </div>
      <JoinQr url={join.url} />
      <p className={styles['code']}>{join.code}</p>
    </Card>
  )
}
