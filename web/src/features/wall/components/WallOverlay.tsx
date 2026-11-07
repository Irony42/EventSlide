import { cx } from '../../../design-system/classNames'
import { Card } from '../../../design-system/components/Card'
import { CloseIcon } from '../../../design-system/components/CloseIcon'
import { IconButton } from '../../../design-system/components/IconButton'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { joinHost } from '../../../lib/joinHost'
import { JoinQr } from './JoinQr'
import styles from './WallOverlay.module.css'

export interface WallOverlayProps {
  /** The code and its link, both from the wall response — see {@link WallEmptyStateProps}. */
  readonly join: { readonly code: string; readonly url: string }
  readonly onDismiss: () => void
  /**
   * The corner the host chose (spec 14). Absent is the bottom end, the card as it always was. A
   * top corner is laid out by the column that stacks it above the occupants of that corner.
   */
  readonly placement?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'
  /** Taken out of the corner and into the flow of the column that stacks it. */
  readonly stacked?: boolean
}

/**
 * The corner reminder: how to join, once the photos have taken the screen.
 *
 * Somebody arrives at 23:00, sees a wall of photos and has no idea how to add one —
 * the printed card is on a table they are not sitting at. In 1.0 the QR existed only
 * on a separate page nobody projected, so late arrivals simply did not join.
 *
 * It sits in the opposite corner from the caption, inside the projector safe area, and
 * a host who walks up can put it away with `Q` or with the button — and it comes back by
 * itself, because the projector is unattended.
 *
 * Its title says what to do ("send your photos to the screen") rather than naming a place,
 * since from ten metres a guest needs the verb. Under the code, the address to type it at
 * is for the phone that cannot read the QR (MUR-7).
 */
export function WallOverlay({
  join,
  onDismiss,
  placement = 'bottom-end',
  stacked = false,
}: WallOverlayProps) {
  const text = useTranslations()
  const host = joinHost(join.url)

  return (
    <Card
      className={cx(
        styles['overlay'],
        placement === 'bottom-start' && styles['bottomStart'],
        stacked && styles['stacked'],
      )}
      data-placement={placement === 'bottom-end' ? undefined : placement}
    >
      <div className={styles['header']}>
        <h2 className={styles['prompt']}>{text.wall.sendPrompt}</h2>
        <IconButton
          aria-label={text.wall.dismissJoinCard}
          icon={<CloseIcon />}
          variant="ghost"
          onClick={onDismiss}
        />
      </div>
      <JoinQr url={join.url} />
      <p className={styles['code']}>{join.code}</p>
      {host === null ? null : (
        <p className={styles['address']}>{text.wall.typeCodeAt(join.code, host)}</p>
      )}
    </Card>
  )
}
